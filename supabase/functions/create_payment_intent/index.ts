// Supabase Edge Function: create_payment_intent
// Phase 6 Fix 6.4 — Creates a Stripe PaymentIntent for a ride fare.
//
// Security rules:
//   - Auth required: caller must be authenticated (JWT resolved via auth.getUser)
//   - Ride ownership verified: ride.rider_id must match the authenticated user's id
//   - Only client_secret is returned — never the full PaymentIntent object
//   - STRIPE_SECRET_KEY lives only in Supabase edge function secrets
//
// Called by the rider app before rendering the Stripe card payment sheet.

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
        // ── Auth — resolve caller identity from JWT, never trust client ────────
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } }
        });

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: "Invalid or expired token" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const rateCheck = await checkRateLimit(supabaseAdmin, user.id, "create_payment_intent");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Parse Request ─────────────────────────────────────────────────────
        const { ride_id } = await req.json();

        if (!ride_id) {
            return new Response(
                JSON.stringify({ error: "ride_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Ride Ownership Check ──────────────────────────────────────────────
        // Fetch ride and verify it belongs to the authenticated user.
        // The .eq('rider_id', user.id) clause is the ownership assertion.

        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("id, fare_amount, total_fare_cents, rider_id, payment_method, payment_status, status")
            .eq("id", ride_id)
            .eq("rider_id", user.id)   // ← ownership: this ride must belong to this user
            .single();

        if (rideError || !ride) {
            return new Response(
                JSON.stringify({ error: "Ride not found or does not belong to this user" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Guard: only allow PI creation for card rides in valid states ───────
        if (ride.payment_method !== "card") {
            return new Response(
                JSON.stringify({ error: "This ride is not configured for card payment" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (ride.payment_status === "captured") {
            return new Response(
                JSON.stringify({ error: "Payment has already been captured for this ride" }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!["searching", "assigned", "arrived", "in_progress"].includes(ride.status)) {
            return new Response(
                JSON.stringify({ error: `Ride in status '${ride.status}' is not payable` }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Determine amount in cents ──────────────────────────────────────────
        // Prefer total_fare_cents (integer cents), fall back to fare_amount * 100.
        const amountCents: number = ride.total_fare_cents
            ?? Math.round((ride.fare_amount ?? 0) * 100);

        if (amountCents <= 0) {
            return new Response(
                JSON.stringify({ error: "Ride fare amount is invalid" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Create Stripe PaymentIntent ────────────────────────────────────────
        // amount is in the smallest currency unit (cents for TTD).
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: "ttd",
            metadata: {
                ride_id: ride.id,
                user_id: user.id,
            },
            payment_method_types: ["card"],
        });

        // ── Return ONLY the client_secret ─────────────────────────────────────
        // The client_secret lets the SDK confirm the payment without exposing
        // any server-side secret. Never return the full PaymentIntent.
        return new Response(
            JSON.stringify({ clientSecret: paymentIntent.client_secret }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("create_payment_intent error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
