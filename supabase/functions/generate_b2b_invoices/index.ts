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
      .select("id, name, stripe_customer_id, current_debt_cents")
      .eq("billing_type", "net-30")
      .gt("current_debt_cents", 0);

    if (merchantsErr) throw merchantsErr;

    // Double-bill guard: a merchant whose debt was already invoiced and
    // whose invoice is still outstanding is NOT invoiced again. The debt
    // stays on merchants.current_debt_cents until the invoice is PAID
    // (the stripe_webhook invoice.paid path writes it down), so re-running
    // this function for such a merchant would bill the same debt twice.
    // The bookkeeping rows this function writes into
    // platform_revenue_logs (metadata.source = 'g868_b2b_net30',
    // metadata.debt_status = 'invoiced') are the record of what is
    // already billed. Fail closed: if the guard cannot be read, abort
    // the run rather than risk double-billing every merchant.
    const { data: outstandingRows, error: guardErr } = await supabaseAdmin
      .from("platform_revenue_logs")
      .select("merchant_id, metadata")
      .contains("metadata", { source: "g868_b2b_net30", debt_status: "invoiced" });

    if (guardErr) throw guardErr;

    const outstandingByMerchant = new Map<string, string>();
    for (const row of outstandingRows ?? []) {
      const invoiceId = (row.metadata as { stripe_invoice_id?: string } | null)?.stripe_invoice_id;
      if (row.merchant_id && invoiceId) outstandingByMerchant.set(row.merchant_id, invoiceId);
    }

    if (!merchants || merchants.length === 0) {
      return new Response(JSON.stringify({ message: "No outstanding net-30 invoices to generate." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const results = [];

    for (const merchant of merchants) {
      try {
        // Skip merchants already invoiced for this debt (see guard above):
        // their balance is only written down when that invoice is paid,
        // so invoicing again now would bill the same debt twice. Debt
        // accrued after the outstanding invoice was issued waits for the
        // next run after that invoice resolves — correct for net-30,
        // where the outstanding invoice is not due for 30 days anyway.
        const alreadyInvoiceId = outstandingByMerchant.get(merchant.id);
        if (alreadyInvoiceId) {
          results.push({ merchant_id: merchant.id, status: "skipped_already_invoiced", invoice_id: alreadyInvoiceId });
          continue;
        }

        let customerId = merchant.stripe_customer_id;

        if (!customerId) {
          const customer = await stripe.customers.create({
            name: merchant.name,
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
          metadata: { merchant_id: merchant.id, source: "g868_b2b_net30" },
        });

        // The invoice metadata is the contract with stripe_webhook:
        // source = 'g868_b2b_net30' marks this as an invoice THIS system
        // issued (the webhook never writes debt down for unmarked —
        // foreign — invoices on the same Stripe account), merchant_id
        // says whose debt it is, and debt_amount_cents snapshots the
        // balance being billed so the write-down on payment is capped
        // at exactly what was invoiced.
        const debtPeriod = `net30_balance_as_of_${new Date().toISOString().slice(0, 10)}`;
        const invoice = await stripe.invoices.create({
          customer: customerId,
          collection_method: "send_invoice",
          days_until_due: 30,
          metadata: {
            merchant_id: merchant.id,
            source: "g868_b2b_net30",
            debt_amount_cents: String(merchant.current_debt_cents),
            debt_period: debtPeriod,
          },
        });

        // Bookkeeping BEFORE send. This platform_revenue_logs row is the
        // claim the stripe_webhook invoice.paid path flips
        // (metadata.debt_status: invoiced → paid) to write the debt down
        // exactly once, and the row the guard above reads to refuse a
        // second invoice for already-billed debt. Column names are the
        // table's real ones — the previous insert targeted phantom
        // columns (gross_cents / payout_cents / merchant_earnings_cents /
        // status, none of which exist on platform_revenue_logs) and its
        // error was never checked, so the row silently never landed.
        // If this insert fails we do NOT send: an invoice with no claim
        // row can never be reconciled when it is paid. The Stripe invoice
        // stays an unsent draft — visible in the dashboard, harmless,
        // and this run reports the merchant as errored.
        const { error: logErr } = await supabaseAdmin.from("platform_revenue_logs").insert({
          merchant_id: merchant.id,
          gross_amount_cents: merchant.current_debt_cents,
          platform_fee_cents: 0,
          driver_payout_cents: 0,
          merchant_split_cents: 0,
          reserve_cents: Math.round(merchant.current_debt_cents * 0.015),
          metadata: {
            source: "g868_b2b_net30",
            stripe_invoice_id: invoice.id,
            debt_amount_cents: merchant.current_debt_cents,
            debt_period: debtPeriod,
            debt_status: "invoiced",
            invoiced_at: new Date().toISOString(),
          }
        });

        if (logErr) {
          throw new Error(`Bookkeeping insert failed; invoice ${invoice.id} left unsent: ${logErr.message}`);
        }

        await stripe.invoices.sendInvoice(invoice.id);

        // Debt is NOT cleared here. It clears when the invoice is PAID:
        // stripe_webhook's invoice.paid handler claims the bookkeeping
        // row above and writes merchants.current_debt_cents down once.
        // (The pre-wave-3A code zeroed the debt on send, so an unpaid or
        // ignored invoice erased the merchant's debt from the books.)

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
