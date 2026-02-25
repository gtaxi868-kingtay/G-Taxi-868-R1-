// Supabase Edge Function: complete_ride
// Phase 3 Fixes Applied:
//   Fix 3.2 — Cash ride now explicitly confirms cash payment before completing (no silent continue)
//   Fix 3.4 — Status gate narrowed from ['assigned','arrived','in_progress'] to ['in_progress'] only

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Haversine Distance Helper ---
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } }
        });

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid token", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const userId = user.id;

        // ── Parse Input ───────────────────────────────────────────────────────
        const { ride_id, driver_lat, driver_lng } = await req.json();
        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // ── Fetch Ride ────────────────────────────────────────────────────────
        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("*")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found", data: null }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Authorization ─────────────────────────────────────────────────────
        const isRider = ride.rider_id === userId;
        const isDriver = ride.driver_id === userId;

        if (!isRider && !isDriver) {
            return new Response(
                JSON.stringify({ success: false, error: "Not authorized", data: null }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Fix 3.4: Status Gate — only 'in_progress' rides can be completed ─
        // Completing from 'assigned' or 'arrived' means the ride was never
        // actually started — block this to prevent fare theft / skip abuse.
        if (ride.status !== "in_progress") {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Ride cannot be completed from status '${ride.status}'. Ride must be 'in_progress'.`,
                    data: { current_status: ride.status }
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── GPS Truth Enforcement (driver only) ───────────────────────────────
        if (isDriver) {
            if (!driver_lat || !driver_lng) {
                return new Response(
                    JSON.stringify({ success: false, error: "GPS coordinates required to complete ride", data: null }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const distMeters = getDistanceMeters(
                driver_lat, driver_lng,
                ride.dropoff_lat, ride.dropoff_lng
            );

            if (distMeters > 150) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: `Too far from dropoff. You are ${Math.round(distMeters)}m away (max 150m).`,
                        data: { distance: distMeters }
                    }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // ── Payment Handling ──────────────────────────────────────────────────

        if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
            // Wallet path: atomic RPC handles balance check, debit, and ledger write.
            const { data: success, error: payError } = await supabaseAdmin
                .rpc("process_wallet_payment", {
                    p_ride_id: ride_id,
                    p_amount: ride.total_fare_cents
                });

            if (payError || !success) {
                console.error("Wallet payment failed:", payError);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Payment failed: Insufficient wallet funds",
                        data: { required: ride.total_fare_cents }
                    }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

        } else if (ride.payment_method === "cash") {
            // ── Fix 3.2: Cash ride — block on failure, do not silently continue ──

            // Step A: Confirm cash was collected by flagging the ride.
            const { error: cashError } = await supabaseAdmin
                .from("rides")
                .update({ cash_confirmed: true })
                .eq("id", ride_id)
                .eq("status", "in_progress");

            if (cashError) {
                console.error("Failed to confirm cash payment:", cashError);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Failed to confirm cash payment",
                        data: null
                    }),
                    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // Step B: Deduct 15% platform commission from driver wallet.
            const commission = Math.round(ride.total_fare_cents * 0.15);
            const { error: commError } = await supabaseAdmin
                .from("wallet_transactions")
                .insert({
                    user_id: ride.driver_id,
                    ride_id: ride_id,
                    amount: -commission,
                    transaction_type: "commission_fee",
                    description: "Platform commission (15%) for cash ride",
                    status: "completed"
                });

            if (commError) {
                // Commission deduction failure should not block completion
                // but must be logged clearly for reconciliation.
                console.error("COMMISSION DEDUCTION FAILED — requires manual reconciliation:", commError);
            }
        }

        // ── Atomic Ride Status Update ─────────────────────────────────────────
        // Fix 3.4: The .in() here is now redundant safety — we already returned
        // above if status !== 'in_progress', but the DB constraint stays narrow.
        const { error: updateError, count } = await supabaseAdmin
            .from("rides")
            .update({
                status: "completed",
                completed_at: new Date().toISOString(),
            })
            .eq("id", ride_id)
            .in("status", ["in_progress"]);   // Fix 3.4: was ['assigned', 'arrived', 'in_progress']

        if (updateError || count === 0) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Failed to complete ride: status unexpectedly changed",
                    data: null
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: { ride_id, status: "completed", total_fare_cents: ride.total_fare_cents },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("complete_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
