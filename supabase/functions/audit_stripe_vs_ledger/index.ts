import Stripe from "https://esm.sh/stripe@13";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (cronSecret) {
    const provided = authHeader?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = now - 86400;

    const stripeIntents = await stripe.paymentIntents.list({
      limit: 100,
      created: { gte: twentyFourHoursAgo },
    });

    const { data: ledgerEntries } = await supabase
      .from("payment_ledger")
      .select("stripe_event_id, provider_ref");

    const ledgerByProviderRef = new Map(
      (ledgerEntries || []).map((e: any) => [e.provider_ref, e.stripe_event_id])
    );

    const missing: Array<{ stripe_id: string; amount: number; created: number }> = [];

    for (const pi of stripeIntents.data) {
      if (pi.status === "succeeded" && !ledgerByProviderRef.has(pi.id)) {
        missing.push({ stripe_id: pi.id, amount: pi.amount, created: pi.created });
      }
    }

    if (missing.length > 0) {
      console.warn(`audit_stripe_vs_ledger: ${missing.length} orphaned PaymentIntents found`);

      for (const item of missing) {
        await supabase.from("system_alerts").insert({
          type: "RECONCILIATION_FAILURE",
          severity: "CRITICAL",
          title: `Orphaned Stripe payment: ${item.stripe_id}`,
          details: {
            stripe_id: item.stripe_id,
            amount_cents: item.amount,
            amount_dollars: (item.amount / 100).toFixed(2),
            created_unix: item.created,
            created_iso: new Date(item.created * 1000).toISOString(),
          },
        });
      }
    }

    return new Response(
      JSON.stringify({
        status: "audited",
        checked_count: stripeIntents.data.length,
        missing_count: missing.length,
        orphaned_ids: missing.map((m) => m.stripe_id),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("audit_stripe_vs_ledger error:", error);
    return new Response(
      JSON.stringify({ status: "error", error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
