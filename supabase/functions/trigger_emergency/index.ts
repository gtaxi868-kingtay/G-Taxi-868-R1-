import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { sendWhatsApp } from "../_shared/sms.ts";
import { sendPushNotification } from "../_shared/push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Based on the LIVE v35 source (2026-10-14), not the older git copy -- live
// had already moved to getCorsHeaders.
//
// Honesty rule for this function: never tell someone in danger that help is
// coming unless a human was actually reached. Before this change the rider
// was told "Security team notified. Help is on the way." on every success,
// while (verified live 2026-10-14):
//   - raise_admin_alert pushes only to admins with an Expo push token, and
//     0 of 3 admins had one (the admin app never registers for push), so no
//     G-Taxi person was alerted on a phone;
//   - the emergency-contact WhatsApp is free-form text, which WhatsApp only
//     delivers inside a 24h customer-service window, so it usually fails.
// Now we count who was actually reached. If nobody, we return 503 so EVERY
// installed app version falls through to its existing "Call 999 / WhatsApp
// support" fallback instead of a false reassurance. The alert is still
// logged (emergency_logs) and escalated (system_alerts, nearby drivers)
// either way.

const T_AND_T_EMERGENCY = "Police 999 · Ambulance 811 · Fire 990";

serve(async (req) => {
    const corsHeaders = getCorsHeaders(req);
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { ride_id } = await req.json();

        if (!ride_id) {
            return new Response(JSON.stringify({ error: "Missing ride_id" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { data: ride, error: rideError } = await supabase
            .from("rides")
            .select("rider_id, driver_id")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            throw new Error(`Ride not found: ${rideError?.message}`);
        }

        // rides.driver_id is drivers.id, NOT the driver's auth user id — comparing
        // it directly to `user.id` (as this check used to) rejected every
        // legitimate driver-raised SOS with 403 before it could reach
        // handle_sos. Resolve the caller's own drivers.id via drivers.user_id
        // first, matching the pattern _shared/auth.ts's requireDriver uses.
        const isRider = ride.rider_id === user.id;
        let isDriver = false;
        if (!isRider && ride.driver_id) {
            const { data: driverRow } = await supabase
                .from("drivers")
                .select("id")
                .eq("user_id", user.id)
                .maybeSingle();
            isDriver = driverRow?.id === ride.driver_id;
        }

        if (!isRider && !isDriver) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // profiles/drivers have no `phone` column — only `phone_number`. The
        // embedded selects below used to request `phone`, which PostgREST
        // rejects, silently nulling out `fullRide` and, with it, every
        // downstream name/phone/location field and the emergency-contact
        // message this function exists to send.
        const { data: fullRide } = await supabase
            .from("rides")
            .select("*, rider:rider_id(id, full_name, phone_number, emergency_contact_name, emergency_contact_phone), driver:driver_id(id, name, phone_number, lat, lng)")
            .eq("id", ride_id)
            .single();

        await supabase.from("emergency_logs").insert({
            ride_id,
            rider_id: ride.rider_id,
            driver_id: ride.driver_id,
            status: "triggered",
            metadata: {
                timestamp: new Date().toISOString(),
                rider_name: fullRide?.rider?.full_name,
                driver_name: fullRide?.driver?.name,
                driver_phone: fullRide?.driver?.phone_number,
                location: { lat: fullRide?.driver?.lat, lng: fullRide?.driver?.lng },
            },
        });

        console.log(`🚨 EMERGENCY TRIGGERED for Ride ${ride_id}`);

        // ── Escalate to the people who can actually act ───────────────────────
        // handle_sos: a CRITICAL system_alerts row (read by the admin SOS
        // inbox; raise_admin_alert also pushes to any admin with an Expo push
        // token), a safety point on the map, and a warning to online drivers
        // near the incident. Identity is already verified above (the caller
        // must be this ride's rider or driver), which is why handle_sos is
        // service_role only and does not re-check.
        let escalation: { success?: boolean; drivers_notified?: number } | null = null;
        try {
            const { data: sosResult, error: sosError } = await supabase.rpc("handle_sos", {
                p_ride_id: ride_id,
                p_raised_by: user.id,
                p_raiser_role: isRider ? "rider" : "driver",
            });
            if (sosError) {
                console.error("handle_sos failed:", sosError.message);
            } else {
                escalation = sosResult;
                console.log("handle_sos:", JSON.stringify(sosResult));
            }
        } catch (e) {
            // The alert is already durable in emergency_logs. A failure to
            // escalate must never stop the rider's own contact being messaged.
            console.error("handle_sos threw:", String(e));
        }

        // Admins whose phones raise_admin_alert could actually page. Push
        // delivery itself is fire-and-forget, so this counts reachable admin
        // devices, not confirmed deliveries.
        const { count: adminsPaged } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("role", "admin")
            .like("push_token", "ExponentPushToken%");

        const riderName = fullRide?.rider?.full_name || "A rider";
        const driverName = fullRide?.driver?.name || "the driver";
        const driverPhone = fullRide?.driver?.phone_number || "N/A";
        const riderPhone = fullRide?.rider?.phone_number;
        const emergencyName = fullRide?.rider?.emergency_contact_name;
        const emergencyPhone = fullRide?.rider?.emergency_contact_phone;

        // ── Emergency contact: counts only if WhatsApp confirms acceptance ──
        let contactReached = false;
        if (emergencyPhone) {
            const smsMessage = `🚨 EMERGENCY — ${riderName} triggered an alert during their ride with ${driverName} (${driverPhone}). Location: ${fullRide?.driver?.lat},${fullRide?.driver?.lng}`;
            const waResult = await sendWhatsApp(emergencyPhone, smsMessage);
            contactReached = waResult.success === true;
            console.log(`Emergency alert to ${emergencyName}:`, contactReached ? "sent via " + waResult.channel : "failed — " + (waResult.error || ""));
        } else {
            console.warn("No emergency contact phone on file for rider");
        }

        const humansReached = (contactReached ? 1 : 0) + (adminsPaged ?? 0);

        // ── Tell the rider exactly what happened, nothing more ──
        const riderUpdate = contactReached
            ? `Your emergency contact${emergencyName ? ` (${emergencyName})` : ""} was messaged. If you are in danger, call ${T_AND_T_EMERGENCY}.`
            : `Your SOS was logged, but we could not confirm anyone was reached. If you are in danger, call ${T_AND_T_EMERGENCY} now.`;

        const { data: riderProfile } = await supabase
            .from("profiles")
            .select("push_token")
            .eq("id", ride.rider_id)
            .single();
        if (riderProfile?.push_token) {
            await sendPushNotification(riderProfile.push_token, "🚨 SOS recorded", riderUpdate, { type: "emergency_acknowledged", ride_id });
        }
        if (!contactReached && riderPhone) {
            await sendWhatsApp(riderPhone, `🚨 G-Taxi: your SOS for ride ${ride_id.slice(0, 8)} was logged. ${riderUpdate}`);
        }

        const summary = {
            logged: true,
            escalated: escalation?.success === true,
            drivers_notified: escalation?.drivers_notified ?? 0,
            emergency_contact_reached: contactReached,
            admins_paged: adminsPaged ?? 0,
            humans_reached: humansReached,
            message: riderUpdate,
        };

        // Nobody reached => fail loudly so every app version shows its
        // "Call 999" fallback rather than "help is on the way".
        if (humansReached === 0) {
            return new Response(JSON.stringify({ ...summary, success: false, error: "no_responder_reached" }), {
                status: 503,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ ...summary, success: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        if (err instanceof Response) return err;
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
