// Supabase Edge Function: stripe_webhook — ATOMIC SETTLEMENT (2026-06-04)
// ============================================================
// Settlement math (server-side only, reads from pricing_config):
//   platform_fee = round(gross * plat_rate)     → platform wallet credit
//   reserve      = round(gross * reserve_rate)  → capital_reserve_ledger
//   driver_payout = gross - platform_fee - reserve
//   Defaults (82/15/3): plat_rate=0.15, reserve_rate=0.03
//
// Security rules:
//   - req.text() is called FIRST — before any JSON parsing.
//   - Stripe signature verified using raw body string.
//   - Idempotency enforced via processed_stripe_events table + advisory lock.
//   - Settlement uses a single Postgres RPC (atomic transaction).
// ============================================================

import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { secureFetch } from "../_shared/networkUtility.ts";

// ── ENV VAR GUARDS ───────────────────────────────────────────
function requireEnv(key: string): string {
    const value = Deno.env.get(key);
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = requireEnv("STRIPE_WEBHOOK_SECRET");

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req: Request) => {
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
        console.error("stripe_webhook: Missing stripe-signature header");
        return new Response("Missing stripe-signature header", { status: 400 });
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (error: any) {
        console.error("stripe_webhook signature error:", error);
        await captureException(error, { function: 'stripe_webhook' });
        return new Response("Webhook signature verification failed", { status: 400 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── IDEMPOTENCY CHECK (layer 1) ──────────────────────────
    // Both processed_stripe_events + payment_ledger stripe_event_id UNIQUE prevent duplicates.
    const { data: existing } = await supabaseAdmin
        .from("payment_ledger")
        .select("id")
        .eq("stripe_event_id", event.id)
        .maybeSingle();

    if (existing) {
        console.log(`stripe_webhook: Event ${event.id} already processed. Returning 200.`);
        return new Response(JSON.stringify({ status: "already_processed" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as Stripe.PaymentIntent;
        const eventType = pi.metadata?.type;

        // ── WALLET TOPUP ──────────────────────────────────────
        if (eventType === 'wallet_topup') {
            const userId = pi.metadata?.user_id;
            if (!userId) {
                return new Response("Missing user_id in wallet_topup metadata", { status: 400 });
            }

            const topupAmountCents = pi.amount;

            const { error: ledgerError } = await supabaseAdmin
                .from('payment_ledger')
                .insert({
                    ride_id: null,
                    user_id: userId,
                    amount: topupAmountCents / 100.0,
                    currency: pi.currency.toUpperCase(),
                    status: 'captured',
                    provider: 'stripe',
                    provider_ref: pi.id,
                    stripe_event_id: event.id,
                    processing_status: 'processing',
                });

            if (ledgerError) {
                console.error('stripe_webhook: wallet topup ledger failed:', ledgerError);
                return new Response('Ledger insert failed', { status: 500 });
            }

            const { data: creditSuccess, error: creditError } = await supabaseAdmin.rpc(
                'process_wallet_credit_idempotent',
                {
                    p_user_id: userId,
                    p_amount_cents: topupAmountCents,
                    p_reference_id: event.id,
                    p_provider: 'stripe',
                }
            );

            if (creditError) {
                await supabaseAdmin
                    .from('payment_ledger')
                    .update({ processing_status: 'failed' })
                    .eq('stripe_event_id', event.id)
                    .then((__r) => __r, err => console.error('Failed to mark ledger as failed:', err));
                console.error('stripe_webhook: wallet credit RPC failed:', creditError);
                return new Response('Wallet credit failed', { status: 500 });
            }

            if (creditSuccess === false) {
                console.log(`stripe_webhook: Duplicate topup blocked for event ${event.id}`);
                await supabaseAdmin
                    .from('payment_ledger')
                    .update({ processing_status: 'completed' })
                    .eq('stripe_event_id', event.id)
                    .then((__r) => __r, err => console.error('Failed to mark duplicate ledger as completed:', err));
                return new Response(JSON.stringify({ status: 'ignored_duplicate' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            await supabaseAdmin
                .from('payment_ledger')
                .update({ processing_status: 'completed' })
                .eq('stripe_event_id', event.id);

            return new Response(JSON.stringify({ status: 'wallet_topup_processed' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── ORDER PAYMENT (GROCERY/LAUNDRY etc.) ──────────────
        if (eventType === 'order_payment') {
            const orderId = pi.metadata?.order_id;
            const merchantId = pi.metadata?.merchant_id;
            const userId = pi.metadata?.user_id;

            if (!orderId || !userId) {
                return new Response("Missing order_id/user_id in order_payment metadata", { status: 400 });
            }

            const { data: order, error: orderErr } = await supabaseAdmin
                .from("orders")
                .select("id, merchant_id, total_cents, delivery_fee_cents, order_channel")
                .eq("id", orderId)
                .single();

            if (orderErr || !order) {
                console.error("stripe_webhook: Order not found:", orderId);
                return new Response("Order not found", { status: 404 });
            }

            // The order row is the authority — never the PI metadata. The
            // split below keys off order.merchant_id and the order's own
            // totals (register: stripe_webhook review block).
            if (pi.amount !== order.total_cents) {
                console.error("stripe_webhook: PI amount does not match order total:", {
                    order_id: orderId, pi_amount: pi.amount, order_total_cents: order.total_cents,
                });
                await captureException(
                    new Error(`stripe_webhook order amount mismatch: pi=${pi.amount} order=${order.total_cents}`),
                    { function: 'stripe_webhook', order_id: orderId },
                );
            }

            // Mark order as paid. NOTE: the value MUST be "captured" — the
            // live orders_payment_status_check constraint allows only
            // pending|authorized|captured|failed|refunded|cash_on_delivery.
            // This previously wrote "paid", which is not in that list, so the
            // UPDATE raised a check violation, this handler returned 500, and
            // the customer was charged at Stripe while the order stayed
            // "pending" and the merchant/driver split below never ran.
            // grocery/index.ts already uses "captured" for this same path.
            const { error: updateErr } = await supabaseAdmin
                .from("orders")
                .update({
                    payment_status: "captured",
                    paid_at: new Date().toISOString(),
                    payment_method: "card",
                })
                .eq("id", orderId);

            if (updateErr) {
                console.error("stripe_webhook: Failed to update order payment:", updateErr);
                return new Response("Order update failed", { status: 500 });
            }

            // Split (register #13): the rate is NOT a constant here. The
            // locked shop economics live in the database —
            // calculate_delivery_merchant_cut(order) reads orders.order_channel
            // + merchants.store_type and takes its rates from pricing_config
            // (direct 0%; marketplace grocery/pharmacy 5%, restaurant 10%,
            // other 8% — admin-tunable without a deploy). The previous flat
            // 15% contradicted those economics on every order.
            // Driver paid separately from delivery fee funds when delivery completes.
            const { data: cutRows, error: cutErr } = await supabaseAdmin
                .rpc('calculate_delivery_merchant_cut', { p_order_id: orderId });

            const cut = Array.isArray(cutRows) ? cutRows[0] : cutRows;
            if (cutErr || !cut) {
                console.error("stripe_webhook: calculate_delivery_merchant_cut failed:", cutErr);
                return new Response("Order split calculation failed", { status: 500 });
            }

            const merchantCutCents = cut.merchant_cut_cents;
            const platformFeeCents = order.total_cents - merchantCutCents;

            // Merchant identity comes from the fetched order row, never from
            // caller-supplied PI metadata.
            const orderMerchantId = order.merchant_id;
            if (orderMerchantId) {
                const { data: merchant } = await supabaseAdmin
                    .from("merchants")
                    .select("created_by")
                    .eq("id", orderMerchantId)
                    .single();

                if (merchant?.created_by) {
                    // PostgREST RPC failures resolve as { error }, not
                    // rejections — the old .then(ok, err) wrapper could never
                    // see them, so a failed credit was invisible while the
                    // ledger below still recorded completion. Await and check:
                    // on failure return 500 so Stripe retries (the credit is
                    // idempotent on event.id + '_merchant').
                    const { error: creditErr } = await supabaseAdmin.rpc('process_wallet_credit_idempotent', {
                        p_user_id: merchant.created_by,
                        p_amount_cents: merchantCutCents,
                        p_reference_id: event.id + '_merchant',
                        p_provider: 'stripe',
                    });
                    if (creditErr) {
                        console.error("stripe_webhook: Merchant credit failed:", creditErr);
                        await captureException(
                            new Error(`Merchant credit failed: ${creditErr.message}`),
                            { function: 'stripe_webhook', order_id: orderId },
                        );
                        return new Response("Merchant credit failed", { status: 500 });
                    }
                }
            }

            // Log to payment_ledger
            await supabaseAdmin
                .from('payment_ledger')
                .insert({
                    order_id: orderId,
                    user_id: userId,
                    amount: pi.amount / 100.0,
                    currency: pi.currency.toUpperCase(),
                    status: 'captured',
                    provider: 'stripe',
                    provider_ref: pi.id,
                    stripe_event_id: event.id,
                    processing_status: 'completed',
                });

            return new Response(JSON.stringify({ status: 'order_payment_processed' }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        // ── RIDE PAYMENT (ATOMIC SETTLEMENT) ──────────────────
        const rideId = pi.metadata?.ride_id;
        const userId = pi.metadata?.user_id;

        if (!rideId || !userId) {
            console.error("stripe_webhook: PaymentIntent missing ride_id or user_id in metadata", pi.id);
            return new Response("Missing metadata", { status: 400 });
        }

        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("id, driver_id, rider_id, total_fare_cents")
            .eq("id", rideId)
            .single();

        if (rideError || !ride) {
            console.error("stripe_webhook: Ride not found for ride_id:", rideId);
            return new Response("Ride not found", { status: 404 });
        }

        const totalCents = pi.amount;

        console.log(`stripe_webhook: Processing ride ${rideId}`, { gross: totalCents, ride });

        // ── SINGLE ATOMIC RPC CALL ────────────────────────────
        // All 6 settlement steps execute inside a single Postgres transaction
        // with advisory lock protection. If anything fails, EVERYTHING rolls back.
        const { data: result, error: settlementError } = await supabaseAdmin.rpc(
            'process_driver_settlement_atomic',
            {
                p_event_id: event.id,
                p_ride_id: rideId,
                p_driver_id: ride.driver_id,
                p_rider_id: ride.rider_id,
                p_gross_cents: totalCents,
                p_currency: pi.currency.toUpperCase(),
                p_provider_ref: pi.id,
            }
        );

        if (settlementError) {
            console.error(`stripe_webhook: Atomic settlement RPC failed for ride ${rideId}:`, settlementError);
            await captureException(
                new Error(`Atomic settlement RPC failed: ${settlementError.message}`),
                { function: 'stripe_webhook', ride_id: rideId, stripe_event_id: event.id }
            );
            return new Response(
                JSON.stringify({ received: false, error: `Settlement failed: ${settlementError.message}` }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        if (result?.status === 'SUCCESS') {
            console.log(`stripe_webhook: Atomic settlement SUCCESS for ride ${rideId}`, result);

            // Confirm processing_status was set by the RPC
            const { data: ledgerConfirm } = await supabaseAdmin
                .from('payment_ledger')
                .select('processing_status')
                .eq('stripe_event_id', event.id)
                .maybeSingle();

            if (ledgerConfirm && ledgerConfirm.processing_status !== 'completed') {
                console.warn(`stripe_webhook: processing_status is '${ledgerConfirm.processing_status}', correcting to 'completed'`);
                await supabaseAdmin
                    .from('payment_ledger')
                    .update({ processing_status: 'completed' })
                    .eq('stripe_event_id', event.id);
            }

            return new Response(JSON.stringify({ received: true, settlement: result, processing_status: 'completed' }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        // CONFLICT or other status — treat as failure so Stripe retries
        console.error(`stripe_webhook: Settlement result unexpected for ride ${rideId}:`, result);
        return new Response(
            JSON.stringify({ received: false, error: result?.error || 'Unknown settlement error' }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as Stripe.PaymentIntent;
        const rideId = pi.metadata?.ride_id;
        console.error(`stripe_webhook: payment_intent.payment_failed for ride ${rideId ?? "unknown"}, PI: ${pi.id}`);

        if (rideId) {
            await supabaseAdmin
                .from("rides")
                .update({ payment_status: "failed" })
                .eq("id", rideId);
        }
    }

    // ── B2B NET-30 INVOICE PAID ───────────────────────────────
    // generate_b2b_invoices stamps every invoice it issues with
    // metadata.source = 'g868_b2b_net30', merchant_id and a
    // debt_amount_cents snapshot, and writes a platform_revenue_logs
    // claim row (metadata.debt_status = 'invoiced') BEFORE sending it.
    // This handler is the only path that writes merchant debt down.
    //
    // Idempotency, two layers:
    //  1. The layer-1 check at the top of this handler dedupes exact
    //     redeliveries of this event id via payment_ledger (this
    //     handler writes a ledger row keyed on event.id below).
    //  2. Per-INVOICE once-only: Stripe can deliver different events
    //     for the same invoice payment, so the write-down runs only
    //     inside an atomic claim — a conditional UPDATE that flips
    //     the claim row's debt_status invoiced → paid. A second
    //     delivery (any event id) finds the row already 'paid', or
    //     loses the conditional update, and writes nothing down.
    // The reduction is capped at the invoiced snapshot and the debt
    // is floored at 0 — a write-down can never exceed what was billed
    // or drive the balance negative.
    // Invoices without our marker are foreign to this system: ack and
    // ignore; debt is never touched for them.
    if (event.type === "invoice.paid") {
        const invoice = event.data.object as Stripe.Invoice;
        const merchantId = invoice.metadata?.merchant_id;

        if (invoice.metadata?.source !== "g868_b2b_net30" || !merchantId) {
            console.log(`stripe_webhook: invoice.paid for ${invoice.id} carries no G868 B2B marker — ignoring.`);
            return new Response(JSON.stringify({ received: true, ignored: "not_b2b_invoice" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        const { data: claimRows, error: claimFetchErr } = await supabaseAdmin
            .from("platform_revenue_logs")
            .select("id, metadata")
            .eq("merchant_id", merchantId)
            .contains("metadata", { stripe_invoice_id: invoice.id })
            .limit(1);

        if (claimFetchErr) {
            console.error("stripe_webhook: B2B claim lookup failed:", claimFetchErr);
            return new Response("Claim lookup failed", { status: 500 });
        }

        const claim = claimRows?.[0] as { id: string; metadata: Record<string, unknown> } | undefined;

        if (!claim) {
            // Marker present but no claim row: there is no once-only
            // anchor, so writing down would be unsafe. Loud but acked —
            // Stripe retries cannot conjure the row; an admin must
            // reconcile this invoice manually.
            console.error(`stripe_webhook: B2B invoice ${invoice.id} has no platform_revenue_logs claim row — debt NOT written down.`);
            await captureException(
                new Error(`B2B invoice ${invoice.id} missing claim row`),
                { function: 'stripe_webhook', merchant_id: merchantId },
            );
            return new Response(JSON.stringify({ received: true, warning: "missing_claim_row" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (claim.metadata?.debt_status === "paid") {
            console.log(`stripe_webhook: B2B invoice ${invoice.id} already applied. Returning 200.`);
            return new Response(JSON.stringify({ status: "invoice_already_applied" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Claim the row: the conditional update only matches while the
        // row is still 'invoiced', so exactly one delivery wins it.
        const { data: claimedRows, error: claimErr } = await supabaseAdmin
            .from("platform_revenue_logs")
            .update({
                metadata: {
                    ...claim.metadata,
                    debt_status: "paid",
                    paid_stripe_event_id: event.id,
                    paid_at: new Date().toISOString(),
                },
            })
            .eq("id", claim.id)
            .filter("metadata->>debt_status", "eq", "invoiced")
            .select("id");

        if (claimErr) {
            console.error("stripe_webhook: B2B claim update failed:", claimErr);
            return new Response("Claim update failed", { status: 500 });
        }

        if (!claimedRows?.length) {
            console.log(`stripe_webhook: B2B invoice ${invoice.id} claim lost to a parallel delivery. Returning 200.`);
            return new Response(JSON.stringify({ status: "invoice_already_applied" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Write the debt down. If anything below fails, the claim is
        // reverted (best effort) before returning 500 so Stripe's retry
        // can redo the write-down instead of finding the row 'paid'
        // with the debt still standing.
        const unclaim = async () => {
            await supabaseAdmin
                .from("platform_revenue_logs")
                .update({ metadata: claim.metadata })
                .eq("id", claim.id)
                .then((__r) => __r, (err) => console.error("stripe_webhook: failed to revert B2B claim:", err));
        };

        const snapshotCents = Number(claim.metadata?.debt_amount_cents) || invoice.amount_paid || 0;
        const reductionCents = Math.min(invoice.amount_paid ?? 0, snapshotCents);

        const { data: merchantRow, error: merchantErr } = await supabaseAdmin
            .from("merchants")
            .select("current_debt_cents, created_by")
            .eq("id", merchantId)
            .single();

        if (merchantErr || !merchantRow) {
            console.error("stripe_webhook: B2B merchant not found:", merchantId, merchantErr);
            await unclaim();
            return new Response("Merchant not found", { status: 500 });
        }

        const newDebtCents = Math.max(0, (merchantRow.current_debt_cents ?? 0) - reductionCents);

        const { error: debtErr } = await supabaseAdmin
            .from("merchants")
            .update({ current_debt_cents: newDebtCents })
            .eq("id", merchantId);

        if (debtErr) {
            console.error("stripe_webhook: B2B debt write-down failed:", debtErr);
            await unclaim();
            return new Response("Debt write-down failed", { status: 500 });
        }

        // Audit trail in payment_ledger (the layer-1 dedupe anchor for
        // exact redeliveries of this event). Best-effort: the claimed
        // row above is the once-only guarantee, so a ledger failure is
        // logged, not fatal. payment_ledger.user_id is NOT NULL, so the
        // row is only written when the merchant has an owner account.
        if (merchantRow.created_by && reductionCents > 0) {
            const { error: ledgerErr } = await supabaseAdmin
                .from('payment_ledger')
                .insert({
                    ride_id: null,
                    order_id: null,
                    user_id: merchantRow.created_by,
                    amount: reductionCents / 100.0,
                    currency: (invoice.currency ?? 'ttd').toUpperCase(),
                    status: 'captured',
                    provider: 'stripe',
                    provider_ref: invoice.id,
                    stripe_event_id: event.id,
                    processing_status: 'completed',
                    metadata: { kind: 'b2b_invoice_payment', merchant_id: merchantId, stripe_invoice_id: invoice.id },
                });
            if (ledgerErr) {
                console.error("stripe_webhook: B2B payment_ledger insert failed (write-down already applied):", ledgerErr);
            }
        }

        console.log(`stripe_webhook: B2B invoice ${invoice.id} paid — merchant ${merchantId} debt reduced by ${reductionCents}c to ${newDebtCents}c.`);
        return new Response(JSON.stringify({
            status: 'b2b_invoice_paid',
            merchant_id: merchantId,
            reduction_cents: reductionCents,
            remaining_debt_cents: newDebtCents,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }

    // ── B2B NET-30 INVOICE PAYMENT FAILED ─────────────────────
    // Log + alert only. The claim row stays 'invoiced', the debt stays
    // on the merchant's books, and generate_b2b_invoices keeps refusing
    // to re-bill it while it is outstanding. Stripe's own dunning
    // drives the retry/collection side.
    if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.metadata?.source === "g868_b2b_net30") {
            console.error(`stripe_webhook: B2B invoice ${invoice.id} payment FAILED for merchant ${invoice.metadata?.merchant_id ?? "unknown"} — debt remains outstanding.`);
            await captureException(
                new Error(`B2B invoice payment failed: ${invoice.id}`),
                { function: 'stripe_webhook', merchant_id: invoice.metadata?.merchant_id },
            );
        }
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
