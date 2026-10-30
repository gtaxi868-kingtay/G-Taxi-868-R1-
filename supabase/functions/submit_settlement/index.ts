// Supabase Edge Function: submit_settlement
// P2: Driver submits a cash settlement request — WiPay debit or Smart ATM deposit.
// For method = smart_atm the deposit coordinates are required and stored as
// evidence for the admin's verify decision. NOTE: there is no verified-ATM
// location table in the system, so no GPS proximity validation is performed
// here — an earlier version of this header claimed otherwise; that claim was
// false and has been removed (register: submit_settlement review block).
// Returns the settlement_requests row for the driver to track.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireDriver } from "../_shared/auth.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Sanity bound, not a business rule: a single cash settlement above TT$10,000
// is outside any plausible day's cash collection for the pilot and indicates
// a client bug or abuse. The admin verify step remains the real barrier.
const MAX_SETTLEMENT_CENTS = 1_000_000;


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Driver-only (register: submit_settlement review block): previously any
    // authenticated user — rider, merchant, anyone — could file a settlement
    // request for an arbitrary amount, and only the admin's eyeball in
    // verify_settlement stood between it and a wallet credit. requireDriver
    // enforces a registered, non-blocked driver record for the caller.
    const { user } = await requireDriver(req, supabaseAdmin);

    const body = await req.json();
    const { amount_cents, method, reference_token, receipt_photo_url, deposit_lat, deposit_lng } = body;

    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid amount_cents" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (amount_cents > MAX_SETTLEMENT_CENTS) {
      return new Response(
        JSON.stringify({ success: false, error: "amount_cents exceeds the maximum single settlement" }),
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
