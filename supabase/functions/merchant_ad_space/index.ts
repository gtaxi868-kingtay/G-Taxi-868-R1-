// Supabase Edge Function: merchant_ad_space
// Merchant ad-space subscription (founder decision 2026-09-26): a merchant
// pays TTD $500 once for 30 days of featured placement. A merchant who
// refers another merchant into buying it earns a cut (MERCHANT_AD_REFERRAL_CUT_BPS
// in pricing_config, default 10%) -- see migration
// 20260926150000_merchant_ad_space.sql for the schema and payout RPC.
//
// Same graceful-degrade pattern as every other WiPay-gated feature in this
// codebase (wipay_payment/index.ts): if WIPAY_ACCOUNT_NUMBER/WIPAY_API_KEY
// aren't set, this returns coming_soon rather than pretending to charge
// anyone. Activation (activate_merchant_ad_placement) is meant to be called
// by wipay_webhook once a real payment confirms -- not wired into that
// webhook yet, since there is nothing live to confirm until those keys exist.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Missing authorization header" }, 401);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ success: false, error: "Invalid or expired token" }, 401);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve the caller's own merchant row -- never trust a client-supplied
    // merchant_id, matching this project's own hard rule for edge functions.
    const { data: merchant, error: merchantError } = await adminClient
        .from("merchants")
        .select("id")
        .eq("created_by", user.id)
        .maybeSingle();

    if (merchantError || !merchant) {
        return json({ success: false, error: "No merchant account linked to this user" }, 403);
    }

    let body: { action?: string; referral_code?: string | null } = {};
    try {
        body = await req.json();
    } catch {
        // action-less GET-style calls (e.g. "status") may send no body
    }

    const action = body.action ?? "status";

    if (action === "get_referral_code") {
        const { data: code, error } = await adminClient.rpc("get_or_create_merchant_ad_referral_code", {
            p_merchant_id: merchant.id,
        });
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, referral_code: code });
    }

    if (action === "status") {
        const { data: active } = await adminClient
            .from("merchant_ad_placements")
            .select("id, status, starts_at, expires_at, referral_cut_cents")
            .eq("merchant_id", merchant.id)
            .eq("status", "active")
            .order("expires_at", { ascending: false })
            .maybeSingle();
        return json({ success: true, active_placement: active ?? null });
    }

    if (action === "purchase") {
        // 1. Create the pending placement + resolve any referral, server-side.
        const { data: reqResult, error: reqError } = await adminClient.rpc("request_merchant_ad_placement", {
            p_merchant_id: merchant.id,
            p_referral_code: body.referral_code ?? null,
        });
        if (reqError) return json({ success: false, error: reqError.message }, 500);
        if (!reqResult?.success) return json(reqResult, 400);

        const placementId: string = reqResult.placement_id;

        // 2. WiPay not yet configured -- same graceful coming_soon every
        // other card-payment path in this app already returns.
        if (!WIPAY_ACCOUNT_NUMBER || !WIPAY_API_KEY) {
            return json({
                success: false,
                status: "coming_soon",
                placement_id: placementId,
                error: "Ad-space payments are launching soon. Your spot is reserved -- we'll notify you when checkout is live.",
            });
        }

        // ── LIVE WiPay flow (activates once WIPAY_ACCOUNT_NUMBER/API_KEY are set) ──
        const orderId = `gtaxi-adspace-${placementId.slice(0, 8)}`;
        const wipayParams = new URLSearchParams({
            account_number: WIPAY_ACCOUNT_NUMBER,
            avs: "0",
            currency: "TTD",
            environment: WIPAY_ENV,
            fee_structure: "merchant_absorb",
            method: "credit_card",
            order_id: orderId,
            return_url: body["return_url" as keyof typeof body] as string ?? "",
            total: "500.00",
        });
        const redirectUrl = `${WIPAY_BASE_URL}?${wipayParams.toString()}`;

        return json({
            success: true,
            status: "redirect",
            redirect_url: redirectUrl,
            placement_id: placementId,
            order_id: orderId,
        });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
});
