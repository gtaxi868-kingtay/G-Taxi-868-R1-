// Supabase Edge Function: redeem_cash_code
// Driver or agent redeems a cash withdrawal code.
// Driver enters the code → rider gets their cash.
// Agent (admin/commander) can redeem on behalf of a rider.
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

    // Check role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .catch(() => ({ data: null }));

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { code, agent_id } = body;

    if (!code) {
      return new Response(JSON.stringify({ error: "code is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the redeemer is the driver assigned to the code, or an admin/commander
    const { data: codeRecord } = await supabase
      .from("cash_withdrawal_codes")
      .select("id, driver_id, amount_cents, status, expires_at")
      .eq("code", code.toUpperCase())
      .single()
      .catch(() => ({ data: null }));

    if (!codeRecord) {
      return new Response(JSON.stringify({ error: "Code not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (codeRecord.status !== "active") {
      return new Response(JSON.stringify({ error: `Code is ${codeRecord.status}`, status: codeRecord.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(codeRecord.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Code has expired" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the redeemer is the assigned driver, or has admin/commander role
    const isAssignedDriver = profile.role === "driver" && await (async () => {
      const { data: d } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", user.id)
        .single()
        .catch(() => ({ data: null }));
      return d?.id === codeRecord.driver_id;
    })();

    const isAdmin = profile.role === "admin";
    const isCommander = profile.role === "pod_commander";

    if (!isAssignedDriver && !isAdmin && !isCommander) {
      return new Response(JSON.stringify({ error: "Not authorized to redeem this code" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Redeem via RPC
    const { data: result, error: rpcError } = await supabase
      .rpc("redeem_cash_withdrawal_code", {
        p_code: code.toUpperCase(),
        p_agent_id: agent_id || user.id,
      });

    if (rpcError) {
      console.error("redeem_cash_withdrawal_code RPC error:", rpcError);
      return new Response(JSON.stringify({ error: "Failed to redeem code" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = typeof result === "string" ? JSON.parse(result) : result;

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify the rider that their code was redeemed
    const { data: codeFull } = await supabase
      .from("cash_withdrawal_codes")
      .select("user_id")
      .eq("id", parsed.code_id)
      .single()
      .catch(() => ({ data: null }));

    if (codeFull?.user_id) {
      const { data: riderProfile } = await supabase
        .from("profiles")
        .select("push_token")
        .eq("id", codeFull.user_id)
        .single()
        .catch(() => ({ data: null }));

      if (riderProfile?.push_token) {
        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: riderProfile.push_token,
              title: "Cash code redeemed",
              body: `Your cash withdrawal of $${(parsed.amount_cents / 100).toFixed(2)} TTD has been redeemed.`,
              data: { type: "cash_code_redeemed", amount_cents: parsed.amount_cents },
            }),
          });
        } catch { /* non-fatal */ }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          code_id: parsed.code_id,
          amount_cents: parsed.amount_cents,
          driver_id: parsed.driver_id,
          redeemed_at: parsed.redeemed_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("redeem_cash_code error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
