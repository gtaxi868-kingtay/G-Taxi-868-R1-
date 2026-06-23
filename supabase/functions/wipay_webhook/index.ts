import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WIPAY_WEBHOOK_SECRET = Deno.env.get("WIPAY_WEBHOOK_SECRET");

Deno.serve(async (req: Request) => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Require webhook secret or admin JWT
  const authHeader = req.headers.get("Authorization") || "";
  const webhookKey = req.headers.get("x-webhook-key") || "";
  const isValidWebhook = WIPAY_WEBHOOK_SECRET && webhookKey === WIPAY_WEBHOOK_SECRET;
  const isValidAdmin = authHeader.startsWith("Bearer ") && await (async () => {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) return false;
      const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
      return profile?.role === "admin";
    } catch { return false; }
  })();

  if (!isValidWebhook && !isValidAdmin) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const orderId = url.searchParams.get("order_id");
  const txnId = url.searchParams.get("transaction_id");
  const status = url.searchParams.get("status");
  const errorMsg = url.searchParams.get("error");

  console.log("[WiPay Webhook] Callback received:", { order_id: orderId, transaction_id: txnId, status, error: errorMsg });

  if (!orderId) {
    return serveHtml("Error", "Missing order_id in callback", "error");
  }

  // ── PAYOUT CALLBACK ────────────────────────────────────────
  if (orderId.startsWith("payout_")) {
    const { data: payout } = await supabaseAdmin
      .from("wipay_payouts")
      .select("id, status")
      .eq("wipay_reference", orderId)
      .maybeSingle();

    if (!payout) {
      console.error("[WiPay Webhook] Payout record not found for order_id:", orderId);
      return serveHtml("Error", "Payout record not found", "error");
    }

    if (status === "success" || status === "completed") {
      await supabaseAdmin
        .from("wipay_payouts")
        .update({
          status: "completed",
          wipay_transaction_id: txnId || null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", payout.id);

      await supabaseAdmin
        .from("payout_requests")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", payout.payout_request_id)
        .catch(() => {});

      console.log("[WiPay Webhook] Payout completed:", { payout_id: payout.id, transaction_id: txnId });
      return serveHtml("Payout Successful", "Driver payout has been sent to their bank account.", "success");
    }

    if (status === "cancelled" || status === "failed" || errorMsg) {
      await supabaseAdmin
        .from("wipay_payouts")
        .update({
          status: "failed",
          raw_response: JSON.stringify({ error: errorMsg || `Status: ${status}` }),
          failed_at: new Date().toISOString(),
        })
        .eq("id", payout.id);

      console.error("[WiPay Webhook] Payout failed:", { payout_id: payout.id, status, error: errorMsg });
      return serveHtml("Payout Failed", errorMsg || `Payout status: ${status || "unknown"}.`, "error");
    }

    return serveHtml("Processing", "Payout is being processed...", "info");
  }

  // ── PAYMENT SESSION CALLBACK (ride/grocery) ────────────────
  let rideId: string | null = null;
  let userId: string | null = null;

  const dataParam = url.searchParams.get("data");
  if (dataParam) {
    try {
      const parsed = JSON.parse(dataParam);
      rideId = parsed.ride_id;
      userId = parsed.user_id;
    } catch { }
  }

  const { data: session } = await supabaseAdmin
    .from("wipay_sessions")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (!rideId && session?.ride_id) {
    rideId = session.ride_id;
  }

  if (status === "success" || status === "completed") {
    const updates: Record<string, unknown> = { payment_status: "captured" };
    if (txnId) updates.wipay_transaction_id = txnId;

    if (rideId) {
      const { error: updateError } = await supabaseAdmin
        .from("rides")
        .update(updates)
        .eq("id", rideId);
      if (updateError) console.error("WiPay webhook: failed to update ride:", updateError);
    }

    if (session) {
      await supabaseAdmin
        .from("wipay_sessions")
        .update({ status: "completed", transaction_id: txnId || null })
        .eq("id", session.id);
    }

    console.log("[WiPay Webhook] Payment captured:", { ride_id: rideId, transaction_id: txnId });
    return serveHtml("Payment Successful", "Your payment has been processed. You can close this window.", "success");
  }

  if (status === "cancelled" || status === "failed" || errorMsg) {
    if (session) {
      await supabaseAdmin
        .from("wipay_sessions")
        .update({ status: "failed", error_message: errorMsg || `Status: ${status}` })
        .eq("id", session.id);
    }

    console.error("[WiPay Webhook] Payment failed:", { order_id: orderId, status, error: errorMsg });
    return serveHtml("Payment Failed", errorMsg || `Payment status: ${status || "unknown"}. Please try again.`, "error");
  }

  return serveHtml("Processing", "Payment is being processed...", "info");
});

function serveHtml(title: string, message: string, type: "success" | "error" | "info"): Response {
  const colors = { success: "#16A34A", error: "#DC2626", info: "#2563EB" };
  const html = `<!DOCTYPE html>
<html>
<head><title>${title} - G-Taxi</title></head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0D0B1E;color:#FFF;font-family:sans-serif;margin:0;">
  <div style="text-align:center;padding:40px;">
    <div style="width:64px;height:64px;border-radius:50%;background:${colors[type]};margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:32px;">
      ${type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"}
    </div>
    <h1 style="font-size:24px;margin:0 0 8px;">${title}</h1>
    <p style="color:#AEA9B5;margin:0;font-size:16px;">${message}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}