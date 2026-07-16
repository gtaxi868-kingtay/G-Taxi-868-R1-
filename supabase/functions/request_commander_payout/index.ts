// Supabase Edge Function: request_commander_payout
// Allows a Pod Commander to request a payout of their accrued revshare.
// Validates: commander is active, has a payout account, balance > 0.
// Creates a payout_requests row (commander_id set, payment_method='bank_transfer').
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

    // Verify commander role + active status
    const { data: commander, error: commanderError } = await supabase
      .from("pod_commanders")
      .select("id, user_id, status, territory_id, metrics")
      .eq("user_id", user.id)
      .single();

    if (commanderError || !commander) {
      return new Response(JSON.stringify({ error: "Commander not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (commander.status !== "active") {
      return new Response(JSON.stringify({ error: "Commander account is not active" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify they have a payout account
    const { data: payoutAccount } = await supabase
      .from("commander_payout_accounts")
      .select("id, bank_name, account_holder")
      .eq("commander_id", commander.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!payoutAccount) {
      return new Response(JSON.stringify({ error: "No payout account set up. Add bank details first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate accrued balance from commander_revshare_ledger
    const { data: balanceResult } = await supabase
      .rpc("get_commander_revshare_balance", { p_commander_id: commander.id })
      .catch(() => ({ data: 0 }));

    const accruedCents = (balanceResult as number) ?? 0;

    if (accruedCents < 10000) {
      return new Response(JSON.stringify({
        error: "Minimum payout is TTD $100",
        accrued_cents: accruedCents,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for existing pending payout
    const { data: existingPending } = await supabase
      .from("payout_requests")
      .select("id")
      .eq("commander_id", commander.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPending) {
      return new Response(JSON.stringify({ error: "You already have a pending payout request" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create payout request
    const { data: payoutRequest, error: insertError } = await supabase
      .from("payout_requests")
      .insert({
        commander_id: commander.id,
        amount_cents: accruedCents,
        status: "pending",
        payment_method: "bank_transfer",
        bank_details: {
          bank_name: payoutAccount.bank_name,
          account_holder: payoutAccount.account_holder,
        },
        description: `Commander revshare payout — territory ${commander.territory_id || "N/A"}`,
      })
      .select("id, amount_cents, status, created_at")
      .single();

    if (insertError) {
      console.error("Failed to create payout request:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create payout request" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: payoutRequest,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("request_commander_payout error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
