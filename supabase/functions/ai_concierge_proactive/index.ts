// Supabase Edge Function: ai_concierge_proactive
// Real AI Proactivity: Sees the world through GPS and suggests the next move.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

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

    // 2. Traffic Analysis (Mocked for local Trini context)
    const hour = new Date().getUTCHours() - 4; // AST Time
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    const trafficContext = isRushHour ? "EXPECT HEAVY TRAFFIC. Rush hour patterns detected on Highway/Main Road." : "Traffic flowing normally.";

    // 3. Query Groq (Llama 3.3 70B) for a PROACTIVE suggestion
    const prompt = `
      You are G-TAXI AI, a premium logistics concierge for Trinidad & Tobago.
      Rider: ${ride.rider?.full_name || 'Guest'}
      Current Journey: Heading to ${destination_name || ride.dropoff_address}.
      Traffic State: ${trafficContext}.
      Real-Time POI Context: ${poiContext}.
      
      TASK: Suggest ONE proactive move OR explain a delay. 
      - If traffic is heavy, explain why (e.g. "Peak flow on the Highway..."). 
      - If a PARTNER merchant is nearby, suggest a STOP.
      - Be brief (15 words max). 
      - Format: "AI SIGHT: [Message]".
    `;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
        temperature: 0.7
      })
    });

    const groqData = await response.json();
    const suggestion = groqData.choices?.[0]?.message?.content || "Enjoy your journey with G-Taxi.";

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
