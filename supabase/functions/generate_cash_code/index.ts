// Supabase Edge Function: generate_cash_code
// Rider generates a cardless cash withdrawal code.
// Deducts from rider wallet immediately, creates time-limited code.
// Driver redeems code, hands rider cash.
// Auto-refund after 2h if unredeemed.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check rider has verified identity
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, verification_status")
      .eq("id", user.id)
      .single()
      .catch(() => ({ data: null }));

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.role !== "rider") {
      return new Response(JSON.stringify({ error: "Only riders can generate cash codes" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { driver_id, amount_cents } = await req.json();

    if (!driver_id || !amount_cents) {
      return new Response(JSON.stringify({ error: "driver_id and amount_cents are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (amount_cents < 5000) {
      return new Response(JSON.stringify({ error: "Minimum withdrawal is TTD $50 (5000 cents)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (amount_cents > 200000) {
      return new Response(JSON.stringify({ error: "Maximum withdrawal is TTD $2,000 (200,000 cents) per code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify driver exists and is active
    const { data: driver } = await supabase
      .from("drivers")
      .select("id, user_id, status, commission_debt_cents")
      .eq("id", driver_id)
      .single()
      .catch(() => ({ data: null }));

    if (!driver) {
      return new Response(JSON.stringify({ error: "Driver not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (driver.status !== "active") {
      return new Response(JSON.stringify({ error: "Driver is not active" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (driver.commission_debt_cents > 0) {
      return new Response(JSON.stringify({
        error: "Driver has outstanding commission debt",
        debt_cents: driver.commission_debt_cents,
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fee: TTD $2 per withdrawal
    const feeCents = 200;

    // Call DB RPC
    const { data: result, error: rpcError } = await supabase
      .rpc("generate_cash_withdrawal_code", {
        p_user_id: user.id,
        p_driver_id: driver_id,
        p_amount_cents: amount_cents,
        p_fee_cents: feeCents,
      });

    if (rpcError) {
      console.error("generate_cash_withdrawal_code RPC error:", rpcError);
      return new Response(JSON.stringify({ error: "Failed to generate code: " + rpcError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = typeof result === "string" ? JSON.parse(result) : result;

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          code: parsed.code,
          amount_cents: parsed.amount_cents,
          fee_cents: parsed.fee_cents,
          expires_at: parsed.expires_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("generate_cash_code error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
