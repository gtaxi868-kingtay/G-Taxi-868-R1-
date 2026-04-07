// Supabase Edge Function: stripe_webhook
// Phase 6 Fix 6.5 — Handles Stripe webhook events for payment processing.
//
// Security rules (MUST follow CLAUSE 5 in CLAUDE.md):
//   - req.text() is called FIRST — before ANY JSON parsing.
//   - Stripe signature verified using raw body string.
//   - If signature check fails, return 400 immediately.
//   - Idempotency enforced via payment_ledger.stripe_event_id UNIQUE constraint.
//
// Events handled:
//   payment_intent.succeeded   — capture ledger entry, update ride payment_status,
//                                credit driver 81% and platform 19% via wallet_transactions.
//   payment_intent.payment_failed — log failure, do not complete ride.
//
// Register this URL in Stripe dashboard:
//   https://[project-ref].supabase.co/functions/v1/stripe_webhook
//   Events: payment_intent.succeeded, payment_intent.payment_failed

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

// Platform account UUID — receives 19% commission on card rides
const PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000";

Deno.serve(async (req: Request) => {
    // ── MUST call req.text() BEFORE any JSON parsing (CLAUDE.md rule 5) ─────
    // Stripe signature verification requires the raw, unmodified request body.
    // If you parse first, the body is consumed/transformed and verification fails.
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
        console.error("stripe_webhook: Missing stripe-signature header");
        return new Response("Missing stripe-signature header", { status: 400 });
    }

    // ── Signature Verification ────────────────────────────────────────────────
    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (error: any) {
        console.error("stripe_webhook error:", error);
        await captureException(error, { function: 'stripe_webhook' });
        return new Response("Webhook signature verification failed", { status: 400 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Idempotency Check — Stripe retries failed webhooks ───────────────────
    // The stripe_event_id column has a UNIQUE constraint, so duplicate events
    // cannot be inserted. We pre-check to short-circuit without touching DB.
    const { data: existing } = await supabaseAdmin
        .from("payment_ledger")
        .select("id")
        .eq("stripe_event_id", event.id)
        .maybeSingle();

    if (existing) {
        // Already processed — return 200 so Stripe stops retrying.
        return new Response(JSON.stringify({ status: "already_processed" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }

    // ── Event Handlers ────────────────────────────────────────────────────────

    if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as Stripe.PaymentIntent;

        const eventType = pi.metadata?.type;

        if (eventType === 'wallet_topup') {
            // Handle wallet top-up
            const userId = pi.metadata?.user_id;
            if (!userId) {
                return new Response("Missing user_id in wallet_topup metadata", { status: 400 });
            }

            const topupAmountCents = pi.amount;

            // Write ledger entry
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

            // Credit rider wallet
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
                return new Response('Wallet credit failed', { status: 500 });
            }

            return new Response(JSON.stringify({ status: 'wallet_topup_processed' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const rideId = pi.metadata?.ride_id;
        const userId = pi.metadata?.user_id;

        if (!rideId || !userId) {
            console.error("stripe_webhook: PaymentIntent missing ride_id or user_id in metadata", pi.id);
            return new Response("Missing metadata", { status: 400 });
        }

        // Fetch ride to get driver_id for the split
        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("id, driver_id, rider_id, total_fare_cents, drivers:driver_id(commission_tier, custom_commission_rate)")
            .eq("id", rideId)
            .single();

        if (rideError || !ride) {
            console.error("stripe_webhook: Ride not found for ride_id:", rideId);
            return new Response("Ride not found", { status: 404 });
        }

        // Amount Stripe confirmed (in cents — pi.amount is already in smallest unit)
        const totalCents = pi.amount;

        // Dynamic Split: pioneer (19%), standard (22%), etc.
        let commissionRate = 0.22;
        const driverData = ride.drivers as any;
        if (driverData) {
            if (driverData.custom_commission_rate != null) {
                commissionRate = driverData.custom_commission_rate / 100;
            } else if (driverData.commission_tier === 'pioneer') {
                commissionRate = 0.19;
            } else if (driverData.commission_tier === 'top_earner') {
                commissionRate = 0.17;
            }
        }

        const platformFeeCents = Math.round(totalCents * commissionRate);
        const driverNetCents = totalCents - platformFeeCents;

        // ── A: Write canonical ledger entry (rider's payment) ─────────────────
        const { error: ledgerError } = await supabaseAdmin
            .from("payment_ledger")
            .insert({
                ride_id: rideId,
                user_id: userId,
                amount: totalCents / 100.0,
                currency: pi.currency.toUpperCase(),
                status: "captured",
                provider: "stripe",
                provider_ref: pi.id,
                stripe_event_id: event.id,
            });

        if (ledgerError) {
            console.error("stripe_webhook: Failed to insert payment_ledger:", ledgerError);
            return new Response("Ledger insert failed", { status: 500 });
        }

        // ── B: Credit driver wallet (81%) ─────────────────────────────────────
        const { error: driverCreditError } = await supabaseAdmin
            .from("wallet_transactions")
            .insert({
                user_id: ride.driver_id,
                ride_id: rideId,
                amount: driverNetCents,
                transaction_type: "driver_payout",
                description: `Card ride earnings (${(100 - commissionRate * 100).toFixed(0)}%)`,
                status: "completed",
            });

        if (driverCreditError) {
            console.error("stripe_webhook: Driver wallet credit failed:", driverCreditError);
            // Don't return error — ledger entry succeeded; reconcile manually.
        }

        // ── C: Credit platform account (19%) ──────────────────────────────────
        const { error: platformCreditError } = await supabaseAdmin
            .from("wallet_transactions")
            .insert({
                user_id: PLATFORM_ACCOUNT,
                ride_id: rideId,
                amount: platformFeeCents,
                transaction_type: "platform_commission",
                description: `Platform commission (${(commissionRate * 100).toFixed(0)}%) for card ride`,
                status: "completed",
            });

        if (platformCreditError) {
            console.error("stripe_webhook: Platform wallet credit failed:", platformCreditError);
            // Don't return error — ledger entry succeeded; reconcile manually.
        }

        // ── D: Mark ride payment as captured ──────────────────────────────────
        const { error: rideUpdateError } = await supabaseAdmin
            .from("rides")
            .update({ payment_status: "captured" })
            .eq("id", rideId);

        if (rideUpdateError) {
            console.error("stripe_webhook: Failed to update ride payment_status:", rideUpdateError);
        }

        console.log(`stripe_webhook: payment_intent.succeeded processed for ride ${rideId}`);
    }

    if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as Stripe.PaymentIntent;
        const rideId = pi.metadata?.ride_id;

        // Log failure — do not complete the ride, do not write a captured ledger entry.
        console.error(`stripe_webhook: payment_intent.payment_failed for ride ${rideId ?? "unknown"}, PI: ${pi.id}`);

        // Optionally update ride payment_status to 'failed' so the app can surface the error.
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
