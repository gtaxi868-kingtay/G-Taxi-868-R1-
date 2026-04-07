// Supabase Edge Function: ai_concierge_proactive
// Real AI Proactivity: Sees the world through GPS and suggests the next move.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ride_id, lat, lng, destination_name } = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: ride } = await supabase.from('rides').select('*, rider:rider_id(*)').eq('id', ride_id).single();

    if (!ride) throw new Error("Ride not found");

    // 1. REAL POI Discovery (Phase 11.5)
    // Fetch nearby partner merchants OR utility POIs (ATMs/Groceries)
    const { data: poiData } = await supabase.rpc('get_proactive_poi_context', {
      p_lat: lat || ride.dropoff_lat,
      p_lng: lng || ride.dropoff_lng,
      p_radius_meters: 1500
    });

    let poiContext = "No immediate POIs found.";
    if (poiData && poiData.length > 0) {
      poiContext = "Nearby options: " + poiData.map((p: any) => 
        `${p.name} (${p.category}${p.is_partner ? ' - PARTNER' : ''}) at ${p.distance_meters}m`
      ).join(", ");
    }

    // 2. Query Gemini for a PROACTIVE suggestion
    const prompt = `
      You are G-TAXI AI, a premium logistics concierge.
      Rider: ${ride.rider?.full_name || 'Guest'}
      Current Journey: Heading to ${destination_name || ride.dropoff_address}.
      Real-Time Context: ${poiContext}.
      
      TASK: Suggest ONE proactive stop or service based on the context. 
      - If a PARTNER merchant is nearby, prioritize them (e.g. "I see a partner Barbershop with a slot open...").
      - Otherwise, suggest useful utility POIs like ATMs or Groceries.
      - Be brief (15 words max). 
      - Format response specifically to include the word "STOP".
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 50 }
      })
    });

    const geminiData = await response.json();
    const suggestion = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Enjoy your journey with G-Taxi.";

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
