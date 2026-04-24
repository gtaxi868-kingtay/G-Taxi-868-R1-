// Supabase Edge Function: generate_ai_greeting
// Generates personalized AI greeting using Gemini based on user patterns
// Caches result for 4 hours to reduce API calls

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, user_name } = await req.json();
    if (!user_id || !user_name) {
      return new Response(
        JSON.stringify({ error: "user_id and user_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Check cache
    const { data: prefs } = await supabaseAdmin
      .from("rider_ai_preferences")
      .select("metadata")
      .eq("rider_id", user_id)
      .maybeSingle();

    const cached = prefs?.metadata?.cached_greeting;
    const cachedAt = prefs?.metadata?.cached_at;

    if (cached && cachedAt) {
      const ageMs = Date.now() - new Date(cachedAt).getTime();
      if (ageMs < CACHE_TTL_MS) {
        return new Response(
          JSON.stringify({ greeting: cached, cached: true, age_hours: Math.round(ageMs / 3600000) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Step 2: Get user patterns
    const patternsRes = await fetch(`${SUPABASE_URL}/functions/v1/get_user_patterns`, {
      method: "POST",
      headers: {
        "Authorization": req.headers.get("Authorization") || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id }),
    });

    const patternsData = await patternsRes.json();
    const patterns = patternsData.patterns;

    // Step 3: Call Gemini
    const greeting = await generateGreetingWithGemini(user_name, patterns);

    // Step 4: Store in cache
    const newMetadata = {
      ...prefs?.metadata,
      cached_greeting: greeting,
      cached_at: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("rider_ai_preferences")
      .upsert({
        rider_id: user_id,
        metadata: newMetadata,
        updated_at: new Date().toISOString(),
      }, { onConflict: "rider_id" });

    return new Response(
      JSON.stringify({ greeting, cached: false, patterns: patterns ? true : false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[generate_ai_greeting] Error:", err.message);
    // Fallback to time-based greeting on error
    const hour = new Date().getHours();
    const fallback = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return new Response(
      JSON.stringify({ greeting: `${fallback}! Ready to roll?`, cached: false, fallback: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateGreetingWithGemini(name: string, patterns: any): Promise<string> {
  const prompt = buildPrompt(name, patterns);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 50,
            temperature: 0.8,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Clean up - remove quotes and ensure under 15 words
    const clean = text.replace(/["']/g, "").trim();
    const words = clean.split(/\s+/);
    if (words.length > 15) {
      return words.slice(0, 15).join(" ") + "...";
    }
    return clean || buildFallback(name, patterns);

  } catch (err) {
    console.error("Gemini call failed:", err);
    return buildFallback(name, patterns);
  }
}

function buildPrompt(name: string, patterns: any): string {
  const timeOfDay = new Date().getHours() < 12 ? "morning" : 
                    new Date().getHours() < 17 ? "afternoon" : "evening";
  
  let context = `The user's name is ${name}. It is currently ${timeOfDay}.`;
  
  if (patterns) {
    context += ` They usually travel on ${dayName(patterns.typical_travel_day)}s around ${patterns.typical_travel_hour}:00.`;
    context += ` Their typical fare is about ${patterns.average_fare_ttd} TTD.`;
    context += ` They usually go ${patterns.direction_hint} from the city center.`;
    context += ` They prefer paying by ${patterns.most_common_payment}.`;
  }

  return `${context}

Write a friendly, warm greeting for a ride-hailing app user in Trinidad and Tobago. 
Sound like a local friend, not corporate. Use casual Trinidadian English style.
Keep it under 15 words. Make it personal but not creepy.
No quotes in the response. Just the greeting text.
Examples of tone: "Morning ${name}, ready to roll?", "Headed ${patterns?.direction_hint || 'out'} today?", "Big day ${name}?"`;
}

function buildFallback(name: string, patterns: any): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  if (patterns?.direction_hint && patterns.direction_hint !== "central") {
    return `${greeting} ${name}, headed ${patterns.direction_hint} today?`;
  }
  return `${greeting} ${name}, ready to roll?`;
}

function dayName(dayNum: number): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[dayNum] || "weekday";
}
