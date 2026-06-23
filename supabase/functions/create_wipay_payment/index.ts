import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WIPAY_API_URL = Deno.env.get("WIPAY_API_URL") || "https://tt.wipayfinancial.com/plugins/payments/request";
const WIPAY_ACCOUNT_NUMBER = Deno.env.get("WIPAY_ACCOUNT_NUMBER") || "1234567890";
const WIPAY_ENVIRONMENT = Deno.env.get("WIPAY_ENVIRONMENT") || "sandbox";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");

  if (sessionId) {
    return serveCheckoutPage(sessionId);
  }

  return serveApi(req);
});

async function serveCheckoutPage(sessionId: string): Promise<Response> {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: session } = await supabaseAdmin
    .from("wipay_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return new Response("Session not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const formFields = session.form_fields as Record<string, string>;
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

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function serveApi(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { ride_id } = await req.json();
    if (!ride_id) {
      return new Response(
        JSON.stringify({ error: "ride_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("id, total_fare_cents, fare_amount, rider_id, status, payment_method, payment_status")
      .eq("id", ride_id)
      .eq("rider_id", user.id)
      .single();

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ error: "Ride not found or does not belong to this user" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ride.payment_method !== "wipay") {
      return new Response(
        JSON.stringify({ error: "This ride is not configured for WiPay payment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ride.payment_status === "captured") {
      return new Response(
        JSON.stringify({ error: "Payment already captured for this ride" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountCents = ride.total_fare_cents ?? Math.round((ride.fare_amount ?? 0) * 100);
    if (amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid fare amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountDollars = (amountCents / 100).toFixed(2);
    const orderId = `wipay_${ride.id}_${Date.now()}`;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/wipay_webhook`;

    const formFields = {
      account_number: WIPAY_ACCOUNT_NUMBER,
      country_code: "TT",
      currency: "TTD",
      environment: WIPAY_ENVIRONMENT,
      fee_structure: "customer_pay",
      method: "credit_card",
      order_id: orderId,
      origin: "g-taxi-rider",
      response_url: webhookUrl,
      total: amountDollars,
      avs: "0",
      data: JSON.stringify({ ride_id: ride.id, user_id: user.id }),
    };

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("wipay_sessions")
      .insert({
        ride_id: ride.id,
        user_id: user.id,
        order_id: orderId,
        form_fields: formFields,
        status: "pending",
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      console.error("Failed to create wipay session:", sessionError);
      return new Response(
        JSON.stringify({ error: "Failed to initialize payment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const checkoutUrl = `${SUPABASE_URL}/functions/v1/create_wipay_payment?session=${session.id}`;

    console.log("[WiPay] Created payment:", { ride_id: ride.id, amount: amountDollars, order_id: orderId });

    return new Response(
      JSON.stringify({
        success: true,
        checkout_url: checkoutUrl,
        order_id: orderId,
        amount_cents: amountCents,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create_wipay_payment error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
