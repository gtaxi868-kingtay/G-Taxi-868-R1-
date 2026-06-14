import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const orderId = url.searchParams.get("order_id");
  const txnId = url.searchParams.get("transaction_id");
  const status = url.searchParams.get("status");
  const errorMsg = url.searchParams.get("error");

  console.log("[WiPay Webhook] Callback received:", { order_id: orderId, transaction_id: txnId, status, error: errorMsg });

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

  if (!orderId) {
    return serveHtml("Error", "Missing order_id in callback", "error");
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
    const updates: Record<string, unknown> = {
      payment_status: "captured",
    };
    if (txnId) {
      updates.wipay_transaction_id = txnId;
    }

    if (rideId) {
      const { error: updateError } = await supabaseAdmin
        .from("rides")
        .update(updates)
        .eq("id", rideId);

      if (updateError) {
        console.error("WiPay webhook: failed to update ride:", updateError);
      }
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
