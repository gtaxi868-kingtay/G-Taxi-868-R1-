// Supabase Edge Function: match_order_delivery
// "Smart Dispatch" for Logistics (Grocery/Laundry) orders

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { order_id } = await req.json();

    if (!order_id) throw new Error("order_id required");

    // 1. Fetch Order and Rider details
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, rider_id")
      .eq("id", order_id)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    // 2. CHECK FAVORED DRIVERS
    const { data: preferred } = await supabaseAdmin
      .from("user_preferred_drivers")
      .select("driver_id, drivers(push_token, is_online, lat, lng)")
      .eq("user_id", order.rider_id)
      .order('rank', { ascending: true });

    let selectedDriverId = null;

    if (preferred && preferred.length > 0) {
      for (const p of preferred) {
        const d = p.drivers;
        if (d.is_online) {
          // In production, check Haversine distance here (< 5km)
          selectedDriverId = p.driver_id;
          
          // Notify Favored Driver (Priority)
          if (d.push_token) {
            await sendPushNotification(d.push_token, "⭐ Priority Order", "Your favored rider has a new order! Tap to accept.");
          }
          break; 
        }
      }
    }

    // 3. FALLBACK: Normal Dispatch (Broadcasting)
    // If no favored driver found or they decline, the system normally broadcasts to nearby couriers.
    // For now, we return the match status.

    return new Response(
      JSON.stringify({ 
        success: true, 
        match_type: selectedDriverId ? "preferred" : "broadcast",
        driver_id: selectedDriverId || "pending_broadcast"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
