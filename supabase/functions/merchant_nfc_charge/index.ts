import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { checkVerticalAccess } from "../_shared/verticalGate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);

    const { tag_uid: rawTag, amount_cents, merchant_id: rawMerchantId } = await req.json();

    if (!rawTag) return json({ success: false, error: "tag_uid is required" }, 400);
    if (!amount_cents || amount_cents <= 0) return json({ success: false, error: "amount_cents must be positive" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const tagUid = String(rawTag).replace(/^https?:\/\/[^\/]+\/(node|nfc)\//, "").trim();

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

    // Resolve the RIDER being charged (not the merchant caller) before the
    // transaction, so progression is gated on the actual party spending —
    // this is a merchant-initiated charge against a rider's NFC identity tag.
    const { data: identityTag } = await admin
      .from("identity_tags")
      .select("profile_id, profiles!inner(push_token, full_name)")
      .eq("tag_uid", tagUid)
      .eq("is_active", true)
      .maybeSingle();

    if (identityTag) {
      const access = await checkVerticalAccess(admin, identityTag.profile_id, "tap");
      if (!access.allowed) {
        return json({ success: false, error: access.reason }, 403);
      }
    }

    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "merchant_wallet_charge",
      {
        p_tag_uid: tagUid,
        p_amount_cents: amount_cents,
        p_merchant_id: merchantId,
        p_merchant_name: merchantName,
      }
    );

    if (rpcError) {
      console.error("merchant_wallet_charge RPC error:", rpcError);
      return json({ success: false, error: "Payment processing failed" }, 500);
    }

    const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

    if (!result?.success) {
      return json({
        success: false,
        error: result?.error_message || "Payment failed",
      }, 402);
    }

    if (identityTag) {
      const riderProfile = (identityTag as any).profiles as { push_token?: string; full_name?: string } | null;
      if (riderProfile?.push_token) {
        sendPushNotification(
          riderProfile.push_token,
          `Payment to ${merchantName}`,
          `TTD $${(amount_cents / 100).toFixed(2)} charged from your wallet`,
          { type: "merchant_purchase", merchant_name: merchantName, amount_cents: String(amount_cents) },
        ).catch((err) => console.error("push notification failed:", err));
      }

      await admin.rpc("record_rider_activity", {
        p_rider_id: identityTag.profile_id, p_event_type: "nfc_tap",
        p_amount_cents: amount_cents, p_ride_id: null,
        p_metadata: { merchant_id: merchantId, transaction_id: result.transaction_id },
      }).then(null, () => {});
    }

    return json({
      success: true,
      data: {
        transaction_id: result.transaction_id,
        rider_name: result.rider_name,
        rider_balance_after_cents: result.rider_balance_after,
        amount_cents,
        amount_formatted: `TTD $${(amount_cents / 100).toFixed(2)}`,
        merchant_name: merchantName,
      },
    });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("merchant_nfc_charge error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
