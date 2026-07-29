// Rider-facing G Spot: browse venues, join/pay for a membership, view
// status, generate a redeem code to show at the bar, cancel. Self-
// contained — no _shared/ imports — matching the established pattern
// for other rider-facing functions (generate_cash_code, redeem_cash_code).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Missing authorization" }, 401);

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ success: false, error: "Invalid token" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    switch (action) {
      case "list_venues": {
        const { data, error } = await supabase
          .from("g_spot_venues")
          .select("id, name, address, monthly_rent_cents, membership_price_cents, drink_subsidy_cap_cents")
          .eq("status", "active")
          .not("membership_price_cents", "is", null)
          .order("name");
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, venues: data ?? [] });
      }

      case "get_memberships": {
        const { data, error } = await supabase
          .from("g_spot_memberships")
          .select("id, venue_id, monthly_price_cents, drink_subsidy_cap_cents, drink_subsidy_used_cents, cycle_start, status, venue:venue_id(name, address)")
          .eq("profile_id", user.id)
          .order("created_at", { ascending: false });
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, memberships: data ?? [] });
      }

      case "join": {
        const { venue_id } = body;
        if (!venue_id) return json({ success: false, error: "venue_id required" }, 400);
        const { data, error } = await supabase.rpc("rider_join_g_spot_venue", {
          p_user_id: user.id,
          p_venue_id: venue_id,
        });
        if (error) return json({ success: false, error: error.message }, 400);
        return json({ success: true, membership: data });
      }

      case "cancel": {
        const { membership_id } = body;
        if (!membership_id) return json({ success: false, error: "membership_id required" }, 400);
        const { data, error } = await supabase.rpc("rider_cancel_g_spot_membership", {
          p_user_id: user.id,
          p_membership_id: membership_id,
        });
        if (error) return json({ success: false, error: error.message }, 400);
        return json({ success: true, membership: data });
      }

      case "generate_redeem_code": {
        const { membership_id } = body;
        if (!membership_id) return json({ success: false, error: "membership_id required" }, 400);
        const { data, error } = await supabase.rpc("g_spot_generate_redeem_code", {
          p_user_id: user.id,
          p_membership_id: membership_id,
        });
        if (error) return json({ success: false, error: error.message }, 400);
        return json({ success: true, code: data });
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("g_spot error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
});
