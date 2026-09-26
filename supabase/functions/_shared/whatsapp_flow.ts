// supabase/functions/_shared/whatsapp_flow.ts
// WhatsApp tap-to-ride conversation state machine (founder-confirmed 25 Sep 2026).
//
// Flow: tap -> WhatsApp prefill "GTAXI TAP <node_id>" -> destination (location
// pin primary, free text fallback) -> server-side fare quote -> YES/NO confirm ->
// selfie -> ride row + server-side dispatch -> driver accepts -> rider gets
// PIN + plate -> driver completes -> app invite.
//
// Notes:
// - Pricing reuses _shared/pricing.ts (the same constants estimate_fare uses).
// - Proximity matching reuses the claim_available_driver RPC — the actual
//   matching logic match_driver itself calls. match_driver's HTTP endpoint
//   cannot be called server-to-server because it requires a rider JWT and a
//   rider_id === caller check, which a WhatsApp guest (no auth user) cannot
//   satisfy. The dispatch below mirrors match_driver's core mechanism
//   (claim -> ride_offers row -> push + WhatsApp nudge), the same precedent
//   process_dispatch_queue already follows for its backup path.
// - Rides are created via the create_ride_atomic SECURITY DEFINER RPC so the
//   revenue_splits row is written atomically, exactly like app rides.
// - Every outbound send goes through sendWhatsApp, which noops gracefully
//   until WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PRICING, calculateFare } from "./pricing.ts";
import { sendWhatsApp, sendInteractiveButtons } from "./sms.ts";
import { sendPushNotification } from "./push.ts";
import { checkRateLimit } from "./rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
const WHATSAPP_API_VERSION = "v18.0";

// Trinidad & Tobago bounding box (lon/lat) for geocoding guardrails.
const TT_BBOX = "-61.95,10.0,-60.5,11.4";

export type WaState =
    | "TAP_RECEIVED" | "AWAITING_DESTINATION" | "FARE_QUOTED" | "AWAITING_SELFIE"
    | "DRIVER_SEARCHING" | "DRIVER_ASSIGNED" | "COMPLETED" | "APP_INVITE_SENT"
    | "CANCELLED" | "NO_DRIVERS";

const TERMINAL: WaState[] = ["COMPLETED", "APP_INVITE_SENT", "CANCELLED", "NO_DRIVERS"];

export interface InboundMessage {
    phone: string;          // E.164 with + prefix
    messageId: string;      // Meta wamid — used for idempotency
    type: "text" | "location" | "image" | "button" | "unknown";
    text?: string;
    location?: { lat: number; lng: number; name?: string };
    imageId?: string;
    buttonPayload?: string;
}

interface LatLng { lat: number; lng: number }

type AdminClient = ReturnType<typeof createClient>;

