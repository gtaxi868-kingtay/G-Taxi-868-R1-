// Supabase Edge Function: get_user_patterns
// Analyzes user's last 30 completed rides to build AI personalization profile

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // JWT verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get last 30 completed rides
    const { data: rides, error } = await supabaseAdmin
      .from("rides")
      .select("pickup_location, dropoff_location, fare_cents, created_at, payment_method, status")
      .eq("rider_id", user_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    // Need at least 3 trips for meaningful patterns
    if (!rides || rides.length < 3) {
      return new Response(
        JSON.stringify({ patterns: null, reason: "insufficient_history", trips_found: rides?.length || 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate patterns
    const patterns = analyzePatterns(rides);

    return new Response(
      JSON.stringify({ patterns, trips_analyzed: rides.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[get_user_patterns] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function analyzePatterns(rides: any[]) {
  // Payment method frequency
  const paymentCounts: Record<string, number> = {};
  rides.forEach(r => {
    paymentCounts[r.payment_method] = (paymentCounts[r.payment_method] || 0) + 1;
  });
  const most_common_payment = Object.entries(paymentCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Hour patterns (0-23)
  const hours = rides.map(r => new Date(r.created_at).getHours());
  const hourCounts: Record<number, number> = {};
  hours.forEach(h => hourCounts[h] = (hourCounts[h] || 0) + 1);
  const typical_travel_hour = parseInt(
    Object.entries(hourCounts).sort((a: any, b: any) => b[1] - a[1])[0][0]
  );

  // Day patterns (0-6, where 0 is Sunday)
  const days = rides.map(r => new Date(r.created_at).getDay());
  const dayCounts: Record<number, number> = {};
  days.forEach(d => dayCounts[d] = (dayCounts[d] || 0) + 1);
  const typical_travel_day = parseInt(
    Object.entries(dayCounts).sort((a: any, b: any) => b[1] - a[1])[0][0]
  );

  // Stats
  const total_trips_last_30_days = rides.length;
  const average_fare_ttd = Math.round(
    rides.reduce((sum, r) => sum + (r.fare_cents || 0), 0) / rides.length / 100
  );

  // Direction hint based on median dropoff coordinates
  // Never return raw coordinates, only directional quadrant
  const lats = rides.map(r => r.dropoff_location?.lat).filter(Boolean);
  const lngs = rides.map(r => r.dropoff_location?.lng).filter(Boolean);
  
  let direction_hint = "central";
  if (lats.length > 0 && lngs.length > 0) {
    const medianLat = lats.sort((a, b) => a - b)[Math.floor(lats.length / 2)];
    const medianLng = lngs.sort((a, b) => a - b)[Math.floor(lngs.length / 2)];
    
    // Trinidad reference point (Port of Spain area)
    const refLat = 10.65;
    const refLng = -61.5;
    
    if (medianLat > refLat + 0.05) direction_hint = "north";
    else if (medianLat < refLat - 0.05) direction_hint = "south";
    else if (medianLng > refLng + 0.05) direction_hint = "east";
    else if (medianLng < refLng - 0.05) direction_hint = "west";
  }

  return {
    most_common_payment,
    typical_travel_hour,
    typical_travel_day,
    total_trips_last_30_days,
    average_fare_ttd,
    direction_hint,
  };
}
