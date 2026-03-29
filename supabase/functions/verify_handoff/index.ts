// Supabase Edge Function: verify_handoff
// Adjudicates PIN-based trust handoffs for G-TAXI Logistics (Rider-Driver-Merchant)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // 1. Authenticate (Must be Driver or Merchant to call this)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Auth Header");

    const { data: { user }, error: authError } = await createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    }).auth.getUser();

    if (authError || !user) throw new Error("Invalid User Session");

    // 2. Parse Body
    const { order_id, pin, type, items, photos } = await req.json();
    // type: 'pickup' (Rider->Driver), 'merchant' (Driver->Merchant), 'delivery' (Driver->Rider)

    if (!order_id || !pin || !type) throw new Error("order_id, pin, and type required");

    // 3. Verify PIN
    const { data: pins, error: pinError } = await supabaseAdmin
      .from("order_handoff_pins")
      .select("*")
      .eq("order_id", order_id)
      .single();

    if (pinError || !pins) throw new Error("PIN record not found for this order");

    let isMatch = false;
    let nextStatus = '';

    if (type === 'pickup') {
      isMatch = (pins.pickup_pin === pin);
      nextStatus = 'picked_up';
    } else if (type === 'merchant') {
      isMatch = (pins.merchant_pin === pin);
      nextStatus = 'processing';
    } else if (type === 'delivery') {
      isMatch = (pins.delivery_pin === pin);
      nextStatus = 'delivered';
    }

    if (!isMatch) throw new Error("Invalid PIN verification failed");

    // 4. Update Order Status
    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", order_id);

    if (updateError) throw updateError;

    // 5. If type is 'merchant' (Intake), log the items
    if (type === 'merchant' && items) {
      await supabaseAdmin.from("merchant_intake_logs").insert({
        order_id,
        items,
        photo_urls: photos || [],
        merchant_id: user.id // Assuming Merchant is calling this
      });
      // Set to 'Awaiting Rider Approval' logic?
      await supabaseAdmin.from("orders").update({ status: 'awaiting_approval' }).eq("id", order_id);
    }

    return new Response(
      JSON.stringify({ success: true, message: `Handoff ${type} verified`, status: nextStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