export function adminClient(): AdminClient {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Extract the tap token from a prefill. Accepts case/space variants and both
 *  node UUIDs and physical tag UIDs ("GTAXI TAP <token>"). The token is only
 *  validated against kiosk_nodes downstream — this just rejects junk. */
export function parseTapPrefill(text: string): string | null {
    if (!text) return null;
    const m = text.trim().match(/^g-?taxi\s+tap\s+([A-Za-z0-9][A-Za-z0-9_-]{2,64})\s*$/i);
    return m ? m[1] : null;
}

/** WhatsApp gives wa_id as bare digits; normalize to E.164. */
export function normalizePhone(waId: string): string {
    const digits = String(waId || "").replace(/\D/g, "");
    return digits ? `+${digits}` : "";
}

/** "TT$22" for whole dollars, "TT$22.50" otherwise. */
export function formatTTD(cents: number): string {
    const v = (cents || 0) / 100;
    return Number.isInteger(v) ? `TT$${v}` : `TT$${v.toFixed(2)}`;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

export function isTerminalState(state: string): boolean {
    return (TERMINAL as string[]).includes(state);
}

// ── Conversation copy (Trinidad-plain, short, truthful) ─────────────────────

const COPY = {
    askDestination: (pickupName: string) =>
        `G-Taxi here \u{1F697}\nPickup set: ${pickupName}.\nWhere are you headed? Share your location pin \u{1F4CD} or type the address.`,
    unknownTap: () =>
        `Hmm, I couldn't find that touch point. Make sure you tapped a live G-Taxi puck and try again.`,
    inactiveTap: () =>
        `That touch point isn't live yet — we're opening community by community. You're early, and that's good. We'll be in touch.`,
    fareQuote: (dest: string, fare: string) =>
        `Trip to ${dest}: about ${fare}.\nCash only for WhatsApp rides. Book it?`,
    needPin: () =>
        `I couldn't pin that address on the map. Tap \u{1F4CE} Attach > Location > Send your current location and I'll price the trip exactly.`,
    askSelfie: () =>
        `One quick selfie so your driver can spot you \u{1F933}\n(Nothing weird — it just goes to your driver.)`,
    findingDriver: () =>
        `Finding your driver\u2026 I'll message you the moment one accepts.`,
    noDrivers: () =>
        `No drivers close by right now. Sorry about that — try again in a bit, or tap the puck when you see drivers around.`,
    driverAssigned: (name: string, vehicle: string, plate: string, pin: string) =>
        `Your driver is on the way! \u{1F697}\n${name} \u2022 ${vehicle} \u2022 ${plate}\nYour PIN: ${pin}\nShow the PIN to your driver before you get in.`,
    driverReminder: (pin: string) =>
        `Your driver is still on the way. Your PIN is ${pin} — show it before you get in.`,
    rideComplete: (appLink: string) =>
        `You made it! \u{1F389} Thanks for riding G-Taxi.\nGrab the app for faster bookings next time:\n${appLink}`,
    cancelled: () => `No stress — ride cancelled. Tap the puck whenever you're ready.`,
    fallback: () =>
        `I'm the G-Taxi ride bot — tap a puck to start a ride, or reply CANCEL to stop this one.`,
    stillSearching: () =>
        `Still looking for a driver\u2026 I'll ping you as soon as one accepts.`,
};

// ── Small data helpers ──────────────────────────────────────────────────────

async function markProcessed(db: AdminClient, messageId: string): Promise<boolean> {
    // true = first time seen (caller should process); false = duplicate.
    const { error } = await db.from("whatsapp_processed_messages").insert({ message_id: messageId });
    return !error;
}

async function latestConversation(db: AdminClient, phone: string): Promise<any | null> {
    const { data } = await db
        .from("whatsapp_conversations")
        .select("*")
        .eq("phone_number", phone)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return data ?? null;
}

async function setState(db: AdminClient, id: string, state: WaState, patch: Record<string, unknown> = {}) {
    await db.from("whatsapp_conversations").update({
        state, updated_at: new Date().toISOString(), ...patch,
    }).eq("id", id);
}

async function sendRider(db: AdminClient, phone: string, body: string): Promise<void> {
    try {
        const r = await sendWhatsApp(phone, body);
        if (!r.success) console.log(`[wa-flow] send noop/fail to ${phone}: ${r.error || r.channel}`);
    } catch (e) {
        console.error("[wa-flow] sendRider error:", e);
    }
}

async function pingAdmins(db: AdminClient, title: string, body: string): Promise<void> {
    // In-app admin ping (notifications table). Fully additive — no auth needed
    // server-side; notify_admins itself requires an admin JWT which a webhook
    // cannot mint.
    try {
        const { data: admins } = await db.from("profiles").select("id").eq("is_admin", true).limit(20);
        if (!admins || admins.length === 0) return;
        await db.from("notifications").insert(
            admins.map((a: any) => ({ user_id: a.id, type: "ride", title, body })),
        );
    } catch (e) {
        console.error("[wa-flow] pingAdmins failed (non-fatal):", e);
    }
}

async function getOrCreateGuestProfile(db: AdminClient, phone: string): Promise<string> {
    const { data: existing } = await db
        .from("profiles").select("id").eq("phone_number", phone).limit(1).maybeSingle();
    if (existing?.id) return existing.id as string;
    const id = crypto.randomUUID();
    // profiles.id normally mirrors auth.users.id; no FK enforces it, so a
    // phone-keyed guest row is safe. If the rider later signs up in-app with
    // the same number, link by phone_number then.
    const { error } = await db.from("profiles").insert({
        id, phone_number: phone, full_name: "WhatsApp rider", role: "rider",
    });
    if (error) throw new Error(`guest profile insert failed: ${error.message}`);
    return id;
}

// ── Fare quoting (reuses _shared/pricing.ts — same math as estimate_fare) ───

async function routeEstimate(from: LatLng, to: LatLng): Promise<{ meters: number; seconds: number }> {
    if (MAPBOX_TOKEN) {
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/` +
                `${from.lng},${from.lat};${to.lng},${to.lat}?access_token=${MAPBOX_TOKEN}`;
            const res = await fetch(url);
            if (res.ok) {
                const j = await res.json();
                const r = j?.routes?.[0];
                if (r?.distance && r?.duration) {
                    return { meters: Math.round(r.distance), seconds: Math.round(r.duration) };
                }
            }
        } catch (e) {
            console.error("[wa-flow] mapbox directions failed, using haversine fallback:", e);
        }
    }
    // Fallback mirrors estimate_fare: haversine with 1.3x road factor.
    const meters = Math.round(haversineMeters(from, to) * 1.3);
    const seconds = Math.round((meters / 1000 / 30) * 3600); // ~30 km/h urban
    return { meters, seconds };
}

/** Best-effort text -> coordinates, bounded to Trinidad & Tobago. */
async function geocodeText(text: string): Promise<LatLng | null> {
    if (!MAPBOX_TOKEN || !text.trim()) return null;
    try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
            `${encodeURIComponent(text)}.json?access_token=${MAPBOX_TOKEN}` +
            `&country=TT&bbox=${TT_BBOX}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const j = await res.json();
        const f = j?.features?.[0];
        if (f?.center?.length === 2) return { lng: f.center[0], lat: f.center[1] };
        return null;
    } catch (e) {
        console.error("[wa-flow] geocode failed:", e);
        return null;
    }
}

// ── Selfie: Meta media -> private storage bucket ────────────────────────────

async function downloadAndStoreSelfie(db: AdminClient, imageId: string, convoId: string): Promise<string> {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
    if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN not set");
    // 1. media URL
    const metaRes = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${imageId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) throw new Error(`media lookup failed: ${metaRes.status}`);
    const { url } = await metaRes.json();
    if (!url) throw new Error("no media url returned");
    // 2. bytes
    const binRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) throw new Error(`media download failed: ${binRes.status}`);
    const bytes = new Uint8Array(await binRes.arrayBuffer());
    // 3. upload (private bucket; service-role bypasses RLS)
    const path = `${convoId}/${Date.now()}.jpg`;
    const { error } = await db.storage.from("ride-selfies").upload(path, bytes, {
        contentType: "image/jpeg", upsert: true,
    });
    if (error) throw new Error(`selfie upload failed: ${error.message}`);
    return path;
}

// ── Ride creation + dispatch ────────────────────────────────────────────────

function makeRidePin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

async function createGuestRide(
    db: AdminClient,
    convo: any,
    dest: LatLng,
    destText: string,
): Promise<{ rideId: string; pin: string }> {
    const profileId = await getOrCreateGuestProfile(db, convo.phone_number);
    const pickup = { lat: convo.pickup_lat, lng: convo.pickup_lng };
    const { meters, seconds } = await routeEstimate(pickup, dest);
    const fareCents = calculateFare(meters, seconds, "Standard", 1.0, 0);
    const driverPayout = Math.round(fareCents * 0.8);
    const pin = makeRidePin();

    const { data, error } = await db.rpc("create_ride_atomic", {
        p_rider_id: profileId,
        p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng,
        p_pickup_address: convo.pickup_address || convo.pickup_name || "G-Taxi touch point",
        p_dropoff_lat: dest.lat, p_dropoff_lng: dest.lng,
        p_dropoff_address: destText,
        p_status: "searching",
        p_total_fare_cents: fareCents,
        p_driver_payout_cents: driverPayout,
        p_distance_meters: meters,
        p_duration_seconds: seconds,
        p_route_polyline: null,
        p_vehicle_type: "Standard",
        p_payment_method: "cash", // WhatsApp guests have no wallet — cash only.
        p_ride_pin: pin,
        p_idempotency_key: `wa-${convo.id}`,
        p_metadata: {
            origin: "whatsapp", node_id: convo.node_id,
            phone: convo.phone_number, dest_text: destText,
        },
        p_taxi_stand_id: null, p_billed_to_merchant_id: null,
        p_node_id: convo.node_id,
        p_driver_cut: 80, p_platform_cut: 20, p_merchant_cut: 0,
    });
    if (error || !data?.ride_id) {
        throw new Error(`create_ride_atomic failed: ${error?.message || data?.error || "unknown"}`);
    }
    const rideId = data.ride_id as string;
    await db.from("rides").update({ origin: "whatsapp" }).eq("id", rideId);
    await db.from("whatsapp_conversations").update({
        rider_profile_id: profileId, updated_at: new Date().toISOString(),
    }).eq("id", convo.id);
    return { rideId, pin };
}

/** Server-side dispatch. Uses the claim_available_driver RPC — the same
 *  proximity matcher match_driver calls — then writes the ride_offers row
 *  and nudges the driver (push + WhatsApp), mirroring match_driver's core. */
async function dispatchRide(
    db: AdminClient, rideId: string, fareCents: number,
): Promise<{ ok: boolean; driverId?: string }> {
    const { data: ride } = await db.from("rides")
        .select("id, pickup_lat, pickup_lng, pickup_address, rider_id")
        .eq("id", rideId).single();
    if (!ride) return { ok: false };

    const { data: claimed, error: claimErr } = await db.rpc("claim_available_driver", {
        p_pickup_lat: ride.pickup_lat, p_pickup_lng: ride.pickup_lng,
        p_vehicle_type: "Any", p_rider_id: ride.rider_id,
        p_max_distance_km: 15, p_candidate_ids: null,
    });
    if (claimErr) console.error("[wa-flow] claim_available_driver error:", claimErr);
    const pick = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!pick?.driver_id) return { ok: false };

    const { data: driver } = await db.from("drivers")
        .select("id, name, phone_number, push_token, commission_tier")
        .eq("id", pick.driver_id).single();
    if (!driver) return { ok: false };

    // Driver payout mirrors match_driver: platform rate from pricing_config,
    // pioneer tier 3% lower.
    const { data: platRow } = await db.from("pricing_config")
        .select("value_cents").eq("key", "PLATFORM_RATE_CENTS").maybeSingle();
    const platRate = platRow ? (platRow.value_cents ?? 1500) / 10000 : 0.15;
    const commissionRate = driver.commission_tier === "pioneer" ? Math.max(0.01, platRate - 0.03) : platRate;
    const driverPayout = Math.round(fareCents * (1 - commissionRate));

    const { error: offerErr } = await db.from("ride_offers").insert({
        ride_id: rideId, driver_id: driver.id, status: "pending",
        distance_meters: Math.round((pick.distance_km || 0) * 1000),
        driver_payout_cents: driverPayout,
        expires_at: new Date(Date.now() + 15_000).toISOString(),
    });
    if (offerErr) {
        console.error("[wa-flow] ride_offers insert failed:", offerErr);
        return { ok: false };
    }
    await db.from("rides").update({ status: "searching" }).eq("id", rideId)
        .in("status", ["requested", "searching", "waiting_queue"]);

    const waMsg = `G-TAXI: New Ride Request at ${ride.pickup_address || "touch point"}. ` +
        `WhatsApp rider (cash, ${formatTTD(fareCents)}). Tap to view.`;
    if (driver.push_token) {
        sendPushNotification(driver.push_token, "\u{1F696} New Ride Request",
            "A WhatsApp rider is waiting nearby. Tap to view the offer.",
            { type: "NEW_RIDE_OFFER", ride_id: rideId }).catch((e) =>
            console.error("[wa-flow] driver push failed (non-fatal):", e));
    }
    if (driver.phone_number) {
        sendWhatsApp(driver.phone_number, waMsg)
            .then((r) => { if (!r.success) console.log(`[wa-flow] driver WA: ${r.error || r.channel}`); })
            .catch((e) => console.error("[wa-flow] driver WA failed (non-fatal):", e));
    }
    return { ok: true, driverId: driver.id as string };
}

