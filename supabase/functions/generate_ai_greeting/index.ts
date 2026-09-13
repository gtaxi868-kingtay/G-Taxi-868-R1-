import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { aiFetch, internalFetch } from "../_shared/networkUtility.ts";
import { chat, BudgetExceededError, RateLimitedError } from "../_shared/llm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!GROQ_API_KEY) {
    const hour = new Date().getHours();
    const fallback = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return new Response(
      JSON.stringify({ greeting: `${fallback}! Ready to roll?`, cached: false, fallback: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const user = await requireAuth(req);

    const { user_id, user_name } = await req.json();
    if (!user_id || !user_name) {
      return new Response(
        JSON.stringify({ error: "user_id and user_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: prefs } = await supabaseAdmin
      .from("rider_ai_preferences")
      .select("metadata")
      // The column is user_id. This said rider_id — a column that does not
      // exist on rider_ai_preferences — so the lookup errored, `prefs` came
      // back null, the 4-hour cache NEVER hit, and every single rider
      // home-screen load made a fresh paid Groq call. Silent, permanent,
      // unmetered spend.
      .eq("user_id", user_id)
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

    const patternsRes = await internalFetch(`${SUPABASE_URL}/functions/v1/get_user_patterns`, {
      method: "POST",
      headers: {
        "Authorization": req.headers.get("Authorization") || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id }),
    });

    const patternsData = await patternsRes.json();
    const patterns = patternsData.patterns;

    const greeting = await generateGreetingWithAI(supabaseAdmin, user_name, patterns);

    const newMetadata = {
      ...prefs?.metadata,
      cached_greeting: greeting,
      cached_at: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("rider_ai_preferences")
      // Same fix on the write side: the primary key is user_id, so the old
      // onConflict target did not exist either and the cache could never
      // have been written even if the read had worked.
      .upsert({
        user_id: user_id,
        metadata: newMetadata,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    return new Response(
      JSON.stringify({ greeting, cached: false, patterns: patterns ? true : false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[generate_ai_greeting] Error:", err.message);
    if (err instanceof Response) return err;
    const hour = new Date().getHours();
    const fallback = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return new Response(
      JSON.stringify({ greeting: `${fallback}! Ready to roll?`, cached: false, fallback: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Routed through _shared/llm.ts rather than fetching api.groq.com directly.
// This function ran on EVERY rider home-screen load, so it was the single
// largest uncapped spender on the platform: the daily budget in llm.ts only
// governed the admin-facing G stack, and rider traffic bypassed it entirely.
// Now it counts against the same cap and lands in g_llm_usage.
//
// The `supabase` client is required so the gateway can read the budget and
// record the spend.
async function generateGreetingWithAI(
  supabase: any,
  name: string,
  patterns: any,
): Promise<string> {
  const prompt = buildPrompt(name, patterns);

  try {
    const res = await chat(supabase, {
      department: "rider_greeting",
      system:
        "You are a friendly Trinidadian ride-hailing assistant. Generate warm, casual greetings under 15 words. Use local phrasing. No quotes. No markdown.",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      maxTokens: 50,
    });

    const text = res.choices?.[0]?.message?.content || "";
    const clean = text.replace(/["']/g, "").trim();
    const words = clean.split(/\s+/);
    if (words.length > 15) {
      return words.slice(0, 15).join(" ") + "...";
    }
    return clean || buildFallback(name, patterns);

  } catch (err) {
    // Budget exhausted or rate limited is NOT an error condition for a
    // greeting — the rider simply gets the deterministic one. Never let a
    // cosmetic banner break the home screen or spend past the cap.
    if (err instanceof BudgetExceededError || err instanceof RateLimitedError) {
      console.log(`[generate_ai_greeting] falling back to template: ${err.name}`);
    } else {
      console.error("LLM call failed:", err);
    }
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
