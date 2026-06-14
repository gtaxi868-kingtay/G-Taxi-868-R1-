// dispatch_for_client — Merchant sends a car for their client.
// Called from the merchant-mobile DispatchScreen.
// The merchant's shop becomes the PICKUP location; a 4-digit PIN
// lets the driver verify the client at the door.
// No _shared imports — self-contained for MCP bundler compatibility.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}

function generatePin(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    try {
        // ── 1. Authenticate merchant ──────────────────────────────────────────
        const authHeader = req.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return json({ success: false, error: "Unauthorized" }, 401);

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: { user }, error: authError } = await admin.auth.getUser(token);
        if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

        // ── 2. Parse body ─────────────────────────────────────────────────────
        const { client_phone, note, vehicle_type = "standard" } = await req.json();
        if (!client_phone) return json({ success: false, error: "client_phone is required" }, 400);

        // ── 3. Resolve merchant record ────────────────────────────────────────
        const { data: merchant, error: merchantErr } = await admin
            .from("merchants")
            .select("id, name, address, lat, lng, created_by, is_active, activation_status")
            .eq("created_by", user.id)
            .eq("is_active", true)
            .maybeSingle();

        if (merchantErr) throw merchantErr;
        if (!merchant) return json({ success: false, error: "No active merchant found for this account" }, 403);
        if (!merchant.lat || !merchant.lng) {
            return json({ success: false, error: "Merchant location not set. Update your merchant profile first." }, 422);
        }

        // ── 4. Look up client by phone (optional — graceful if not found) ─────
        const normalizedPhone = client_phone.trim().replace(/\s+/g, "");
        const { data: clientProfile } = await admin
            .from("profiles")
            .select("id, name, phone")
            .eq("phone", normalizedPhone)
            .maybeSingle();

        const clientName = clientProfile?.name || "Client";
        const riderId = clientProfile?.id ?? user.id;

        // ── 5. Create ride ────────────────────────────────────────────────────
        const pin = generatePin();

        // Dropoff is a slight offset from pickup (placeholder).
        // The client or driver updates the destination when in-app.
        const placeholderDropoffLat = merchant.lat + 0.001;
        const placeholderDropoffLng = merchant.lng + 0.001;

        const { data: ride, error: rideErr } = await admin
            .from("rides")
            .insert({
                rider_id: riderId,
                billed_to_merchant_id: merchant.id,
                pickup_lat: merchant.lat,
                pickup_lng: merchant.lng,
                pickup_address: `${merchant.name} — ${merchant.address}`,
                dropoff_lat: placeholderDropoffLat,
                dropoff_lng: placeholderDropoffLng,
                dropoff_address: "Destination pending — driver will confirm with client",
                status: "searching",
                payment_method: "corporate_billing",
                vehicle_type: vehicle_type,
                ride_pin: pin,
                total_fare_cents: 0,
                metadata: {
                    is_merchant_dispatch: true,
                    is_merchant_ride: true,
                    merchant_name: merchant.name,
                    client_phone: normalizedPhone,
                    client_name: clientName,
                    note: note || null,
                    dispatched_by: user.id,
                },
            })
            .select("id, ride_pin")
            .single();

        if (rideErr) throw rideErr;

        // ── 6. Send push notification to client (if registered) ──────────────
        if (clientProfile?.id) {
            await admin.functions.invoke("send_push_notification", {
                body: {
                    user_id: clientProfile.id,
                    title: `${merchant.name} sent you a ride 🚕`,
                    body: `Your car is being arranged. PIN: ${pin}. Driver will confirm destination.`,
                    payload: { route: "SearchingDriver", rideId: ride.id },
                },
            }).catch(() => {
                // Push failure is non-fatal
            });
        }

        return json({
            success: true,
            ride_id: ride.id,
            ride_pin: ride.ride_pin,
            client_name: clientName,
            pickup_address: `${merchant.name} — ${merchant.address}`,
            message: clientProfile
                ? `Car dispatched. ${clientName} will be notified.`
                : `Car dispatched. Ask client to open the G-Taxi app with PIN ${pin}.`,
        });

    } catch (err: any) {
        console.error("dispatch_for_client error:", err);
        return json({ success: false, error: err.message || "Internal server error" }, 500);
    }
});
