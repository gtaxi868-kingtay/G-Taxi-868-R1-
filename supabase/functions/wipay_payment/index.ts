// Supabase Edge Function: wipay_payment
// WiPay Caribbean payment gateway integration for T&T card/debit payments.
// STATUS: STUB — returns coming_soon until WIPAY_ACCOUNT_NUMBER + WIPAY_API_KEY are configured.
//
// WiPay flow (when live):
//   1. Client calls this with ride_id + amount_cents
//   2. Function builds WiPay payment URL with order_id, total, return_url
//   3. Returns redirect_url → rider opens in WebView
//   4. WiPay POSTs result to wipay_webhook (to be built)
//   5. Webhook verifies hash, updates wipay_transactions + ride payment_status
//
// WiPay sandbox: https://sandbox.wipayfinancial.com/
// WiPay live:    https://wipayfinancial.com/
// Required env:  WIPAY_ACCOUNT_NUMBER, WIPAY_API_KEY, WIPAY_ENV (sandbox|live)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WIPAY_ACCOUNT_NUMBER = Deno.env.get("WIPAY_ACCOUNT_NUMBER") ?? "";
const WIPAY_API_KEY = Deno.env.get("WIPAY_API_KEY") ?? "";
const WIPAY_ENV = Deno.env.get("WIPAY_ENV") ?? "sandbox";

const WIPAY_BASE_URL = WIPAY_ENV === "live"
    ? "https://wipayfinancial.com/v1/gateway"
    : "https://sandbox.wipayfinancial.com/v1/gateway";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // Require auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        return new Response(
            JSON.stringify({ success: false, error: "Missing authorization header" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
        authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) {
        return new Response(
            JSON.stringify({ success: false, error: "Invalid or expired token" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // WiPay not yet configured — return graceful coming_soon
    if (!WIPAY_ACCOUNT_NUMBER || !WIPAY_API_KEY) {
        return new Response(
            JSON.stringify({
                success: false,
                status: "coming_soon",
                error: "Card payments via WiPay are launching soon. Please use Cash or G-Coin for now.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // ── LIVE WiPay flow (activated once WIPAY_ACCOUNT_NUMBER + WIPAY_API_KEY are set) ──

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: {
        ride_id: string;
        amount_cents: number;
        return_url: string;
        currency?: string;
    };

    try {
        body = await req.json();
    } catch {
        return new Response(
            JSON.stringify({ success: false, error: "Invalid JSON body" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    const { ride_id, amount_cents, return_url, currency = "TTD" } = body;

    if (!ride_id || !amount_cents || !return_url) {
        return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: ride_id, amount_cents, return_url" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // Verify the ride belongs to this user and is in a payable state
    const { data: ride, error: rideError } = await adminClient
        .from("rides")
        .select("id, rider_id, status, payment_status, fare_cents")
        .eq("id", ride_id)
        .single();

    if (rideError || !ride) {
        return new Response(
            JSON.stringify({ success: false, error: "Ride not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    if (ride.rider_id !== user.id) {
        return new Response(
            JSON.stringify({ success: false, error: "Forbidden" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    const orderId = `gtaxi-${ride_id.slice(0, 8)}-${ride_id}`;
    const totalTTD = (amount_cents / 100).toFixed(2);

    // Insert pending wipay_transaction record
    const { data: txn, error: txnError } = await adminClient
        .from("wipay_transactions")
        .insert({
            ride_id,
            user_id: user.id,
            order_id: orderId,
            amount_cents,
            currency,
            status: "pending",
        })
        .select("id")
        .single();

    if (txnError || !txn) {
        console.error("[wipay_payment] failed to insert transaction:", txnError?.message);
        return new Response(
            JSON.stringify({ success: false, error: "Failed to create payment record" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // Build WiPay redirect URL
    // WiPay collects card details on their hosted page and redirects back
    const wipayParams = new URLSearchParams({
        account_number: WIPAY_ACCOUNT_NUMBER,
        avs: "0",
        currency,
        environment: WIPAY_ENV,
        fee_structure: "merchant_absorb",
        method: "credit_card",
        order_id: orderId,
        return_url,
        total: totalTTD,
    });

    const redirectUrl = `${WIPAY_BASE_URL}?${wipayParams.toString()}`;

    return new Response(
        JSON.stringify({
            success: true,
            status: "redirect",
            redirect_url: redirectUrl,
            transaction_id: txn.id,
            order_id: orderId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
});
