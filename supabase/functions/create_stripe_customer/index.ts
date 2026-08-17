// Supabase Edge Function: create_stripe_customer
// Phase 14 Fix 14.2 — Automatically creates a Stripe Customer for every new G-Taxi user.
//
// SECURITY (C1): this is a DATABASE WEBHOOK, not a user-facing endpoint. It used to
// take `record.id` straight from the request body and write
// profiles.stripe_customer_id for that id, with no caller authentication at all.
//
// `verify_jwt = true` is NOT authentication here: the Supabase gateway accepts any
// JWT signed with the project secret, and the anon key is exactly such a JWT — and
// it is published in apps/qr-landing/index.html and apps/g868/app.js. Anyone could
// therefore point a victim's profile at a Stripe customer they controlled.
//
// Fix: require a shared secret that only the DB webhook knows, compared in constant
// time. If DB_WEBHOOK_SECRET is not configured the function refuses every request
// (fail closed) rather than falling back to the old open behaviour.

import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const DB_WEBHOOK_SECRET = Deno.env.get("DB_WEBHOOK_SECRET") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Constant-time comparison over SHA-256 digests: equal-length inputs, so no length
// or early-exit timing signal leaks the secret.
async function secretMatches(provided: string, expected: string): Promise<boolean> {
    if (!expected) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(provided)),
        crypto.subtle.digest("SHA-256", enc.encode(expected)),
    ]);
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
    try {
        if (!DB_WEBHOOK_SECRET) {
            // Fail closed: never revert to the unauthenticated behaviour.
            console.error("create_stripe_customer: DB_WEBHOOK_SECRET not configured — refusing all requests");
            return new Response("Not configured", { status: 503 });
        }

        const provided = req.headers.get("x-webhook-secret") ?? "";
        if (!(await secretMatches(provided, DB_WEBHOOK_SECRET))) {
            return new Response("Unauthorized", { status: 401 });
        }

        const { record } = await req.json();

        if (!record || !record.id || !record.email) {
            return new Response("Invalid payload", { status: 400 });
        }
        // Reject anything that is not a well-formed uuid before it reaches the DB.
        if (typeof record.id !== "string" || !UUID_RE.test(record.id)) {
            return new Response("Invalid payload", { status: 400 });
        }
        if (typeof record.email !== "string" || record.email.length > 320) {
            return new Response("Invalid payload", { status: 400 });
        }

        console.log(`Creating Stripe customer for user: ${record.id}`);

        // 1. Create the customer in Stripe
        const customer = await stripe.customers.create({
            email: record.email,
            name: typeof record.full_name === "string" && record.full_name.length <= 300
                ? record.full_name
                : record.email,
            metadata: {
                supabase_id: record.id
            }
        });

        // 2. Save the customer ID back to the profile, but never overwrite an
        //    existing one — re-pointing a live profile at a different Stripe
        //    customer is the exact impact this fix exists to prevent.
        const { data: updated, error } = await supabaseAdmin
            .from("profiles")
            .update({ stripe_customer_id: customer.id })
            .eq("id", record.id)
            .is("stripe_customer_id", null)
            .select("id");

        if (error) {
            console.error(`Failed to save stripe_customer_id: ${error.message}`);
            return new Response("Database update failed", { status: 500 });
        }
        if (!updated || updated.length === 0) {
            console.warn(`Profile ${record.id} already has a stripe_customer_id — leaving it unchanged`);
            return new Response(JSON.stringify({ skipped: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        console.log(`Successfully created Stripe customer: ${customer.id}`);
        return new Response(JSON.stringify({ stripe_customer_id: customer.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err: any) {
        // Log detail server-side; return an opaque message so DB/Stripe internals
        // are not handed to an unauthenticated caller.
        console.error("create_stripe_customer error:", err?.message ?? err);
        return new Response("Request failed", { status: 500 });
    }
});