// ── Tap handling ────────────────────────────────────────────────────────────

async function startFromTap(db: AdminClient, phone: string, token: string): Promise<void> {
    // Token may be the kiosk_nodes.id UUID (written to the tag) or the
    // physical tag_uid (tag-encoded URL used ?tag=). Try both.
    let node: any = null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
        const r = await db.from("kiosk_nodes")
            .select("id, location_name, pickup_address, lat, lng, is_active")
            .eq("id", token.toLowerCase()).maybeSingle();
        node = r.data ?? null;
    }
    if (!node) {
        const r = await db.from("kiosk_nodes")
            .select("id, location_name, pickup_address, lat, lng, is_active")
            .eq("tag_uid", token).maybeSingle();
        node = r.data ?? null;
    }

    if (!node) {
        await sendRider(db, phone, COPY.unknownTap());
        return;
    }
    if (node.is_active === false) {
        await sendRider(db, phone, COPY.inactiveTap());
        return;
    }

    const { data: convo } = await db.from("whatsapp_conversations").insert({
        phone_number: phone, node_id: node.id, state: "AWAITING_DESTINATION",
        pickup_lat: node.lat, pickup_lng: node.lng,
        pickup_name: node.location_name, pickup_address: node.pickup_address,
    }).select().single();

    await pingAdmins(db, "WhatsApp tap",
        `${phone} tapped ${node.location_name || "a touch point"}. Awaiting destination.`);
    await sendRider(db, phone, COPY.askDestination(node.location_name || "your touch point"));
    void convo;
}

