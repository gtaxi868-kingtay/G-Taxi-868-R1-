import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { aiFetch } from "../_shared/networkUtility.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JARVIS_SERVICE_URL = Deno.env.get("JARVIS_SERVICE_URL") ?? "http://host.docker.internal:8000/concierge";
const JARVIS_SECRET = Deno.env.get("JARVIS_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Rule-based fallback (no AI needed) ───────────────────────────────────────
function ruleBasedFallback(riderName: string, hour: number, isHomeMode: boolean, destName: string, poiData: any[]): string {
  const timeBlock =
    hour >= 6 && hour < 11 ? "morning" :
    hour >= 11 && hour < 14 ? "lunch" :
    hour >= 14 && hour < 18 ? "afternoon" : "evening";

  const greeting = isHomeMode
    ? `Good ${timeBlock}, ${riderName}!`
    : `Smooth travels to ${destName || "your destination"}.`;

  if (poiData && poiData.length > 0) {
    const top = poiData[0];
    const emoji = top.category?.toLowerCase().includes("food") ? "🍽️" :
                  top.category?.toLowerCase().includes("fuel") ? "⛽" : "📍";
    return `${greeting} ${emoji} ${top.name} is nearby.`;
  }
  return greeting;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireAuth(req);

    const { ride_id, lat, lng, destination_name, mode, profile_id } = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let riderName = "Guest";
    let dropoffLat = lat;
    let dropoffLng = lng;
    let destName = destination_name;

    if (ride_id) {
      const { data: rideData } = await supabase
        .from("rides")
        .select("*, rider:rider_id(*)")
        .eq("id", ride_id)
        .single();

      if (rideData) {
        if (rideData.rider_id !== user.id && rideData.driver_id !== user.id) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
        }
        riderName = rideData.rider?.full_name || "Guest";
        dropoffLat = rideData.dropoff_lat;
        dropoffLng = rideData.dropoff_lng;
        destName = rideData.dropoff_address;
      }
    } else if (profile_id) {
      if (profile_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", profile_id)
        .single();
      if (profile) riderName = profile.full_name;
    }

    const isHomeMode = mode === "home" || !ride_id;

    const { data: poiData } = await supabase.rpc("get_proactive_poi_context", {
      p_lat: lat || dropoffLat,
      p_lng: lng || dropoffLng,
      p_radius_meters: 1500,
    });

    // AST offset (UTC-4)
    const hour = new Date().getUTCHours() - 4;
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);

    // ── Try Jarvis microservice ───────────────────────────────────────────────
    let suggestion: string | null = null;

    try {
      const jarvisRes = await aiFetch(JARVIS_SERVICE_URL, {
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

      if (jarvisRes.ok) {
        const agyData = await jarvisRes.json();
        suggestion = agyData.suggestion?.trim() || null;
      } else {
        console.warn(`[ai_concierge] Jarvis returned ${jarvisRes.status} — using fallback`);
      }
    } catch (jarvisErr) {
      console.warn(`[ai_concierge] Jarvis unreachable: ${jarvisErr} — using fallback`);
    }

    // ── Rule-based fallback if Jarvis failed or returned empty ───────────────
    if (!suggestion) {
      suggestion = ruleBasedFallback(riderName, hour, isHomeMode, destName, poiData ?? []);
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
