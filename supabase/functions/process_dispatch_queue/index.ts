import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async () => {
  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pending tasks sorted by priority DESC, oldest first
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

    // Expire tasks past their deadline
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

        // Expanding search radius based on attempts
        let searchRadiusMeters = 3000;
        if (item.attempts >= 2) searchRadiusMeters = 6000;
        if (item.attempts >= 3) searchRadiusMeters = 10000;

        const { data: drivers } = await supabaseAdmin.rpc("find_nearest_online_drivers", {
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: searchRadiusMeters,
          p_limit: 1
        }).catch(() => ({ data: [] }));

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
          // Create delivery offer for order-based tasks
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

          const feeCents = order?.delivery_fee_cents ?? 0;
          const feeTTD = (feeCents / 100).toFixed(2);

          if (driver.push_token) {
            await sendPushNotification(
              driver.push_token,
              `New ${item.task_type} Request`,
              `${merchantName} — TTD $${feeTTD} fee`,
              {
                type: "delivery_offer",
                offer_id: offer.id,
                order_id: item.order_id,
                task_id: item.id,
                merchant_name: merchantName,
                delivery_fee_cents: feeCents,
              }
            );
          }

          await supabaseAdmin
            .from("dispatch_queue")
            .update({ status: "dispatched", driver_id: driver.driver_id, last_attempted: now.toISOString() })
            .eq("id", item.id);

          results.push({ task_id: item.id, task_type: item.task_type, status: "dispatched", driver_id: driver.driver_id, offer_id: offer.id });

        } else if (item.task_type === "RIDE") {
          // RIDE tasks: soft-ping the driver, Realtime handles the offer
          if (driver.push_token) {
            await sendPushNotification(
              driver.push_token,
              "New Ride Available",
              `Priority ${item.priority} ride nearby. Tap to view.`,
              {
                type: "ride_dispatch",
                ride_id: item.ride_id,
                task_id: item.id,
                priority: item.priority,
              }
            );
          }

          await supabaseAdmin
            .from("dispatch_queue")
            .update({ status: "assigned", driver_id: driver.driver_id, last_attempted: now.toISOString() })
            .eq("id", item.id);

          results.push({ task_id: item.id, task_type: "RIDE", status: "assigned", driver_id: driver.driver_id });

        } else {
          // Unknown task type — skip
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
    await captureException(error, { function: "process_dispatch_queue" });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
