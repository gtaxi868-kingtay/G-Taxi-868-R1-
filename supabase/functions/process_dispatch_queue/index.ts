import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async () => {
  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch pending dispatch queue items
    const { data: queueItems, error: queueErr } = await supabaseAdmin
      .from("dispatch_queue")
      .select("id, order_id, pickup_lat, pickup_lng, attempts, delivery_method, orders(merchant_id, total_cents, delivery_fee_cents, merchants(business_name))")
      .eq("status", "pending")
      .lt("attempts", 5); // Give up after 5 attempts

    if (queueErr) throw queueErr;

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ message: "No pending dispatch items." }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const results = [];

    for (const item of queueItems) {
      try {
        const order = item.orders as any;
        const merchantName = order?.merchants?.business_name || "Merchant";
        const lat = item.pickup_lat;
        const lng = item.pickup_lng;

        if (!lat || !lng) {
          // Can't dispatch without location, mark failed
          await supabaseAdmin.from("dispatch_queue").update({ status: "failed", last_attempted: new Date().toISOString() }).eq("id", item.id);
          continue;
        }

        // Determine search radius based on attempts
        let searchRadiusMeters = 3000; // Attempt 0/1: 3km
        if (item.attempts >= 2) searchRadiusMeters = 6000;
        if (item.attempts >= 3) searchRadiusMeters = 10000;

        // Find nearest online driver within radius
        const { data: drivers } = await supabaseAdmin.rpc("find_nearest_online_drivers", {
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: searchRadiusMeters,
          p_limit: 1
        }).catch(() => ({ data: [] }));

        let selectedDriver = drivers && drivers.length > 0 ? drivers[0] : null;

        if (!selectedDriver) {
          // No driver found, increment attempts
          await supabaseAdmin
            .from("dispatch_queue")
            .update({ 
              attempts: item.attempts + 1, 
              last_attempted: new Date().toISOString(),
              status: item.attempts + 1 >= 5 ? "failed" : "pending" 
            })
            .eq("id", item.id);
            
          results.push({ order_id: item.order_id, status: "no_driver_found", attempts: item.attempts + 1 });
          continue;
        }

        // Create delivery offer
        const OFFER_TIMEOUT_SECONDS = 30;
        const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();

        const { data: offer, error: offerErr } = await supabaseAdmin
          .from("delivery_offers")
          .insert({
            order_id: item.order_id,
            driver_id: selectedDriver.driver_id,
            status: "pending",
            expires_at: expiresAt,
          })
          .select()
          .single();

        if (offerErr) throw offerErr;

        // Send Push Notification
        const deliveryFeeTTD = ((order.delivery_fee_cents ?? 0) / 100).toFixed(2);
        if (selectedDriver.push_token) {
          await sendPushNotification(
            selectedDriver.push_token,
            "New Delivery Request",
            `${merchantName} — TTD $${deliveryFeeTTD} delivery fee`,
            {
              type: "delivery_offer",
              offer_id: offer.id,
              order_id: item.order_id,
              merchant_name: merchantName,
              delivery_fee_cents: order.delivery_fee_cents,
            }
          );
        }

        // Mark as dispatched
        await supabaseAdmin
          .from("dispatch_queue")
          .update({ status: "dispatched", last_attempted: new Date().toISOString() })
          .eq("id", item.id);

        results.push({ order_id: item.order_id, status: "dispatched", driver_id: selectedDriver.driver_id });

      } catch (err: any) {
        console.error(`Dispatch failed for item ${item.id}:`, err);
        results.push({ order_id: item.order_id, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("process_dispatch_queue error:", error);
    await captureException(error, { function: "process_dispatch_queue" });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
