// Supabase Edge Function: merchant_gateway
// THE HEADLESS ENTERPRISE API
// Allows POS systems (KFC / Subway) to programmatically summon G-Taxi drivers.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
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

function estimateFareCents(
    pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number,
    vehicleType: string,
    p?: { base: number; perKm: number; perMin: number; min: number }
): number {
    const distanceMeters = haversineMeters(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const durationMinutes = Math.max(8, (distanceMeters / 1000 / 28) * 60);
    const multiplier = VEHICLE_MULTIPLIERS[vehicleType] ?? VEHICLE_MULTIPLIERS.Standard;
    const b = p?.base ?? 1600, pk = p?.perKm ?? 175, pm = p?.perMin ?? 95, mn = p?.min ?? 2200;
    const fare = (b + (distanceMeters / 1000) * pk + durationMinutes * pm) * multiplier;
    return Math.max(mn, Math.round(fare));
}

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

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // SECURITY (H1): rate limit on the CALLER IP before touching the key, so a
        // failed key costs the attacker something. Previously checkRateLimit only
        // ran after a key validated, leaving the B2B key space brute-forceable for
        // free on a verify_jwt=false endpoint.
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("cf-connecting-ip")
            ?? "unknown";
        await enforceRateLimit(adminClient, `gw_ip_${ip}`, "merchant_gateway_auth", corsHeaders);

        // 2. Extract Authorization Bearer Token (The raw API Key)
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new Error("Missing or invalid Authorization header");
        }

        const rawKey = authHeader.split(" ")[1];
        const hashedKey = await hashKey(rawKey);

        // 3. Verify API Key
        const { data: apiKeyRef, error: keyError } = await adminClient
            .from("merchant_api_keys")
            .select("merchant_id, is_active")
            .eq("key_hash", hashedKey)
            .single();

        if (keyError || !apiKeyRef || !apiKeyRef.is_active) {
            throw new Error("Unauthorized: Invalid or revoked API Key");
        }

        // Update Last Used Timestamp
        await adminClient.from("merchant_api_keys")
             .update({ last_used_at: new Date().toISOString() })
             .eq("key_hash", hashedKey);

        await enforceRateLimit(adminClient, `merchant_${apiKeyRef.merchant_id}`, "merchant_gateway", corsHeaders);

        // 4. Fetch the Merchant Info
        const { data: merchant, error: merchantError } = await adminClient
            .from("merchants")
            .select("*")
            .eq("id", apiKeyRef.merchant_id)
            .single();

        if (merchantError || !merchant) throw new Error("Merchant not found");

        // M5: rides.rider_id is derived from merchants.created_by, which is NULL on
        // every live merchant row. Inserting a null rider orphans the ride and
        // breaks rider-scoped RLS downstream — refuse rather than write bad data.
        if (!merchant.created_by) {
            return new Response(
                JSON.stringify({ error: "Merchant has no linked owner account; cannot dispatch." }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 5. Parse the Payload from the B2B Provider (KFC POS)
        const {
            guest_name,
            guest_phone,
            destination_lat,
            destination_lng,
            destination_address,
            vehicle_type = "Standard",
        } = await req.json();

        if (destination_lat == null || destination_lng == null) {
            throw new Error("Missing destination coordinates");
        }
        if (merchant.lat == null || merchant.lng == null) {
            throw new Error("Merchant pickup coordinates are not configured");
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

        // 7. Read pricing config from DB
        const { data: pricingRows } = await adminClient
            .from("pricing_config")
            .select("key, value_cents")
            .then((__r) => __r, () => ({ data: null }));
        const pcfg: Record<string, number> = {};
        if (pricingRows) for (const r of pricingRows) pcfg[r.key] = r.value_cents;

        // 8. Dispatch the Headless Ride Request
        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();
        const fareCents = estimateFareCents(merchant.lat, merchant.lng, destination_lat, destination_lng, vehicle_type, {
            base: pcfg["BASE_FARE_CENTS"] ?? 1600,
            perKm: pcfg["PER_KM_CENTS"] ?? 175,
            perMin: pcfg["PER_MIN_CENTS"] ?? 95,
            min: pcfg["MIN_FARE_CENTS"] ?? 2200,
        });

        const { data: newRide, error: insertError } = await adminClient
            .from("rides")
            .insert({
                rider_id: merchant.created_by, 
                billed_to_merchant_id: billedMerchantId,
                pickup_lat: merchant.lat,
                pickup_lng: merchant.lng,
                pickup_address: merchant.name + " (" + merchant.address + ")",
                dropoff_lat: destination_lat,
                dropoff_lng: destination_lng,
                dropoff_address: destination_address,
                status: "searching",
                total_fare_cents: fareCents,
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
        // enforceRateLimit / auth helpers throw a ready-made Response (429/401)
        if (error instanceof Response) return error;
        // M3: log detail server-side, return an opaque message. This endpoint is
        // reachable unauthenticated, so error text is free reconnaissance.
        console.error("merchant_gateway error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Request failed" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});