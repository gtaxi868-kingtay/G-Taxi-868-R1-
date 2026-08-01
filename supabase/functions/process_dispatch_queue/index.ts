import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

serve(async (req: Request) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    })
  }
  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: queueItems, error: queueErr } = await supabaseAdmin
      .from("dispatch_queue")
      .select("id, task_type, order_id, ride_id, priority, pickup_lat, pickup_lng, attempts, expires_at, created_at, orders(merchant_id, total_cents, delivery_fee_cents, merchants(business_name))")
      .eq("status", "pending")
      .lt("attempts", 5)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    if (queueErr) throw queueErr;

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ message: "No pending dispatch items." }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const now = new Date();
    for (const item of queueItems) {
      if (item.expires_at && new Date(item.expires_at) <= now) {
        await supabaseAdmin.from("dispatch_queue").update({ status: "expired" }).eq("id", item.id);
      }
    }

    const activeItems = queueItems.filter(i => !i.expires_at || new Date(i.expires_at) > now);
    if (!activeItems.length) {
      return new Response(JSON.stringify({ message: "All tasks expired." }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const results = [];

    for (const item of activeItems) {
      try {
        const order = (item as any).orders;
        const merchantName = order?.merchants?.business_name || "Merchant";
        const lat = item.pickup_lat;
        const lng = item.pickup_lng;

        if (!lat || !lng) {
          await supabaseAdmin.from("dispatch_queue").update({ status: "failed", last_attempted: now.toISOString() }).eq("id", item.id);
          continue;
        }

        let searchRadiusMeters = 3000;
        if (item.attempts >= 2) searchRadiusMeters = 6000;
        if (item.attempts >= 3) searchRadiusMeters = 10000;

        const { data: drivers } = await supabaseAdmin.rpc("find_nearest_online_drivers", {
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: searchRadiusMeters,
          p_limit: 1
        }).then((__r) => __r, () => ({ data: [] }));

        if (!drivers || drivers.length === 0) {
          await supabaseAdmin
            .from("dispatch_queue")
            .update({
              attempts: item.attempts + 1,
              last_attempted: now.toISOString(),
              status: item.attempts + 1 >= 5 ? "failed" : "pending"
            })
            .eq("id", item.id);

          results.push({ task_id: item.id, task_type: item.task_type, status: "no_driver_found", attempts: item.attempts + 1 });
          continue;
        }

        const driver = drivers[0];

        if (item.task_type === "DELIVERY" || item.task_type === "GROCERY" || item.task_type === "LAUNDRY") {
          const OFFER_TIMEOUT_SECONDS = 30;
          const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();

          const { data: offer, error: offerErr } = await supabaseAdmin
            .from("delivery_offers")
            .insert({
              order_id: item.order_id,
              driver_id: driver.driver_id,
              status: "pending",
              expires_at: expiresAt,
            })
            .select()
            .single();

          if (offerErr) throw offerErr;

          await supabaseAdmin
            .from("dispatch_queue")
            .update({ status: "dispatched", driver_id: driver.driver_id, last_attempted: now.toISOString() })
            .eq("id", item.id);

          results.push({ task_id: item.id, task_type: item.task_type, status: "dispatched", driver_id: driver.driver_id, offer_id: offer.id });

        } else if (item.task_type === "RIDE") {
          await supabaseAdmin
            .from("dispatch_queue")
            .update({ status: "assigned", driver_id: driver.driver_id, last_attempted: now.toISOString() })
            .eq("id", item.id);

          results.push({ task_id: item.id, task_type: "RIDE", status: "assigned", driver_id: driver.driver_id });

        } else {
          results.push({ task_id: item.id, task_type: item.task_type, status: "unknown_type" });
        }

      } catch (err: any) {
        console.error(`Dispatch failed for item ${item.id}:`, err);
        results.push({ task_id: item.id, task_type: item.task_type, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("process_dispatch_queue error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
