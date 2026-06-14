import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { order_id } = await req.json();
    if (!order_id) throw new Error("order_id required");

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, rider_id, merchant_id, total_cents, delivery_fee_cents, status, merchants(business_name, address)")
      .eq("id", order_id)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    const OFFER_TIMEOUT_SECONDS = 20;
    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();

    let selectedDriver: { id: string; push_token: string | null } | null = null;
    let matchType = "broadcast";

    // 1. Try preferred drivers first
    const { data: preferred } = await supabase
      .from("user_preferred_drivers")
      .select("driver_id, drivers!inner(id, push_token, is_online)")
      .eq("user_id", order.rider_id)
      .order("rank", { ascending: true });

    if (preferred?.length) {
      for (const p of preferred) {
        const d = p.drivers as any;
        if (d?.is_online) {
          selectedDriver = { id: p.driver_id, push_token: d.push_token };
          matchType = "preferred";
          break;
        }
      }
    }

    // 2. Fall back to nearest online driver
    if (!selectedDriver) {
      const { data: nearest } = await supabase
        .from("drivers")
        .select("id, push_token")
        .eq("is_online", true)
        .limit(1)
        .maybeSingle();

      if (nearest) {
        selectedDriver = nearest;
        matchType = "nearest";
      }
    }

    if (!selectedDriver) {
      // No driver available — queue for platform_intelligence cron to retry
      await supabase
        .from("dispatch_queue")
        .upsert({ order_id, delivery_method: "driver", status: "pending" }, { onConflict: "order_id" });

      return new Response(
        JSON.stringify({ success: true, match_type: "queued", driver_id: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Insert delivery_offer so the driver app can subscribe and show DeliveryRequestScreen
    const { data: offer, error: offerErr } = await supabase
      .from("delivery_offers")
      .insert({
        order_id,
        driver_id: selectedDriver.id,
        status: "pending",
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (offerErr) throw new Error(`delivery_offer insert failed: ${offerErr.message}`);

    // 4. Push notification — include offer_id and order details so the app can deep-link
    const merchantName = (order.merchants as any)?.business_name ?? "Merchant";
    const deliveryFeeTTD = ((order.delivery_fee_cents ?? 0) / 100).toFixed(2);

    if (selectedDriver.push_token) {
      await sendPushNotification(
        selectedDriver.push_token,
        "Delivery Order",
        `${merchantName} — TTD $${deliveryFeeTTD} delivery fee`,
        {
          type: "delivery_offer",
          offer_id: offer.id,
          order_id,
          merchant_name: merchantName,
          delivery_fee_cents: order.delivery_fee_cents,
          total_cents: order.total_cents,
        }
      );
    }

    // 5. Update dispatch_queue entry to dispatched
    await supabase
      .from("dispatch_queue")
      .upsert({ order_id, delivery_method: "driver", status: "dispatched", ride_id: null }, { onConflict: "order_id" });

    return new Response(
      JSON.stringify({ success: true, match_type: matchType, driver_id: selectedDriver.id, offer_id: offer.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
