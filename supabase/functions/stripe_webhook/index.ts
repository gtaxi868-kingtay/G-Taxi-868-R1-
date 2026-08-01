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
                .select("id, merchant_id, total_cents, delivery_fee_cents")
                .eq("id", orderId)
                .single();

            if (orderErr || !order) {
                console.error("stripe_webhook: Order not found:", orderId);
                return new Response("Order not found", { status: 404 });
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

            // Split: subtotal → merchant (85%), delivery fee → platform margin
            // Driver paid separately from delivery fee funds when delivery completes
            const subTotalCents = order.total_cents - (order.delivery_fee_cents ?? 0);
            const COMMISSION_RATE = 0.15;
            const merchantCutCents = Math.round(subTotalCents * (1 - COMMISSION_RATE));
            const platformFeeCents = order.total_cents - merchantCutCents;

            if (merchantId) {
                const { data: merchant } = await supabaseAdmin
                    .from("merchants")
                    .select("created_by")
                    .eq("id", merchantId)
                    .single();

                if (merchant?.created_by) {
                    await supabaseAdmin.rpc('process_wallet_credit_idempotent', {
                        p_user_id: merchant.created_by,
                        p_amount_cents: merchantCutCents,
                        p_reference_id: event.id + '_merchant',
                        p_provider: 'stripe',
                    }).then((__r) => __r, e => console.error("Merchant credit failed:", e));
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

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
