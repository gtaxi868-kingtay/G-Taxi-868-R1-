// Supabase Edge Function: create_wallet_topup

import Stripe from "https://esm.sh/stripe@13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

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

        const { amount_ttd } = await req.json();

        if (typeof amount_ttd !== 'number') {
            return new Response(
                JSON.stringify({ error: "amount_ttd must be a number" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const amount_cents = Math.round(amount_ttd * 100);

        if (amount_cents < 2000) {
            return new Response(
                JSON.stringify({ error: "Minimum top-up amount is $20 TTD" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (amount_cents > 100000) {
            return new Response(
                JSON.stringify({ error: "Maximum top-up amount is $1000 TTD" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const createParams: any = {
            amount: amount_cents,
            currency: "ttd",
            metadata: {
                type: 'wallet_topup',
                user_id: user.id
            },
            payment_method_types: ["card"],
        };

        const stripeOptions: any = {
            idempotencyKey: `topup_${user.id}_${amount_cents}_${Date.now()}`
        };

        const paymentIntent = await stripe.paymentIntents.create(createParams, stripeOptions);

        return new Response(
            JSON.stringify({ clientSecret: paymentIntent.client_secret }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("create_wallet_topup error:", error);
        await captureException(error, { function: 'create_wallet_topup' });
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
