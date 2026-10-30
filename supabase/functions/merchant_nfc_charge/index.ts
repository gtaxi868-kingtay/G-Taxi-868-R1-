import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { checkVerticalAccess } from "../_shared/verticalGate.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;



serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);

    // HARDENED CONTRACT (migration 20261030100000): a charge is only possible
    // against a single-use, amount-bound session the RIDER created while
    // signed in (rider_nfc_pay, action=create_charge_session). The old
    // contract — charge any wallet from a static printed tag_uid plus a
    // merchant-chosen amount — was a forgeable, replayable bearer credential
    // and is gone. The amount charged comes from the session, never from
    // this request body.
    const { session_id, merchant_id: rawMerchantId } = await req.json();

    if (!session_id) {
      return json({
        success: false,
        error: "session_id is required — the rider must authorise this charge first (rider_nfc_pay create_charge_session)",
      }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: merchant } = await admin
      .from("merchants")
      .select("id, name, created_by")
      .eq("created_by", user.id)
      .eq("is_active", true)
      .maybeSingle();

    let merchantId: string;
    let merchantName: string;

    if (merchant) {
      merchantId = merchant.id;
      merchantName = merchant.name;
    } else {
      const { data: staffRecord } = await admin
        .from("merchant_staff")
        .select("merchant_id, merchants!inner(id, name, is_active)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!staffRecord || !(staffRecord.merchants as any)?.is_active) {
        return json({ success: false, error: "Not a registered merchant" }, 403);
      }
      merchantId = (staffRecord.merchants as any).id;
      merchantName = (staffRecord.merchants as any).name;
    }

    if (rawMerchantId && rawMerchantId !== merchantId) {
      return json({ success: false, error: "Merchant ID mismatch" }, 403);
    }

    // Load the session to identify the RIDER being charged (for the
    // vertical gate and friendly errors). This read is advisory only —
    // merchant_wallet_charge_authorised re-validates everything under a
    // row lock and is the authoritative guard.
    const { data: session } = await admin
      .from("nfc_charge_sessions")
      .select("id, rider_id, merchant_id")
      .eq("id", session_id)
      .maybeSingle();

    if (!session) {
      return json({ success: false, error: "Charge session not found" }, 404);
    }

    if (session.merchant_id !== merchantId) {
      return json({ success: false, error: "Charge session belongs to a different merchant" }, 403);
    }

    // Gate progression on the actual party spending (the rider), as before.
    const access = await checkVerticalAccess(admin, session.rider_id, "tap");
    if (!access.allowed) {
      return json({ success: false, error: access.reason }, 403);
    }

    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "merchant_wallet_charge_authorised",
      {
        p_session_id: session_id,
        p_merchant_id: merchantId,
      }
    );

    if (rpcError) {
      console.error("merchant_wallet_charge_authorised RPC error:", rpcError);
      return json({ success: false, error: "Payment processing failed" }, 500);
    }

    const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

    if (!result?.success) {
      return json({
        success: false,
        error: result?.error_message || "Payment failed",
      }, 402);
    }

    // The amount is whatever the rider authorised in the session — the RPC
    // reports it back; nothing in this request can change it.
    const chargedAmount = result.amount_cents as number;

    const { data: riderProfile } = await admin
      .from("profiles")
      .select("push_token, full_name")
      .eq("id", session.rider_id)
      .maybeSingle();

    if (riderProfile?.push_token) {
      sendPushNotification(
        riderProfile.push_token,
        `Payment to ${merchantName}`,
        `TTD $${(chargedAmount / 100).toFixed(2)} charged from your wallet`,
        { type: "merchant_purchase", merchant_name: merchantName, amount_cents: String(chargedAmount) },
      ).catch((err) => console.error("push notification failed:", err));
    }

    await admin.rpc("record_rider_activity", {
      p_rider_id: session.rider_id, p_event_type: "nfc_tap",
      p_amount_cents: chargedAmount, p_ride_id: null,
      p_metadata: {
        merchant_id: merchantId, transaction_id: result.transaction_id,
        charge_session_id: session_id, already_consumed: result.already_consumed === true,
      },
    }).then(null, () => {});

    return json({
      success: true,
      data: {
        transaction_id: result.transaction_id,
        rider_name: result.rider_name,
        rider_balance_after_cents: result.rider_balance_after,
        amount_cents: chargedAmount,
        amount_formatted: `TTD $${(chargedAmount / 100).toFixed(2)}`,
        merchant_name: merchantName,
        already_consumed: result.already_consumed === true,
      },
    });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("merchant_nfc_charge error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
