import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.10.0";
import { captureException } from "../_shared/sentry.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_placeholder", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    // Only allow POST (or could be triggered via pg_cron GET if configured so, let's allow both for cron)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Find all Net-30 merchants with outstanding debt
    const { data: merchants, error: merchantsErr } = await supabaseAdmin
      .from("merchants")
      .select("id, business_name, stripe_customer_id, current_debt_cents")
      .eq("billing_type", "net-30")
      .gt("current_debt_cents", 0);

    if (merchantsErr) throw merchantsErr;

    if (!merchants || merchants.length === 0) {
      return new Response(JSON.stringify({ message: "No outstanding net-30 invoices to generate." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const results = [];

    for (const merchant of merchants) {
      try {
        let customerId = merchant.stripe_customer_id;

        // If merchant has no Stripe customer ID, we skip or create one
        if (!customerId) {
          const customer = await stripe.customers.create({
            name: merchant.business_name,
            metadata: { merchant_id: merchant.id },
          });
          customerId = customer.id;
          await supabaseAdmin
            .from("merchants")
            .update({ stripe_customer_id: customerId })
            .eq("id", merchant.id);
        }

        // Create an invoice item for the outstanding debt
        await stripe.invoiceItems.create({
          customer: customerId,
          amount: merchant.current_debt_cents,
          currency: "ttd",
          description: `G-Taxi Platform B2B Billing (Net-30) - Outstanding Balance`,
        });

        // Generate the invoice
        const invoice = await stripe.invoices.create({
          customer: customerId,
          collection_method: "send_invoice",
          days_until_due: 30, // Net-30
          metadata: { merchant_id: merchant.id },
        });

        // Send the invoice automatically
        await stripe.invoices.sendInvoice(invoice.id);

        // Reset the merchant's current debt in the database
        await supabaseAdmin
          .from("merchants")
          .update({ current_debt_cents: 0 })
          .eq("id", merchant.id);

        // Record the invoice in the platform ledger
        await supabaseAdmin.from("platform_revenue_logs").insert({
          merchant_id: merchant.id,
          gross_cents: merchant.current_debt_cents,
          payout_cents: 0,
          merchant_earnings_cents: 0,
          reserve_cents: Math.round(merchant.current_debt_cents * 0.015), // War chest contribution
          status: "invoiced", // custom status
          metadata: { stripe_invoice_id: invoice.id }
        });

        results.push({ merchant_id: merchant.id, status: "success", invoice_id: invoice.id });
      } catch (err: any) {
        console.error(`Failed to process merchant ${merchant.id}:`, err);
        results.push({ merchant_id: merchant.id, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("generate_b2b_invoices error:", error);
    await captureException(error, { function: "generate_b2b_invoices" });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
