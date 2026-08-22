import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WIPAY_API_URL = Deno.env.get("WIPAY_API_URL") || "https://tt.wipayfinancial.com/plugins/payments/request";
const WIPAY_ACCOUNT_NUMBER = Deno.env.get("WIPAY_ACCOUNT_NUMBER") || "1234567890";
const WIPAY_ENVIRONMENT = Deno.env.get("WIPAY_ENVIRONMENT") || "sandbox";
const BUYIN_AMOUNT_CENTS = 50000; // TTD $500.00

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const checkoutId = url.searchParams.get("checkout");
  if (checkoutId) return serveCheckoutPage(checkoutId);

  return serveApi(req);
});

// WiPay-hosted checkout is a plain POST-redirect form. Unlike create_wipay_payment
// this has no separate session table — commander_applications already holds
// everything the form needs, keyed by its own id.
async function serveCheckoutPage(applicationId: string): Promise<Response> {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: app } = await supabaseAdmin
    .from("commander_applications")
    .select("id, user_id, amount_cents, wipay_order_id, payment_status")
    .eq("id", applicationId)
    .single();

  if (!app) {
    return new Response("Application not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }
  if (app.payment_status === "paid") {
    return new Response("This application is already paid.", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  const amountDollars = (app.amount_cents / 100).toFixed(2);
  const webhookUrl = `${SUPABASE_URL}/functions/v1/wipay_webhook`;

  const formFields: Record<string, string> = {
    account_number: WIPAY_ACCOUNT_NUMBER,
    country_code: "TT",
    currency: "TTD",
    environment: WIPAY_ENVIRONMENT,
    fee_structure: "customer_pay",
    method: "credit_card",
    order_id: app.wipay_order_id,
    origin: "g-taxi-commander-buyin",
    response_url: webhookUrl,
    total: amountDollars,
    avs: "0",
    data: JSON.stringify({ application_id: app.id, user_id: app.user_id }),
  };

  let inputs = "";
  for (const [key, value] of Object.entries(formFields)) {
    inputs += `<input type="hidden" name="${key}" value="${value.replace(/"/g, "&quot;")}" />\n`;
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>Redirecting to WiPay...</title></head>
<body onload="document.forms[0].submit()" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0D0B1E;color:#FFF;font-family:sans-serif;">
  <form action="${WIPAY_API_URL}" method="POST">
    ${inputs}
    <p>Redirecting to secure payment...</p>
    <button type="submit">Continue to Payment</button>
  </form>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function serveApi(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Missing authorization header" }, 401);

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ success: false, error: "Invalid or expired token" }, 401);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existingCommander } = await supabaseAdmin
      .from("pod_commanders").select("id").eq("user_id", user.id).maybeSingle();
    if (existingCommander) return json({ success: false, error: "You are already a commander" }, 409);

    const { data: existingPending } = await supabaseAdmin
      .from("commander_applications").select("id, payment_status, wipay_order_id")
      .eq("user_id", user.id).eq("status", "pending").maybeSingle();

    // Already applied and paid — just resend the reference, don't double-charge.
    if (existingPending) {
      if (existingPending.payment_status === "paid") {
        return json({ success: false, error: "Your application is paid and awaiting admin review" }, 409);
      }
      const checkoutUrl = `${SUPABASE_URL}/functions/v1/commander_apply?checkout=${existingPending.id}`;
      return json({ success: true, application_id: existingPending.id, checkout_url: checkoutUrl, amount_cents: BUYIN_AMOUNT_CENTS });
    }

    const body = await req.json().catch(() => ({}));
    const { phone, whatsapp, area } = body;
    if (!phone || !area) return json({ success: false, error: "phone and area are required" }, 400);

    const { data: app, error: insertError } = await supabaseAdmin
      .from("commander_applications")
      .insert({
        user_id: user.id,
        phone,
        whatsapp: whatsapp || phone,
        area,
        amount_cents: BUYIN_AMOUNT_CENTS,
      })
      .select("id")
      .single();
    if (insertError || !app) {
      console.error("[commander_apply] insert failed:", insertError);
      return json({ success: false, error: "Failed to create application" }, 500);
    }

    const orderId = `commander_buyin_${app.id}`;
    const { error: updateError } = await supabaseAdmin
      .from("commander_applications").update({ wipay_order_id: orderId }).eq("id", app.id);
    if (updateError) {
      console.error("[commander_apply] failed to set order id:", updateError);
      return json({ success: false, error: "Failed to initialize payment" }, 500);
    }

    const checkoutUrl = `${SUPABASE_URL}/functions/v1/commander_apply?checkout=${app.id}`;
    console.log("[commander_apply] Created application:", { application_id: app.id, user_id: user.id, order_id: orderId });

    return json({ success: true, application_id: app.id, checkout_url: checkoutUrl, amount_cents: BUYIN_AMOUNT_CENTS });
  } catch (error) {
    console.error("commander_apply error:", error);
    return json({ success: false, error: "Internal server error" }, 500);
  }
}
