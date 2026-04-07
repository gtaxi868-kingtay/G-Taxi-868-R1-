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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

        // Verify user is a merchant
        const { data: merchant, error: merchantError } = await adminClient
            .from("merchants")
            .select("*")
            .eq("id", user.id)
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
            payment_method = "cash", // Guests typically pay cash unless Merchant Billable
        } = await req.json();

        if (!guest_name || !guest_phone || !destination_lat || !destination_lng) {
            throw new Error("Missing required guest or destination information");
        }

        // 3. Create the Ride Request
        // We use the Merchant's location as the pickup, and bill the ride to them (or cash)
        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();

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
                total_fare_cents: 0, // Will be calculated by driver matching logic
                vehicle_type: vehicle_type,
                payment_method: payment_method,
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
                message: `Ride summoned for ${guest_name}. SMS sent.`
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
