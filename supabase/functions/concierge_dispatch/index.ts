// Supabase Edge Function: concierge_dispatch
// HANDSHAKE API: Restaurant / Airport Guest Dispatch
//
// Allows a Merchant to summon a ride for a Guest who may not have the G-Taxi app.
// The ride is created under the Merchant's authority, but with the Guest's contact info.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendSMS } from "../_shared/sms.ts"; 

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VEHICLE_MULTIPLIERS: Record<string, number> = {
    Standard: 1.0,
    XL: 1.5,
    Premium: 2.0,
};

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (value: number) => value * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateFareCents(pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number, vehicleType: string): number {
    const distanceMeters = haversineMeters(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const durationMinutes = Math.max(8, (distanceMeters / 1000 / 28) * 60);
    const multiplier = VEHICLE_MULTIPLIERS[vehicleType] ?? VEHICLE_MULTIPLIERS.Standard;
    const fare = (1600 + (distanceMeters / 1000) * 175 + durationMinutes * 95) * multiplier;
    return Math.max(2200, Math.round(fare));
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: req.headers.get("Authorization")! } },
        });

        // 1. Verify Merchant Caller
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) throw new Error("Unauthorized");

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: profile, error: profileError } = await adminClient
            .from("profiles")
            .select("merchant_id")
            .eq("id", user.id)
            .single();

        if (profileError || !profile?.merchant_id) throw new Error("Caller is not linked to a merchant");

        // Verify user is linked to an active merchant
        const { data: merchant, error: merchantError } = await adminClient
            .from("merchants")
            .select("*")
            .eq("id", profile.merchant_id)
            .eq("is_active", true)
            .single();

        if (merchantError || !merchant) throw new Error("Caller is not a registered merchant");

        // 2. Parse payload
        const {
            guest_name,
            guest_phone,
            destination_lat,
            destination_lng,
            destination_address,
            vehicle_type = "Standard",
            payment_method = merchant.billing_type === 'net-30' ? 'corporate_billing' : 'cash',
        } = await req.json();

        if (!guest_name || !guest_phone || destination_lat == null || destination_lng == null) {
            throw new Error("Missing required guest or destination information");
        }
        if (merchant.lat == null || merchant.lng == null) {
            throw new Error("Merchant pickup coordinates are not configured");
        }

        // 3. Verify Credit Limit for Corporate Billing
        if (payment_method === 'corporate_billing') {
            if (merchant.current_debt_cents >= merchant.credit_limit_cents) {
                throw new Error("Corporate credit limit reached. Please settle balance or use cash.");
            }
        }

        // 4. Create the Ride Request
        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();
        const fareCents = estimateFareCents(merchant.lat, merchant.lng, destination_lat, destination_lng, vehicle_type);

        const { data: newRide, error: insertError } = await adminClient
            .from("rides")
            .insert({
                rider_id: user.id, // Linked to the Merchant's account for tracking
                pickup_lat: merchant.lat,
                pickup_lng: merchant.lng,
                pickup_address: merchant.name + " (" + merchant.address + ")",
                dropoff_lat: destination_lat,
                dropoff_lng: destination_lng,
                dropoff_address: destination_address,
                status: "searching",
                total_fare_cents: fareCents,
                vehicle_type: vehicle_type,
                payment_method: payment_method,
                billed_to_merchant_id: payment_method === 'corporate_billing' ? merchant.id : null,
                ride_pin: ridePin,
                metadata: {
                    is_concierge: true,
                    merchant_name: merchant.name,
                    guest_name: guest_name,
                    guest_phone: guest_phone
                }
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // 4. Send SMS to Guest 
        const smsMessage = `G-TAXI: ${merchant.name} has summoned a ride for you to ${destination_address}. Your driver will arrive soon. Your ride PIN is ${ridePin}. Track your ride: https://gtaxi.app/track/${newRide.id}`;
        console.log("[SMS DISPATCH]", guest_phone, smsMessage);
        
        await sendSMS(guest_phone, smsMessage); 

        // 5. Log internal event
        await adminClient.from("user_events").insert({
            user_id: user.id,
            event_type: "concierge_dispatch",
            payload: { ride_id: newRide.id, guest_name }
        });

        return new Response(
            JSON.stringify({ 
                success: true, 
                ride_id: newRide.id,
                message: `Ride summoned for ${guest_name}. Share details with guest.`,
                sms_message: smsMessage
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("concierge_dispatch error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
