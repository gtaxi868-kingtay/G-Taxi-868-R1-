import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rateCheck = await checkRateLimit(supabaseAdmin, user.id, "create_order_payment_intent");
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ success: false, error: rateCheck.error }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, total_cents, rider_id, merchant_id, payment_status, stripe_payment_intent_id, status")
      .eq("id", order_id)
      .eq("rider_id", user.id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found or does not belong to this user" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.payment_status === "paid") {
      return new Response(JSON.stringify({ error: "Already paid" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.stripe_payment_intent_id) {
      try {
        const existingPI = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
        if (existingPI && existingPI.client_secret && !["canceled", "succeeded"].includes(existingPI.status)) {
          return new Response(JSON.stringify({ clientSecret: existingPI.client_secret }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        // PI doesn't exist in Stripe anymore, create new one
      }
    }

    if (order.total_cents <= 0) {
      return new Response(JSON.stringify({ error: "Order total is invalid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: order.total_cents,
      currency: "ttd",
      customer: profile?.stripe_customer_id,
      metadata: {
        order_id: order.id,
        user_id: user.id,
        merchant_id: order.merchant_id ?? "",
        type: "order_payment",
      },
      payment_method_types: ["card"],
    });

    let ephemeralKeySecret: string | undefined;
    if (profile?.stripe_customer_id) {
      try {
        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: profile.stripe_customer_id },
          { apiVersion: "2023-10-16" },
        );
        ephemeralKeySecret = ephemeralKey.secret;
      } catch {
        // non-critical
      }
    }

    await supabaseAdmin
      .from("orders")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_method: "card",
        payment_status: "pending",
      })
      .eq("id", order.id);

    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      customer: profile?.stripe_customer_id,
      ephemeralKey: ephemeralKeySecret,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("create_order_payment_intent error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
