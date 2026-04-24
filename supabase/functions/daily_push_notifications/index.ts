// Supabase Edge Function: daily_push_notifications
// Designed for pg_cron trigger at 6am daily
// Sends personalized morning push notifications to active riders

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Track stats for logging
  let processed = 0;
  let sent = 0;
  let skippedNoPattern = 0;
  let skippedAlreadySent = 0;
  let skippedNoToken = 0;
  let errors = 0;

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Get active riders (completed a ride in last 14 days)
    const { data: activeRiders, error: ridersError } = await supabaseAdmin
      .from("rides")
      .select("rider_id")
      .eq("status", "completed")
      .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (ridersError) throw ridersError;

    // Get unique rider IDs
    const uniqueRiderIds = [...new Set(activeRiders?.map((r: any) => r.rider_id) || [])];
    processed = uniqueRiderIds.length;

    console.log(`[Daily Push] Processing ${processed} active riders`);

    // Step 2: Process each rider
    for (const riderId of uniqueRiderIds) {
      try {
        // A. Get user patterns
        const patternsRes = await fetch(`${SUPABASE_URL}/functions/v1/get_user_patterns`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: riderId }),
        });

        const patternsData = await patternsRes.json();

        if (!patternsData.patterns) {
          skippedNoPattern++;
          continue;
        }

        const patterns = patternsData.patterns;

        // B. Check if today matches their typical travel day
        const today = new Date().getDay(); // 0 = Sunday
        if (patterns.typical_travel_day !== today) {
          // Not their usual day, skip
          continue;
        }

        // C. Check last notification time (prevent spam)
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("push_token, last_notification_sent_at, name")
          .eq("id", riderId)
          .single();

        if (!profile?.push_token) {
          skippedNoToken++;
          continue;
        }

        if (profile.last_notification_sent_at) {
          const hoursSince = (Date.now() - new Date(profile.last_notification_sent_at).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 20) {
            skippedAlreadySent++;
            continue;
          }
        }

        // D. Generate push message with Groq
        const message = await generatePushMessage(patterns);

        // E. Send push notification
        await fetch(`${SUPABASE_URL}/functions/v1/send_push_notification`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: riderId,
            title: "G-Taxi",
            body: message,
            data: { type: "daily_suggestion" },
          }),
        });

        // F. Update last sent time
        await supabaseAdmin
          .from("profiles")
          .update({ last_notification_sent_at: new Date().toISOString() })
          .eq("id", riderId);

        sent++;
        console.log(`[Daily Push] Sent to ${riderId}: ${message}`);

      } catch (err: any) {
        errors++;
        console.error(`[Daily Push] Error processing ${riderId}:`, err.message);
      }
    }

    // Step 3: Log summary
    console.log("[Daily Push] Complete");
    console.log(`  Processed: ${processed}`);
    console.log(`  Sent: ${sent}`);
    console.log(`  Skipped (no pattern): ${skippedNoPattern}`);
    console.log(`  Skipped (already sent): ${skippedAlreadySent}`);
    console.log(`  Skipped (no token): ${skippedNoToken}`);
    console.log(`  Errors: ${errors}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        sent,
        skipped: {
          noPattern: skippedNoPattern,
          alreadySent: skippedAlreadySent,
          noToken: skippedNoToken,
        },
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[Daily Push] Fatal error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generatePushMessage(patterns: any): Promise<string> {
  const directionMap: Record<string, string> = {
    north: "north",
    south: "south",
    east: "east",
    west: "west",
    central: "into town",
  };

  const direction = directionMap[patterns.direction_hint] || "out";
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayNames[patterns.typical_travel_day];

  // Try Groq first
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "You are writing push notifications for a ride-hailing app in Trinidad and Tobago. Keep it under 10 words. Sound helpful and friendly, like a local. No corporate speak.",
          },
          {
            role: "user",
            content: `Write a push notification for a rider who usually travels ${direction} on ${dayName}s around ${patterns.typical_travel_hour}:00. Make it feel personal and helpful.`,
          },
        ],
        max_tokens: 30,
        temperature: 0.7,
      }),
    });

    if (!response.ok) throw new Error(`Groq API error: ${response.status}`);

    const data = await response.json();
    const message = data.choices?.[0]?.message?.content?.trim();

    if (message && message.length > 5 && message.length < 100) {
      return message.replace(/["']/g, "");
    }
  } catch (err) {
    console.warn("[Daily Push] Groq failed, using fallback:", err);
  }

  // Fallback templates
  const fallbacks = [
    `Headed ${direction} today? Your usual ride is waiting.`,
    `${dayName} commute time. Need a lift ${direction}?`,
    `Your ${dayName} ride to ${direction} is ready when you are.`,
    `Running ${direction} today? Book now, skip the wait.`,
  ];

  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}
