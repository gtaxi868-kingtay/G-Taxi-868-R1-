import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

    const { merchant_tag_uid, amount_cents } = await req.json();

    if (!merchant_tag_uid) return json({ success: false, error: "merchant_tag_uid is required" }, 400);
    if (!amount_cents || amount_cents <= 0) return json({ success: false, error: "amount_cents must be positive" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const access = await checkVerticalAccess(admin, user.id, "tap");
    if (!access.allowed) {
      return json({ success: false, error: access.reason }, 403);
    }

    const tagUid = String(merchant_tag_uid).replace(/^https?:\/\/[^\/]+\/(node|nfc)\//, "").trim();

    const { data: kioskNode, error: nodeError } = await admin
      .from("kiosk_nodes")
      .select("merchant_id, location_name, merchants!inner(id, name, is_active)")
      .eq("tag_uid", tagUid)
      .eq("is_active", true)
      .not("merchant_id", "is", null)
      .maybeSingle();

    if (nodeError) {
      console.error("kiosk node lookup error:", nodeError);
      return json({ success: false, error: "Failed to look up merchant tag" }, 500);
    }

    if (!kioskNode) {
      return json({ success: false, error: "Merchant tag not found. Scan a valid merchant NFC tag." }, 404);
    }

    const merchantId = (kioskNode.merchants as any).id;
    const merchantName = (kioskNode.merchants as any).name;
    const locationName = kioskNode.location_name || merchantName;

    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "rider_wallet_payment",
      {
        p_user_id: user.id,
        p_merchant_id: merchantId,
        p_amount_cents: amount_cents,
        p_merchant_name: locationName,
      }
    );

    if (rpcError) {
      console.error("rider_wallet_payment RPC error:", rpcError);
      return json({ success: false, error: "Payment processing failed" }, 500);
    }

    const result = typeof rpcResult === 'object' ? rpcResult : {};

    if (!result?.success) {
      return json({ success: false, error: result?.error_message || "Payment failed" }, 402);
    }

    await admin.rpc("record_rider_activity", {
      p_rider_id: user.id, p_event_type: "nfc_tap",
      p_amount_cents: amount_cents, p_ride_id: null,
      p_metadata: { merchant_id: merchantId, transaction_id: result.transaction_id },
    }).then(null, () => {});

    return json({
      success: true,
      data: {
        transaction_id: result.transaction_id,
        rider_name: result.rider_name,
        rider_balance_after: result.rider_balance_after,
        amount_cents,
        amount_formatted: `TTD $${(amount_cents / 100).toFixed(2)}`,
        merchant_name: merchantName,
      },
    });
  } catch (err: any) {
    console.error("rider_nfc_pay error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
