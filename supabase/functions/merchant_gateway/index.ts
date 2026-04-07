// Supabase Edge Function: merchant_gateway
// THE HEADLESS ENTERPRISE API
// Allows POS systems (KFC / Subway) to programmatically summon G-Taxi drivers.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Extremely simple hashing for the sake of the Edge environment. 
// Standard integration would use WebCrypto SubtleCrypto.
async function hashKey(rawKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. Basic Rate Limiting Check would go here in production via Redis

        // 2. Extract Authorization Bearer Token (The raw API Key)
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new Error("Missing or invalid Authorization header");
        }

        const rawKey = authHeader.split(" ")[1];
        const hashedKey = await hashKey(rawKey);

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 3. Verify API Key
        const { data: apiKeyRef, error: keyError } = await adminClient
            .from("merchant_api_keys")
            .select("merchant_id, is_active")
            .eq("hashed_key", hashedKey)
            .single();

        if (keyError || !apiKeyRef || !apiKeyRef.is_active) {
            throw new Error("Unauthorized: Invalid or revoked API Key");
        }

        // Update Last Used Timestamp
        await adminClient.from("merchant_api_keys")
             .update({ last_used_at: new Date().toISOString() })
             .eq("hashed_key", hashedKey);

        // 4. Fetch the Merchant Info
        const { data: merchant, error: merchantError } = await adminClient
            .from("merchants")
            .select("*")
            .eq("id", apiKeyRef.merchant_id)
            .single();

        if (merchantError || !merchant) throw new Error("Merchant not found");

        // 5. Parse the Payload from the B2B Provider (KFC POS)
        const {
            guest_name,
            guest_phone,
            destination_lat,
            destination_lng,
            destination_address,
            vehicle_type = "Standard",
        } = await req.json();

        if (!destination_lat || !destination_lng) {
            throw new Error("Missing destination coordinates");
        }

        // 6. Net-30 Billing Check
        let finalPaymentMethod = "cash";
        let billedMerchantId = null;

        if (merchant.billing_type === 'net-30') {
            // Check Credit Limit (We approximate fare at $0 until driver assigns reality, passing verification here)
            if (merchant.current_debt_cents >= merchant.credit_limit_cents) {
                // Return clear error to POS so cashier tells customer they must pay cash
                return new Response(JSON.stringify({ error: "Corporate credit limit reached. Switch to cash trip." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            finalPaymentMethod = "corporate_billing";
            billedMerchantId = merchant.id;
        }

        // 7. Dispatch the Headless Ride Request
        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();

        const { data: newRide, error: insertError } = await adminClient
            .from("rides")
            .insert({
                rider_id: merchant.id, 
                billed_to_merchant_id: billedMerchantId,
                pickup_lat: merchant.lat,
                pickup_lng: merchant.lng,
                pickup_address: merchant.name + " (" + merchant.address + ")",
                dropoff_lat: destination_lat,
                dropoff_lng: destination_lng,
                dropoff_address: destination_address,
                status: "searching",
                total_fare_cents: 0, 
                vehicle_type: vehicle_type,
                payment_method: finalPaymentMethod,
                ride_pin: ridePin,
                metadata: {
                    is_api_request: true,
                    merchant_name: merchant.name,
                    guest_name: guest_name,
                    guest_phone: guest_phone
                }
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // 8. Return Confirmation back to POS System
        return new Response(
            JSON.stringify({ 
                success: true, 
                ride_id: newRide.id,
                status: "searching_for_driver",
                message: `Headless Dispatch initiated for ${merchant.name} to ${destination_address}.`
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("merchant_gateway error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
