import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);

    const { package_id, party_size, time_preference, pickup_note } = await req.json();

    if (!package_id) {
      return new Response(JSON.stringify({ error: "package_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (party_size && (party_size < 1 || party_size > 20)) {
      return new Response(JSON.stringify({ error: "party_size must be 1-20" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: pkg } = await supabaseAdmin
      .from("escape_packages")
      .select("id, package_name, max_total_guests, allocated_guests, is_active, price_per_person_cents")
      .eq("id", package_id)
      .eq("is_active", true)
      .single();

    if (!pkg) {
      return new Response(JSON.stringify({ error: "Package not found or inactive" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pkg.max_total_guests && pkg.allocated_guests + (party_size || 1) > pkg.max_total_guests) {
      return new Response(JSON.stringify({ error: "Not enough capacity" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await supabaseAdmin
      .from("escape_group_participants")
      .select("id, status")
      .eq("package_id", package_id)
      .eq("rider_id", user.id)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ error: "Already joined this package", participant_id: existing.id, status: existing.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participant, error: insertErr } = await supabaseAdmin
      .from("escape_group_participants")
      .insert({
        package_id,
        rider_id: user.id,
        status: "intent_pending",
        party_size: party_size || 1,
        time_preference: time_preference || null,
        pickup_note: pickup_note || null,
      })
      .select("id, status, party_size, joined_at")
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: "Failed to join", detail: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.rpc("increment_allocated_guests", { p_package_id: package_id, p_increment: party_size || 1 }).catch(() => {});

    return new Response(JSON.stringify({
      participant,
      package_name: pkg.package_name,
      price_per_person_cents: pkg.price_per_person_cents,
      estimated_total_cents: (party_size || 1) * pkg.price_per_person_cents,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
