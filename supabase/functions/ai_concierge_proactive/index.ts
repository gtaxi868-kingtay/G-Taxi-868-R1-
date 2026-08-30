import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JARVIS_URL = Deno.env.get("JARVIS_SERVICE_URL") ?? "http://host.docker.internal:8000/concierge";
const JARVIS_SECRET = Deno.env.get("JARVIS_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rule-based fallback when Jarvis is down
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

    // Try Jarvis first
    try {
      const res = await fetch(JARVIS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jarvis-Secret": JARVIS_SECRET,
        },
        body: JSON.stringify({
          user_id: user.id,
          user_name: riderName,
          is_home_mode: isHomeMode,
          hour,
          is_rush_hour: isRushHour,
          lat: lat || dropoffLat,
          lng: lng || dropoffLng,
          destination_name: destName,
          poi_data: poiData ?? [],
        }),
      });

      if (!res.ok) throw new Error(`Jarvis ${res.status}`);

      const data = await res.json();
      return new Response(
        JSON.stringify({
          suggestion: data.suggestion,
          source: "jarvis",
          meta: data.meta ?? {},
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (jarvisErr) {
      console.error("[ai_concierge] Jarvis failed, using fallback:", jarvisErr);
      // Graceful fallback — never 500 the user
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