// ── Main inbound dispatcher ─────────────────────────────────────────────────

export async function handleInboundMessage(db: AdminClient, msg: InboundMessage): Promise<void> {
    if (!(await markProcessed(db, msg.messageId))) return; // duplicate delivery

    const rate = await checkRateLimit(db, `wa:${msg.phone}`, "whatsapp_webhook");
    if (!rate.allowed) return; // silent drop on abuse

    const text = (msg.text || "").trim();

    // Global cancel keywords.
    if (/^(cancel|stop|quit)$/i.test(text)) {
        const convo = await latestConversation(db, msg.phone);
        if (convo && !isTerminalState(convo.state)) {
            await setState(db, convo.id, "CANCELLED");
            await sendRider(db, msg.phone, COPY.cancelled());
        } else {
            await sendRider(db, msg.phone, COPY.fallback());
        }
        return;
    }

    // A fresh tap prefill always starts (or restarts) the flow.
    const tapNode = msg.type === "text" ? parseTapPrefill(text) : null;
    if (tapNode) {
        await startFromTap(db, msg.phone, tapNode);
        return;
    }

    const convo = await latestConversation(db, msg.phone);
    if (!convo || isTerminalState(convo.state)) {
        await sendRider(db, msg.phone, COPY.fallback());
        return;
    }

    const state = convo.state as WaState;

    if (state === "AWAITING_DESTINATION") {
        let dest: LatLng | null = null;
        let destText = "";
        if (msg.type === "location" && msg.location) {
            dest = { lat: msg.location.lat, lng: msg.location.lng };
            destText = msg.location.name || "Pinned location";
        } else if (msg.type === "text" && text) {
            dest = await geocodeText(text);
            destText = text.slice(0, 200);
        }
        if (!dest) {
            await sendRider(db, msg.phone, COPY.needPin());
            return;
        }
        const pickup = { lat: convo.pickup_lat, lng: convo.pickup_lng };
        const { meters, seconds } = await routeEstimate(pickup, dest);
        const fareCents = calculateFare(meters, seconds, "Standard", 1.0, 0);
        await setState(db, convo.id, "FARE_QUOTED", {
            dest_lat: dest.lat, dest_lng: dest.lng, dest_text: destText,
            fare_quote_cents: fareCents,
        });
        try {
            const r = await sendInteractiveButtons(msg.phone, COPY.fareQuote(destText, formatTTD(fareCents)), [
                { id: "WA_YES", title: "Yes, book it" },
                { id: "WA_NO", title: "No, cancel" },
            ]);
            if (!r.success) throw new Error(r.error || r.channel);
        } catch (e) {
            // Buttons need the Cloud API; fall back to plain YES/NO text.
            console.error("[wa-flow] interactive buttons failed, text fallback:", e);
            await sendRider(db, msg.phone, COPY.fareQuote(destText, formatTTD(fareCents)) + "\nReply YES to book, NO to cancel.");
        }
        return;
    }

    if (state === "FARE_QUOTED") {
        const payload = (msg.buttonPayload || text).toUpperCase();
        const yes = payload === "WA_YES" || /^(yes|y|book)$/i.test(text);
        const no = payload === "WA_NO" || /^(no|n)$/i.test(text);
        if (yes) {
            await setState(db, convo.id, "AWAITING_SELFIE");
            await sendRider(db, msg.phone, COPY.askSelfie());
        } else if (no) {
            await setState(db, convo.id, "CANCELLED");
            await sendRider(db, msg.phone, COPY.cancelled());
        } else {
            await sendRider(db, msg.phone, `Reply YES to book for about ${formatTTD(convo.fare_quote_cents || 0)}, or NO to cancel.`);
        }
        return;
    }

    if (state === "AWAITING_SELFIE") {
        if (msg.type !== "image" || !msg.imageId) {
            await sendRider(db, msg.phone, COPY.askSelfie());
            return;
        }
        let selfiePath: string;
        try {
            selfiePath = await downloadAndStoreSelfie(db, msg.imageId, convo.id);
        } catch (e) {
            console.error("[wa-flow] selfie store failed:", e);
            await sendRider(db, msg.phone, `That photo didn't come through — try sending it once more?`);
            return;
        }
        const dest = { lat: convo.dest_lat, lng: convo.dest_lng };
        let rideId: string;
        try {
            const created = await createGuestRide(db, convo, dest, convo.dest_text || "Pinned location");
            rideId = created.rideId;
        } catch (e) {
            console.error("[wa-flow] createGuestRide failed:", e);
            await sendRider(db, msg.phone, `Something jammed on our side — reply CANCEL and tap the puck again?`);
            return;
        }
        await setState(db, convo.id, "DRIVER_SEARCHING", { ride_id: rideId, selfie_url: selfiePath });
        await sendRider(db, msg.phone, COPY.findingDriver());
        const dispatched = await dispatchRide(db, rideId, convo.fare_quote_cents || 0);
        if (!dispatched.ok) {
            await setState(db, convo.id, "NO_DRIVERS");
            await sendRider(db, msg.phone, COPY.noDrivers());
            await pingAdmins(db, "WhatsApp ride needs drivers",
                `${msg.phone}: no drivers claimed ride ${rideId.slice(0, 8)} near ${convo.pickup_name || "touch point"}.`);
        }
        return;
    }

    if (state === "DRIVER_SEARCHING") {
        await sendRider(db, msg.phone, COPY.stillSearching());
        return;
    }

    if (state === "DRIVER_ASSIGNED") {
        const { data: ride } = await db.from("rides").select("ride_pin").eq("id", convo.ride_id).maybeSingle();
        await sendRider(db, msg.phone, COPY.driverReminder(ride?.ride_pin || "----"));
        return;
    }

    // TAP_RECEIVED (shouldn't linger — taps go straight to AWAITING_DESTINATION)
    await sendRider(db, msg.phone, COPY.fallback());
}

