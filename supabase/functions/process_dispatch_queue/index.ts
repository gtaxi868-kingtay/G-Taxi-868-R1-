import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

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
      // merchants has no business_name column — it is `name`. This one wrong
      // word made the whole dispatch sweep 500 on its very first query, once
      // a minute, so no queued delivery has ever been dispatched by it.
      .select("id, task_type, order_id, ride_id, priority, pickup_lat, pickup_lng, attempts, expires_at, created_at, orders(merchant_id, total_cents, delivery_fee_cents, merchants(name))")
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
        const merchantName = order?.merchants?.name || "Merchant";
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
          // This branch used to only mark the dispatch_queue row itself as
          // "assigned" — it never touched rides.status/driver_id, never
          // created a ride_offers row, and never notified the driver. A
          // ride dispatched through this backup/scheduled-promotion path
          // (as opposed to the real-time match_driver a rider's own app
          // calls right after ride creation) would look internally
          // "handled" while staying invisible to the driver forever.
          //
          // Deliberately NOT a full reimplementation of match_driver's
          // logic (trust-score badges, merchant-ride branding, WhatsApp
          // fallback, Redis candidate lists) — this mirrors only the
          // core mechanism a driver actually needs to see and accept an
          // offer: a real ride_offers row with a correct payout, the
          // ride pulled out of any stuck queue state, and a push nudge.
          const { data: ride } = await supabaseAdmin
            .from("rides")
            .select("id, total_fare_cents, status")
            .eq("id", item.ride_id)
            .maybeSingle();

          if (!ride || !["requested", "searching", "waiting_queue", "scheduled"].includes(ride.status)) {
            await supabaseAdmin.from("dispatch_queue").update({ status: "failed", last_attempted: now.toISOString() }).eq("id", item.id);
            results.push({ task_id: item.id, task_type: "RIDE", status: "ride_not_matchable" });
            continue;
          }

          const { data: driverRow } = await supabaseAdmin
            .from("drivers")
            .select("commission_tier")
            .eq("id", driver.driver_id)
            .maybeSingle();

          const { data: platRateRow } = await supabaseAdmin
            .from("pricing_config")
            .select("value_cents")
            .eq("key", "PLATFORM_RATE_CENTS")
            .maybeSingle()
            .then((__r) => __r, () => ({ data: null }));
          const platRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15;
          const commissionRate = driverRow?.commission_tier === "pioneer"
            ? Math.max(0.01, platRate - 0.03)
            : platRate;
          const driverPayout = Math.round((ride.total_fare_cents || 0) * (1 - commissionRate));

          const rideOfferExpiresAt = new Date(Date.now() + 15 * 1000).toISOString();
          const { error: rideOfferErr } = await supabaseAdmin
            .from("ride_offers")
            .insert({
              ride_id: item.ride_id,
              driver_id: driver.driver_id,
              status: "pending",
              distance_meters: Math.round(driver.distance_m ?? 0),
              driver_payout_cents: driverPayout,
              expires_at: rideOfferExpiresAt,
            });

          if (rideOfferErr) throw rideOfferErr;

          // Pull the ride out of any stuck queue state so the driver-side
          // offer surfaces (mirrors match_driver's own equivalent step).
          await supabaseAdmin
            .from("rides")
            .update({ status: "searching" })
            .eq("id", item.ride_id)
            .in("status", ["requested", "searching", "waiting_queue", "scheduled"]);

          await supabaseAdmin
            .from("dispatch_queue")
            .update({ status: "dispatched", driver_id: driver.driver_id, last_attempted: now.toISOString() })
            .eq("id", item.id);

          if (driver.push_token) {
            sendPushNotification(
              driver.push_token,
              "🚖 New Ride Request",
              "A rider is waiting nearby. Tap to view the offer.",
              { type: "RIDE_OFFER", ride_id: item.ride_id }
            ).catch((err) => console.error("Push failed for RIDE dispatch (non-fatal):", err));
          }

          results.push({ task_id: item.id, task_type: "RIDE", status: "dispatched", driver_id: driver.driver_id, offer_expires_at: rideOfferExpiresAt });

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
