import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { aiFetch } from "../_shared/networkUtility.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), { status: 503, headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);

    const { ride_id, lat, lng, destination_name, mode, profile_id } = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    let ride = null;
    let riderName = 'Guest';
    let dropoffLat = lat;
    let dropoffLng = lng;
    let destName = destination_name;
    
    if (ride_id) {
      const { data: rideData } = await supabase.from('rides').select('*, rider:rider_id(*)').eq('id', ride_id).single();
      ride = rideData;
      if (ride) {
        if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
        }
        riderName = ride.rider?.full_name || 'Guest';
        dropoffLat = ride.dropoff_lat;
        dropoffLng = ride.dropoff_lng;
        destName = ride.dropoff_address;
      }
    } else if (profile_id) {
      if (profile_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
      }
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', profile_id).single();
      if (profile) riderName = profile.full_name;
    }
    
    const isHomeMode = mode === 'home' || !ride_id;

    const { data: poiData } = await supabase.rpc('get_proactive_poi_context', {
      p_lat: lat || dropoffLat,
      p_lng: lng || dropoffLng,
      p_radius_meters: 1500
    });

    let poiContext = "No immediate POIs found.";
    if (poiData && poiData.length > 0) {
      poiContext = "Nearby options: " + poiData.map((p: any) => 
        `${p.name} (${p.category}${p.is_partner ? ' - PARTNER' : ''}) at ${p.distance_meters}m`
      ).join(", ");
    }

    const hour = new Date().getUTCHours() - 4;
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    const trafficContext = isRushHour ? "EXPECT HEAVY TRAFFIC. Rush hour patterns detected on Highway/Main Road." : "Traffic flowing normally.";

    let prompt;
    
    if (isHomeMode) {
      const timeContext = hour >= 6 && hour < 11 ? 'morning' : 
                         hour >= 11 && hour < 14 ? 'lunch' : 
                         hour >= 14 && hour < 18 ? 'afternoon' : 'evening';
      prompt = `
        You are G-TAXI AI, a premium logistics concierge for Trinidad & Tobago.
        User: ${riderName}
        Time: ${timeContext} (${hour}:00 AST)
        Location: ${lat}, ${lng}
        Nearby POIs: ${poiContext}
        
        TASK: Suggest ONE thing based on time of day and location.
        - Morning (6-11am): Suggest coffee nearby
        - Lunch (11am-2pm): Suggest food/restaurant  
        - Afternoon (2-6pm): Suggest errands, pharmacy, gas
        - Evening (6pm+): Suggest dinner, late pharmacy
        - If partner merchant nearby, mention by name
        Be brief (10 words max).
        Format: "[Emoji] [Suggestion] at [Place]".
        Examples: "☕ Coffee at Rituals?", "🍽️ Lunch at Kenny's?", "⛽ Gas at NP?"
      `;
    } else {
      prompt = `
        You are G-TAXI AI, a premium logistics concierge for Trinidad & Tobago.
        Rider: ${riderName}
        Current Journey: Heading to ${destName || 'destination'}.
        Traffic State: ${trafficContext}.
        Real-Time POI Context: ${poiContext}.
        
        TASK: Suggest ONE proactive move OR explain a delay. 
        - If traffic is heavy, explain why (e.g. "Peak flow on the Highway..."). 
        - If a PARTNER merchant is nearby, suggest a STOP.
        - Be brief (15 words max). 
        - Format: "AI SIGHT: [Message]".
      `;
    }

    const response = await aiFetch("https://api.groq.com/openai/v1/chat/completions", {
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
    let suggestion = groqData.choices?.[0]?.message?.content?.trim();

    if (!suggestion) {
      const timeBlock = hour >= 6 && hour < 11 ? 'morning' :
                        hour >= 11 && hour < 14 ? 'lunch' :
                        hour >= 14 && hour < 18 ? 'afternoon' : 'evening';
      const greeting = isHomeMode
        ? `Good ${timeBlock}, ${riderName}!`
        : `Smooth travels to ${destName || 'your destination'}`;
      suggestion = poiData && poiData.length > 0
        ? `${greeting} ${poiData[0].name} is nearby.`
        : greeting;
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
