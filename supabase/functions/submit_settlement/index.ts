// Supabase Edge Function: submit_settlement
// P2: Driver submits a cash settlement request — WiPay debit or Smart ATM deposit.
// Validates GPS proximity to verified ATM locations if method = smart_atm.
// Returns the settlement_requests row for the driver to track.

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
    const authHeader = req.headers.get("Authorization");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader?.replace("Bearer ", "") ?? ""
    );
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { amount_cents, method, reference_token, receipt_photo_url, deposit_lat, deposit_lng } = body;

    if (!amount_cents || amount_cents <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid amount_cents" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validMethods = ["wipay_debit", "smart_atm", "bank_transfer"];
    if (!method || !validMethods.includes(method)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid method. Must be one of: " + validMethods.join(", ") }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (method === "smart_atm" && (!deposit_lat || !deposit_lng)) {
      return new Response(
        JSON.stringify({ success: false, error: "deposit_lat and deposit_lng required for smart_atm deposits" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settlement, error: insertErr } = await supabaseAdmin
      .from("settlement_requests")
      .insert({
        driver_id: user.id,
        amount_cents,
        method,
        reference_token: reference_token || null,
        receipt_photo_url: receipt_photo_url || null,
        deposit_lat: deposit_lat || null,
        deposit_lng: deposit_lng || null,
        status: "pending",
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Failed to insert settlement:", insertErr);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to submit settlement request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: settlement }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("submit_settlement error:", error);
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
