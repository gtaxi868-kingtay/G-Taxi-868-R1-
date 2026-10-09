import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const RIDE_MATCH_RADIUS_KM = 15;
const RIDE_OFFER_SECONDS = 15;
const MATCHABLE_RIDE_STATUSES = ["requested", "searching", "waiting_queue", "scheduled"];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// One matching round for a queued ride. Called every minute while the ride
// is still unmatched, so a declined or ignored offer is followed by the
// next driver instead of the ride sitting in 'searching' forever (the old
// branch offered exactly one driver, then marked the queue row done).
//
// Driver eligibility is delegated to claim_available_driver -- the same
// verified / vehicle-class / blacklist / scoring rules the rider app's own
// match_driver uses -- by passing it an explicit candidate list. Candidates
// are online, free, within RIDE_MATCH_RADIUS_KM and never previously
// offered this ride.
//
// Network-first: when the ride was sent by a business (merchant dispatch)
// whose owner runs an active network, that network's drivers are tried
// before anyone else. If none of them can take it right now, the same
// round falls through to every eligible driver -- a client never waits on
// an empty network.
async function dispatchRideRound(supabaseAdmin: any, item: any, now: Date) {
  const { data: ride } = await supabaseAdmin
    .from("rides")
    .select("id, status, total_fare_cents, vehicle_type, rider_id, pickup_lat, pickup_lng, metadata")
    .eq("id", item.ride_id)
    .maybeSingle();

  if (!ride || !MATCHABLE_RIDE_STATUSES.includes(ride.status)) {
    // Matched (or cancelled) elsewhere -- this queue row's job is done.
    await supabaseAdmin
      .from("dispatch_queue")
      .update({ status: ride ? "dispatched" : "failed", last_attempted: now.toISOString() })
      .eq("id", item.id);
    return { task_id: item.id, task_type: "RIDE", status: ride ? "already_matched" : "ride_missing" };
  }

  const { data: offers } = await supabaseAdmin
    .from("ride_offers")
    .select("driver_id, status, expires_at")
    .eq("ride_id", ride.id);
  const live = (offers || []).some((o: any) => o.status === "pending" && new Date(o.expires_at) > now);
  if (live) return { task_id: item.id, task_type: "RIDE", status: "offer_outstanding" };
  const excluded = new Set((offers || []).map((o: any) => o.driver_id));

  const pickupLat = ride.pickup_lat ?? item.pickup_lat;
  const pickupLng = ride.pickup_lng ?? item.pickup_lng;
  const latSpan = RIDE_MATCH_RADIUS_KM / 111;
  const lngSpan = RIDE_MATCH_RADIUS_KM / (111 * Math.cos((pickupLat * Math.PI) / 180));

  const { data: nearby } = await supabaseAdmin
    .from("drivers")
    .select("id, lat, lng, push_token, recruited_by_commander_user_id")
    .eq("is_online", true)
    .is("active_ride_id", null)
    .gte("lat", pickupLat - latSpan).lte("lat", pickupLat + latSpan)
    .gte("lng", pickupLng - lngSpan).lte("lng", pickupLng + lngSpan);

  const pool = (nearby || []).filter((d: any) =>
    !excluded.has(d.id) && d.lat != null && d.lng != null &&
    haversineKm(pickupLat, pickupLng, d.lat, d.lng) <= RIDE_MATCH_RADIUS_KM);

  // Whose network gets first refusal, if anyone's.
  let networkOwner: string | null = null;
  const merchantId = ride.metadata?.dispatched_by_merchant_id;
  if (merchantId) {
    const { data: merchant } = await supabaseAdmin.from("merchants").select("created_by").eq("id", merchantId).maybeSingle();
    if (merchant?.created_by) {
      const { data: cmd } = await supabaseAdmin
        .from("pod_commanders").select("id").eq("user_id", merchant.created_by).eq("status", "active").maybeSingle();
      if (cmd) networkOwner = merchant.created_by;
    }
  }

  const tiers: { label: string; ids: string[] }[] = [];
  if (networkOwner) {
    tiers.push({ label: "network", ids: pool.filter((d: any) => d.recruited_by_commander_user_id === networkOwner).map((d: any) => d.id) });
  }
  tiers.push({ label: "open", ids: pool.map((d: any) => d.id) });

  let claimed: any = null;
  let tierUsed = "";
  for (const tier of tiers) {
    if (tier.ids.length === 0) continue;
    const { data } = await supabaseAdmin.rpc("claim_available_driver", {
      p_pickup_lat: pickupLat,
      p_pickup_lng: pickupLng,
      p_vehicle_type: ride.vehicle_type || "Any",
      p_rider_id: ride.rider_id,
      p_max_distance_km: RIDE_MATCH_RADIUS_KM,
      p_candidate_ids: tier.ids,
    });
    if (data && data.length > 0) { claimed = data[0]; tierUsed = tier.label; break; }
  }

  if (!claimed) {
    const attempts = item.attempts + 1;
    await supabaseAdmin
      .from("dispatch_queue")
      .update({ attempts, last_attempted: now.toISOString(), status: attempts >= 5 ? "failed" : "pending" })
      .eq("id", item.id);
    return { task_id: item.id, task_type: "RIDE", status: "no_driver_found", attempts };
  }

  const driver = pool.find((d: any) => d.id === claimed.driver_id);

  const { data: driverRow } = await supabaseAdmin
    .from("drivers").select("commission_tier").eq("id", claimed.driver_id).maybeSingle();
  const { data: platRateRow } = await supabaseAdmin
    .from("pricing_config").select("value_cents").eq("key", "PLATFORM_RATE_CENTS").maybeSingle()
    .then((__r: any) => __r, () => ({ data: null }));
  const platRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15;
  const commissionRate = driverRow?.commission_tier === "pioneer" ? Math.max(0.01, platRate - 0.03) : platRate;
  const driverPayout = Math.round((ride.total_fare_cents || 0) * (1 - commissionRate));

  const offerExpiresAt = new Date(Date.now() + RIDE_OFFER_SECONDS * 1000).toISOString();
  const { error: offerErr } = await supabaseAdmin.from("ride_offers").insert({
    ride_id: ride.id,
    driver_id: claimed.driver_id,
    status: "pending",
    distance_meters: Math.round((claimed.distance_km ?? 0) * 1000),
    driver_payout_cents: driverPayout,
    expires_at: offerExpiresAt,
  });
  if (offerErr) throw offerErr;

  await supabaseAdmin.from("rides").update({ status: "searching" }).eq("id", ride.id).in("status", MATCHABLE_RIDE_STATUSES);

  // Stay 'pending' until a driver actually accepts -- the next round
  // (top of this function) sees the ride left 'searching' and closes the row.
  await supabaseAdmin
    .from("dispatch_queue")
    .update({ driver_id: claimed.driver_id, last_attempted: now.toISOString() })
    .eq("id", item.id);

  if (driver?.push_token) {
    const fromNetwork = tierUsed === "network" && ride.metadata?.merchant_name;
    sendPushNotification(
      driver.push_token,
      fromNetwork ? `${ride.metadata.merchant_name} has a ride for you` : "New ride request",
      fromNetwork ? "A client from your network business is waiting. Tap to view the offer." : "A rider is waiting nearby. Tap to view the offer.",
      { type: "RIDE_OFFER", ride_id: ride.id },
    ).catch((err) => console.error("Push failed for RIDE dispatch (non-fatal):", err));
  }

  return { task_id: item.id, task_type: "RIDE", status: "offered", tier: tierUsed, driver_id: claimed.driver_id, offer_expires_at: offerExpiresAt };
}

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
        // dispatch_queue_status_check has no 'expired' value -- writing it was
        // rejected every time, so timed-out rows stayed 'pending' forever.
        await supabaseAdmin.from("dispatch_queue").update({ status: "failed" }).eq("id", item.id);
      }
    }

    const activeItems = queueItems.filter(i => !i.expires_at || new Date(i.expires_at) > now);
    if (!activeItems.length) {
      return new Response(JSON.stringify({ message: "All tasks expired." }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const results = [];

    for (const item of activeItems) {
      try {
        if (item.task_type === "RIDE") {
          results.push(await dispatchRideRound(supabaseAdmin, item, now));
          continue;
        }

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
