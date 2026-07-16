// Supabase Edge Function: apply_for_lease
// Driver applies for a Term Finance BYD lease through G-Taxi.
// Validates eligibility (500 rides, 4.8 rating), creates lease record
// with Proof of Income payload. Admin reviews and handles Term Finance handshake.
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    // Verify driver
    const { data: driver } = await supabase
      .from("drivers")
      .select("id, user_id, status, rating, vehicle_model, fleet_lease_id")
      .eq("user_id", user.id)
      .single();

    if (!driver) {
      return new Response(JSON.stringify({ error: "Driver not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (driver.fleet_lease_id) {
      return new Response(JSON.stringify({ error: "You already have an active lease or application" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fleet_vehicle_id, daily_deduction_cents, total_lease_cents } = await req.json();

    if (!fleet_vehicle_id) {
      return new Response(JSON.stringify({ error: "fleet_vehicle_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Apply via RPC
    const { data: result, error: rpcError } = await supabase
      .rpc("apply_for_driver_lease", {
        p_driver_id: driver.id,
        p_fleet_vehicle_id: fleet_vehicle_id,
        p_daily_deduction_cents: daily_deduction_cents || 15000,
        p_total_lease_cents: total_lease_cents || null,
      });

    if (rpcError) {
      return new Response(JSON.stringify({ error: "Failed to apply: " + rpcError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = typeof result === "string" ? JSON.parse(result) : result;

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error, detail: parsed }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify admins about new lease application
    const { data: admins } = await supabase
      .from("profiles")
      .select("push_token")
      .eq("role", "admin")
      .not("push_token", "is", null);

    for (const admin of admins ?? []) {
      try {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: admin.push_token,
            title: "New lease application",
            body: `${driver.vehicle_model || "A driver"} has applied for a BYD lease. Review in Admin > Fleet.`,
            data: { type: "lease_application", lease_id: parsed.data.lease_id },
          }),
        });
      } catch { }
    }

    return new Response(
      JSON.stringify({ success: true, data: parsed.data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("apply_for_lease error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
