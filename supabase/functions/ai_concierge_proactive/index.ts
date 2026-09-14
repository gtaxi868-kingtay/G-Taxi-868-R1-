import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deterministic fallback when g_rider_concierge can't answer (a real system
// limit -- daily cap, budget exhausted, transient error) rather than a
// deliberate rider choice. NOT used when the rider has suggestions off --
// that's a consent decision, not an outage, and gets no suggestion at all.
function ruleBasedSuggestion(
  riderName: string,
  hour: number,
  isHomeMode: boolean,
  destName?: string,
  poiData?: any[]
): string {
  const timeBlock =
    hour >= 6 && hour < 11 ? "morning"
    : hour >= 11 && hour < 14 ? "lunch"
    : hour >= 14 && hour < 18 ? "afternoon"
    : "evening";

  if (!isHomeMode) {
    return `Smooth travels to ${destName || "your destination"}, ${riderName}!`;
  }

  const greetings: Record<string, string> = {
    morning: `☕ Good morning, ${riderName}! Need a ride or coffee?`,
    lunch: `🍽️ Lunch time, ${riderName}! I can suggest spots nearby.`,
    afternoon: `🌤️ Good afternoon! Running errands? I can help find stops.`,
    evening: `🌙 Good evening! Heading out for dinner? Let me know.`,
  };

  const base = greetings[timeBlock] || greetings.evening;
  if (poiData?.length) {
    return `${base} ${poiData[0].name} is nearby.`;
  }
  return base;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireAuth(req);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Forwarded to g_rider_concierge so it resolves identity from the real
    // rider JWT (never a client-supplied id) -- same pattern this project
    // requires everywhere.
    const riderAuthHeader = req.headers.get("Authorization") ?? "";

    const { ride_id, lat, lng, destination_name, mode, profile_id } = await req.json();

    if (profile_id && profile_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    let riderName = "Guest";
    let dropoffLat = lat;
    let dropoffLng = lng;
    let destName = destination_name;

    if (ride_id) {
      const { data: ride } = await supabase
        .from("rides")
        .select("*, rider:rider_id(*)")
        .eq("id", ride_id)
        .single();

      if (ride) {
        if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
        }
        riderName = ride.rider?.full_name || "Guest";
        dropoffLat = ride.dropoff_lat;
        dropoffLng = ride.dropoff_lng;
        destName = ride.dropoff_address;
      }
    } else if (profile_id) {
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", profile_id).single();
      if (profile) riderName = profile.full_name;
    }

    const isHomeMode = mode === "home" || !ride_id;

    const { data: poiData } = await supabase.rpc("get_proactive_poi_context", {
      p_lat: lat || dropoffLat,
      p_lng: lng || dropoffLng,
      p_radius_meters: 1500,
    });

    const hour = new Date().getUTCHours() - 4;
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);

    // g_rider_concierge is the one rider voice now -- proactive mode reuses
    // its consent checks, memory, tools (including initiate_lime_fleet) and
    // budget-capped gateway instead of a separate, un-budget-capped service.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/g_rider_concierge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": riderAuthHeader,
        },
        body: JSON.stringify({
          mode: "proactive",
          lat: lat ?? dropoffLat ?? null,
          lng: lng ?? dropoffLng ?? null,
          hour,
          is_rush_hour: isRushHour,
          is_home_mode: isHomeMode,
          destination_name: destName,
          poi_data: poiData ?? [],
        }),
      });

      if (!res.ok) throw new Error(`g_rider_concierge ${res.status}`);

      const data = await res.json();

      // Rider explicitly has suggestions off -- respect it fully, no
      // suggestion at all, not even the generic deterministic one.
      if (data.skipped === "suggestions_off") {
        return new Response(JSON.stringify({ suggestion: null, source: "consent_off" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // A real system limit (daily cap, budget, transient error), or the
      // model genuinely had nothing useful to say -- deterministic fallback
      // keeps the rider from seeing a blank concierge for a system reason.
      if (!data.reply) {
        const fallback = ruleBasedSuggestion(riderName, hour, isHomeMode, destName, poiData);
        return new Response(JSON.stringify({ suggestion: fallback, source: "fallback" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(
        JSON.stringify({ suggestion: data.reply, source: "g_rider_concierge" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (conciergeErr) {
      console.error("[ai_concierge] g_rider_concierge failed, using fallback:", conciergeErr);
      const fallback = ruleBasedSuggestion(riderName, hour, isHomeMode, destName, poiData);
      return new Response(
        JSON.stringify({ suggestion: fallback, source: "fallback" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[ai_concierge] error:", err);
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable" }),
      { status: 503, headers: corsHeaders }
    );
  }
});
