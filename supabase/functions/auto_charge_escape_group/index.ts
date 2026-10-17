// Supabase Edge Function: auto_charge_escape_group
//
// The missing capture stage of the G-Escape flight-anchored flow.
//
// book_escape places a Stripe pre-auth (capture_method:'manual') and writes the
// reservation as ACTIVE_HOLD. check_flight_tipping_points() (DB function)
// CONFIRMS a flight block once it fills and builds the itinerary + ledger — but
// ONLY for reservations already in status='CAPTURED'. Nothing moved reservations
// from ACTIVE_HOLD to CAPTURED, so confirmed flights produced zero itineraries.
// This function is that stage.
//
// Design (customer-safe):
//   1. Consider POOLING flight blocks whose cancel_deadline has passed AND that
//      have already met their tipping point (allocated_seats >= tipping_point).
//      We only ever capture money for flights that are going to happen — no
//      charge-then-refund. Non-viable blocks are left for the tipping check to
//      cancel (their holds simply expire / are released).
//   2. For each ACTIVE_HOLD reservation on those blocks that has a Stripe intent,
//      capture the pre-auth and flip it to CAPTURED. Idempotent and per-row
//      fault-isolated: an already-captured intent is reconciled, a failed
//      capture leaves the row ACTIVE_HOLD for the next run.
//   3. Immediately run check_flight_tipping_points() so capture→confirm happens
//      in the same 5-minute tick (removes any dependence on the 6am job firing
//      after us). The daily job remains a redundant safety net.
//
// Wallet-path reservations are captured synchronously inside book_escape, so
// they are skipped here (guarded by stripe_payment_intent_id IS NOT NULL).
//
// Runs with no Stripe key configured as a clean no-op (200) so the cron never
// error-loops before STRIPE_SECRET_KEY is set.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // No Stripe key yet — clean no-op so the cron doesn't error-loop.
  if (!STRIPE_SECRET_KEY) {
    return json({ skipped: "stripe_not_configured", captured: 0 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

  try {
    // 1. Viable blocks past their deadline: they WILL confirm, so capturing is safe.
    const { data: blocks, error: blockErr } = await supabase
      .from("flight_blocks")
      .select("id, allocated_seats, tipping_point_seats")
      .eq("status", "POOLING")
      .lte("cancel_deadline", new Date().toISOString());

    if (blockErr) throw blockErr;

    const viableBlockIds = (blocks || [])
      .filter((b) => (b.allocated_seats ?? 0) >= (b.tipping_point_seats ?? Number.MAX_SAFE_INTEGER))
      .map((b) => b.id);

    const results: Array<{ reservation_id: string; status: string; detail?: string }> = [];

    if (viableBlockIds.length > 0) {
      const { data: reservations, error: resErr } = await supabase
        .from("package_reservations")
        .select("id, stripe_payment_intent_id, status")
        .in("flight_block_id", viableBlockIds)
        .eq("status", "ACTIVE_HOLD")
        .not("stripe_payment_intent_id", "is", null);

      if (resErr) throw resErr;

      for (const res of reservations || []) {
        try {
          const pi = await stripe.paymentIntents.retrieve(res.stripe_payment_intent_id!);

          if (pi.status === "requires_capture") {
            await stripe.paymentIntents.capture(res.stripe_payment_intent_id!);
          } else if (pi.status !== "succeeded") {
            // canceled / requires_payment_method / etc — not capturable. Leave the
            // row ACTIVE_HOLD; the tipping check will cancel it if it never resolves.
            results.push({ reservation_id: res.id, status: "skipped", detail: `pi_${pi.status}` });
            continue;
          }
          // pi is now (or already) captured — reconcile the row. Guard on the
          // current status so concurrent runs can't double-flip.
          const { error: updErr } = await supabase
            .from("package_reservations")
            .update({ status: "CAPTURED", captured_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", res.id)
            .eq("status", "ACTIVE_HOLD");

          if (updErr) throw updErr;
          results.push({ reservation_id: res.id, status: "captured" });
        } catch (err: any) {
          console.error(`[auto_charge_escape_group] capture failed for ${res.id}:`, err?.message || err);
          results.push({ reservation_id: res.id, status: "error", detail: err?.message });
        }
      }
    }

    // 2. Confirm/cancel now that viable blocks have CAPTURED reservations. Idempotent.
    const { error: tipErr } = await supabase.rpc("check_flight_tipping_points");
    if (tipErr) console.error("[auto_charge_escape_group] tipping check failed:", tipErr.message);

    const captured = results.filter((r) => r.status === "captured").length;
    return json({
      success: true,
      viable_blocks: viableBlockIds.length,
      captured,
      tipping_check: tipErr ? "error" : "ran",
      results,
    });
  } catch (err: any) {
    console.error("[auto_charge_escape_group] error:", err?.message || err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
