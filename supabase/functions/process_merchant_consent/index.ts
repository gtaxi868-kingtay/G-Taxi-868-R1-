// Supabase Edge Function: process_merchant_consent
// BRIDGING THE GAP: Appointments -> Logistics Engine
//
// Triggered when a Merchant grants consent for a ride.
// Automates the creation of a 'searching' ride to take the guest to their appointment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        const { appointment_id } = await req.json();

        if (!appointment_id) {
            throw new Error("Missing appointment_id");
        }

        // 1. Fetch Appointment Details
        const { data: app, error: appError } = await adminClient
            .from("merchant_appointments")
            .select("*, merchant:merchant_id(*), service:service_id(*)")
            .eq("id", appointment_id)
            .single();

        if (appError || !app) throw new Error("Appointment not found");
        if (app.merchant_consent_status !== 'granted') throw new Error("Consent not granted");
        if (app.ride_id) throw new Error("Ride already created for this appointment");

        // 2. Conflict Check: Is rider already in a ride?
        const { data: activeRide } = await adminClient
            .from("rides")
            .select("id")
            .eq("rider_id", app.rider_id)
            .in("status", ["requested", "searching", "assigned", "arrived", "in_progress"])
            .maybeSingle();
        
        if (activeRide) throw new Error("Rider already has an active or pending ride");

        // 3. Prepare Payload for create_ride
        const pickup_lat = app.pickup_lat;
        const pickup_lng = app.pickup_lng;
        const pickup_address = app.pickup_address || "Client Location";
        const dropoff_lat = app.merchant.lat;
        const dropoff_lng = app.merchant.lng;
        const dropoff_address = app.merchant.address || app.merchant.name;

        // 4. Calculate Distance & Fare (Haversine fallback)
        const R = 6371000;
        const dLat = (dropoff_lat - pickup_lat) * Math.PI / 180;
        const dLng = (dropoff_lng - pickup_lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(pickup_lat * Math.PI / 180) * Math.cos(dropoff_lat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c_dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceMeters = Math.round(R * c_dist * 1.3); // 1.3x road factor
        const durationSeconds = Math.round(distanceMeters / 8.33); // ~30km/h average

        const { calculateFare } = await import("../_shared/pricing.ts");
        const fareCents = calculateFare(distanceMeters, durationSeconds, "Standard");

        // 5. Invoke create_ride logic
        const { data: newRide, error: rideError } = await adminClient
            .from("rides")
            .insert({
                rider_id: app.rider_id,
                pickup_lat,
                pickup_lng,
                pickup_address,
                dropoff_lat,
                dropoff_lng,
                dropoff_address,
                status: "searching",
                total_fare_cents: fareCents,
                vehicle_type: "Standard",
                payment_method: "cash",
                ride_pin: Math.floor(1000 + Math.random() * 9000).toString(),
                metadata: {
                    appointment_id: app.id,
                    merchant_id: app.merchant_id,
                    is_merchant_referred: true
                }
            })
            .select()
            .single();

        if (rideError) throw rideError;

        // 4. Link Ride back to Appointment
        await adminClient
            .from("merchant_appointments")
            .update({ ride_id: newRide.id })
            .eq("id", app.id);

        // 5. Notify Rider via Push (Phase 8A Placeholder)
        // await adminClient.rpc('send_push_notification', { ... });

        return new Response(
            JSON.stringify({ success: true, ride_id: newRide.id }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("process_merchant_consent error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
