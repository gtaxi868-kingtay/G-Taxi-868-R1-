// Supabase Edge Function: stripe_webhook
// ============================================================
// CAPITAL RESERVE LOCK — Stripe Payment Path (2026-05-22)
// ============================================================
// Settlement math (server-side only):
//   reserve      = round(gross * 0.015)     → capital_reserve_ledger
//   net          = gross - reserve
//   platform_fee = round(net * 0.185)       → platform wallet credit
//   driver_payout = net - platform_fee       → driver wallet credit
//
// Security rules (CLAUDE.md rule 5):
//   - req.text() is called FIRST — before any JSON parsing.
//   - Stripe signature verified using raw body string.
//   - Idempotency enforced via payment_ledger.stripe_event_id UNIQUE.
//   - On ANY partial failure, returns HTTP 500 so Stripe retries.
// ============================================================

import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET environment variable");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
});

const PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000";

function computeSettlement(grossCents: number): {
    reserveCents: number;
    platformFeeCents: number;
    driverNetCents: number;
} {
    const reserveCents = Math.round(grossCents * 0.015);
    const net = grossCents - reserveCents;
    const platformFeeCents = Math.round(net * 0.185);
    const driverNetCents = net - platformFeeCents;
    return { reserveCents, platformFeeCents, driverNetCents };
}

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

    // ── IDEMPOTENCY CHECK ──────────────────────────────────────────────
    // stripe_event_id UNIQUE constraint on payment_ledger prevents duplicates.
    // If event already processed, return 200 (idempotent success).
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

        // ── WALLET TOPUP ────────────────────────────────────────────────
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
                });

            if (ledgerError) {
                console.error('stripe_webhook: wallet topup ledger failed:', ledgerError);
                return new Response('Ledger insert failed', { status: 500 });
            }

            const { error: walletError } = await supabaseAdmin
                .from('wallet_transactions')
                .insert({
                    user_id: userId,
                    ride_id: null,
                    amount: topupAmountCents,
                    transaction_type: 'topup',
                    description: `Wallet top-up via card — $${(topupAmountCents / 100).toFixed(2)} TTD`,
                    status: 'completed',
                });

            if (walletError) {
                console.error('stripe_webhook: wallet credit failed:', walletError);
                // Rollback Step A so idempotency check doesn't swallow retry
                await supabaseAdmin
                    .from('payment_ledger')
                    .delete()
                    .eq('stripe_event_id', event.id)
                    .catch((e: unknown) => console.error('rollback failed:', e));
                return new Response('Wallet credit failed', { status: 500 });
            }

            return new Response(JSON.stringify({ status: 'wallet_topup_processed' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── RIDE PAYMENT ────────────────────────────────────────────────
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

        const { reserveCents, platformFeeCents, driverNetCents } = computeSettlement(totalCents);

        console.log(`stripe_webhook: Processing ride ${rideId}`, {
            gross: totalCents, reserve: reserveCents, platform: platformFeeCents, driver: driverNetCents,
        });

        // ── ATOMIC 6-STEP SETTLEMENT ───────────────────────────────────
        // All-or-nothing: if ANY step fails, return 500 so Stripe retries.
        // Idempotency (stripe_event_id UNIQUE) prevents duplicates on retry.

        const errors: string[] = [];

        // Step A: Write canonical ledger entry
        const { error: aErr } = await supabaseAdmin
            .from("payment_ledger")
            .insert({
                ride_id: rideId, user_id: userId,
                amount: totalCents / 100.0, currency: pi.currency.toUpperCase(),
                status: "captured", provider: "stripe",
                provider_ref: pi.id, stripe_event_id: event.id,
            });
        if (aErr) errors.push(`payment_ledger: ${aErr.message}`);

        // Step B: Credit driver wallet
        const { error: bErr } = await supabaseAdmin
            .from("wallet_transactions")
            .insert({
                user_id: ride.driver_id, ride_id: rideId,
                amount: driverNetCents, transaction_type: "driver_payout",
                description: "Card ride earnings", status: "completed",
            });
        if (bErr) errors.push(`driver_wallet: ${bErr.message}`);

        // Step C: Credit platform — operational fee
        const { error: cErr } = await supabaseAdmin
            .from("wallet_transactions")
            .insert({
                user_id: PLATFORM_ACCOUNT, ride_id: rideId,
                amount: platformFeeCents, transaction_type: "ride_payment",
                description: "Platform commission on card ride", status: "completed",
            });
        if (cErr) errors.push(`platform_fee_wallet: ${cErr.message}`);

        // Step D: Credit platform — capital reserve
        const { data: reserveTxn, error: dErr } = await supabaseAdmin
            .from("wallet_transactions")
            .insert({
                user_id: PLATFORM_ACCOUNT, ride_id: rideId,
                amount: reserveCents, transaction_type: "capital_reserve",
                description: "1.5% Capital Reserve (War Chest) on card ride",
                status: "completed",
            })
            .select("id")
            .single();
        if (dErr) errors.push(`reserve_wallet: ${dErr.message}`);

        // Step E: Write to capital_reserve_ledger
        const { error: eErr } = await supabaseAdmin
            .from("capital_reserve_ledger")
            .insert({
                ride_id: rideId, amount_cents: reserveCents,
                status: "locked", wallet_transaction_id: reserveTxn?.id || null,
                notes: "Card ride — reserve locked via Stripe settlement",
            });
        if (eErr) errors.push(`capital_reserve_ledger: ${eErr.message}`);

        // Step F: Mark ride as captured + store settlement breakdown
        const { error: fErr } = await supabaseAdmin
            .from("rides")
            .update({
                payment_status: "captured",
                driver_payout_cents: driverNetCents,
                reserve_cents: reserveCents,
                platform_fee_cents: platformFeeCents,
            })
            .eq("id", rideId);
        if (fErr) errors.push(`ride_update: ${fErr.message}`);

        // ── DECIDE: SUCCESS OR RETRY ───────────────────────────────────
        if (errors.length > 0) {
            console.error(`stripe_webhook: PARTIAL FAILURE for ride ${rideId}. ${errors.length}/6 steps failed.`, errors);
            await captureException(new Error(`Stripe settlement partial failure: ${errors.join('; ')}`), {
                function: 'stripe_webhook',
                ride_id: rideId,
                stripe_event_id: event.id,
                errors: errors.join(', '),
            });

            // ROLLBACK Step A: Delete the payment_ledger row so the idempotency
            // check on retry does NOT return 200 "already_processed".
            // Without this, Stripe retries would see the stripe_event_id exists,
            // early-return 200, and never execute Steps B-F.
            await supabaseAdmin
                .from("payment_ledger")
                .delete()
                .eq("stripe_event_id", event.id)
                .catch((rollbackErr: unknown) =>
                    console.error("stripe_webhook: Step A rollback failed (alert required):", rollbackErr)
                );

            // Write to system_alerts for human review
            await supabaseAdmin
                .from("system_alerts")
                .insert({
                    type: "PAYMENT_ANOMALY",
                    severity: "CRITICAL",
                    title: `Partial settlement failure on ride ${rideId}`,
                    details: {
                        stripe_event_id: event.id,
                        ride_id: rideId,
                        amount_cents: totalCents,
                        errors: errors,
                        committed_steps: 6 - errors.length,
                    },
                })
                .catch((alertErr: unknown) =>
                    console.error("stripe_webhook: system_alert insert failed:", alertErr)
                );

            return new Response(
                JSON.stringify({
                    received: false,
                    error: `Partial settlement failure: ${errors.join('; ')}`,
                    committed_steps: 6 - errors.length,
                    rollback: "Step A deleted for clean retry",
                }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        console.log(`stripe_webhook: ALL 6 STEPS COMMITTED for ride ${rideId}`, {
            gross: totalCents, reserve: reserveCents, platform: platformFeeCents, driver: driverNetCents,
        });
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