// ── DB-triggered ride events (via pg_net -> /events/*) ──────────────────────

async function appInviteLink(db: AdminClient): Promise<string> {
    try {
        const { data } = await db.from("system_config").select("value").eq("key", "app_links").maybeSingle();
        const v = (data as any)?.value;
        if (typeof v === "string") { try { const j = JSON.parse(v); if (j?.rider_download_url) return j.rider_download_url; } catch { /* plain string */ } return v; }
        if (v?.rider_download_url) return v.rider_download_url as string;
    } catch { /* fall through */ }
    return "https://g-taxi.com/get";
}

/** Called by the /events/* endpoint. Re-reads the ride and only acts when the
 *  DB state genuinely matches — the trigger POST is unsigned, so this check
 *  is what makes forged events harmless. */
export async function handleRideEvent(db: AdminClient, rideId: string, event: string): Promise<void> {
    const convo = await db.from("whatsapp_conversations").select("*").eq("ride_id", rideId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data);
    if (!convo) return;
    const { data: ride } = await db.from("rides")
        .select("id, status, driver_id, ride_pin").eq("id", rideId).maybeSingle();
    if (!ride) return;

    if (event === "ride-assigned" && ride.status === "assigned" && convo.state === "DRIVER_SEARCHING") {
        const { data: driver } = await db.from("drivers")
            .select("name, vehicle_model, plate_number").eq("id", ride.driver_id).maybeSingle();
        await setState(db, convo.id, "DRIVER_ASSIGNED", { driver_id: ride.driver_id });
        await sendRider(db, convo.phone_number, COPY.driverAssigned(
            driver?.name || "Your driver",
            driver?.vehicle_model || "car",
            driver?.plate_number || "—",
            ride.ride_pin || "----",
        ));
        return;
    }

    if (event === "ride-completed" && ride.status === "completed"
        && (convo.state === "DRIVER_ASSIGNED" || convo.state === "DRIVER_SEARCHING")) {
        await setState(db, convo.id, "COMPLETED");
        await sendRider(db, convo.phone_number, COPY.rideComplete(await appInviteLink(db)));
        await setState(db, convo.id, "APP_INVITE_SENT");
        return;
    }
}
