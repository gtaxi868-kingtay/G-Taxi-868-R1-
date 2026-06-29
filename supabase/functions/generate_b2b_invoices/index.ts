import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_placeholder", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function requireAdminInline(req: Request): Promise<void> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error } = await anon.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error: pErr } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (pErr || profile?.role !== 'admin') throw new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await requireAdminInline(req);

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

        await stripe.invoiceItems.create({
          customer: customerId,
          amount: merchant.current_debt_cents,
          currency: "ttd",
          description: `G-Taxi Platform B2B Billing (Net-30) - Outstanding Balance`,
        });

        const invoice = await stripe.invoices.create({
          customer: customerId,
          collection_method: "send_invoice",
          days_until_due: 30,
          metadata: { merchant_id: merchant.id },
        });

        await stripe.invoices.sendInvoice(invoice.id);

        await supabaseAdmin
          .from("merchants")
          .update({ current_debt_cents: 0 })
          .eq("id", merchant.id);

        await supabaseAdmin.from("platform_revenue_logs").insert({
          merchant_id: merchant.id,
          gross_cents: merchant.current_debt_cents,
          payout_cents: 0,
          merchant_earnings_cents: 0,
          reserve_cents: Math.round(merchant.current_debt_cents * 0.015),
          status: "invoiced",
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
