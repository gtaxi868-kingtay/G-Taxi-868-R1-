// Supabase Edge Function: create_stripe_customer
// Phase 14 Fix 14.2 — Automatically creates a Stripe Customer for every new G-Taxi user.

import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
    try {
        const { record } = await req.json();

        if (!record || !record.id || !record.email) {
            return new Response("Invalid payload", { status: 400 });
        }

        console.log(`Creating Stripe customer for user: ${record.id} (${record.email})`);

        // 1. Create the customer in Stripe
        const customer = await stripe.customers.create({
            email: record.email,
            name: record.full_name || record.email,
            metadata: {
                supabase_id: record.id
            }
        });

        // 2. Save the customer ID back to the profile
        const { error } = await supabaseAdmin
            .from("profiles")
            .update({ stripe_customer_id: customer.id })
            .eq("id", record.id);

        if (error) {
            console.error(`Failed to save stripe_customer_id: ${error.message}`);
            return new Response("Database update failed", { status: 500 });
        }

        console.log(`Successfully created Stripe customer: ${customer.id}`);
        return new Response(JSON.stringify({ stripe_customer_id: customer.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("create_stripe_customer error:", err.message);
        return new Response(err.message, { status: 500 });
    }
});
