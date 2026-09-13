// P3.2: Event queue processor — picks up pending events and dispatches to cog handlers.
// Designed to be called on a schedule (cron) or triggered by webhook.
// Each event type has an independent handler that can fail without affecting others.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// `SB` with no type arguments instantiates the
// generics at their CONSTRAINTS (unknown / never), not their DEFAULTS, so it
// rejects the very client created at runtime
// (SupabaseClient<any, "public", ...>). Supplying them explicitly fixes it.
type SB = ReturnType<typeof createClient<any, "public", any>>;


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: events, error: fetchErr } = await supabaseAdmin
      .from("event_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: Array<{ id: string; event_type: string; status: string }> = [];

    for (const event of events) {
      await supabaseAdmin
        .from("event_queue")
        .update({ status: "processing", attempt_count: event.attempt_count + 1 })
        .eq("id", event.id);

      try {
        await handleEvent(event.event_type, event.payload, supabaseAdmin);

        await supabaseAdmin
          .from("event_queue")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", event.id);

        results.push({ id: event.id, event_type: event.event_type, status: "completed" });
      } catch (handlerErr: any) {
        console.error(`Event ${event.id} (${event.event_type}) failed:`, handlerErr);

        if (event.attempt_count >= event.max_retries) {
          await supabaseAdmin
            .from("event_queue")
            .update({ status: "failed", last_error: handlerErr.message })
            .eq("id", event.id);
        } else {
          await supabaseAdmin
            .from("event_queue")
            .update({ status: "pending", last_error: handlerErr.message, scheduled_for: new Date(Date.now() + 60000).toISOString() })
            .eq("id", event.id);
        }

        results.push({ id: event.id, event_type: event.event_type, status: "failed" });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("process_event_queue error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function handleEvent(
  eventType: string,
  payload: any,
  supabaseAdmin: SB
): Promise<void> {
  switch (eventType) {
    case "ride.completed":
      await handleRideCompleted(payload, supabaseAdmin);
      break;
    case "payment.confirmed":
      await handlePaymentConfirmed(payload, supabaseAdmin);
      break;
    default:
      console.warn(`Unknown event type: ${eventType}`);
  }
}

async function handleRideCompleted(payload: any, supabaseAdmin: SB): Promise<void> {
  const { ride_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, gross_cents, platform_cents, reserve_cents } = payload;

  // ── Pool Entry (hot-path cleared, this runs async) ──────────────────────
  if (ride_id && gross_cents) {
    await supabaseAdmin.rpc("record_pool_entry", {
      p_ride_id: ride_id,
      p_gross_cents: gross_cents,
      p_platform_cents: platform_cents || 0,
      p_reserve_cents: reserve_cents || 0,
    }).then((__r) => __r, (e: any) => console.error("pool_entry failed:", e));

    console.log(`[Cog] ride.completed: ${ride_id} — pool entry recorded`);
  }

  // ── Spatial Check + Seeding ─────────────────────────────────────────────
  if (dropoff_lat && dropoff_lng) {
    try {
      const { data: isInsideActiveZone, error: geoError } = await supabaseAdmin
        .rpc("is_coordinate_inside_active_zones", {
          p_lat: dropoff_lat,
          p_lng: dropoff_lng,
        });

      if (geoError) throw geoError;

      if (!isInsideActiveZone) {
        const resolvedTerritory = "Unmapped Outer Territory";

        const { error: seedError } = await supabaseAdmin
          .rpc("seed_zone", {
            p_lat: dropoff_lat,
            p_lng: dropoff_lng,
            p_territory_name: resolvedTerritory,
          });

        if (seedError) throw seedError;

        console.log(`[Event Queue Success]: Seed planted at [${dropoff_lat}, ${dropoff_lng}] for ${resolvedTerritory}.`);
      } else {
        console.log(`[Event Queue Bypass]: Dropoff for ride ${ride_id} inside an active zone. No seed required.`);
      }
    } catch (e: any) {
      console.error(`[Event Queue Critical Failure]: Failed to process seeding for ride ${ride_id}:`, e);
    }
  }
}

async function handlePaymentConfirmed(payload: any, _supabaseAdmin: SB): Promise<void> {
  console.log(`[Cog] payment.confirmed: ${JSON.stringify(payload)}`);
}
