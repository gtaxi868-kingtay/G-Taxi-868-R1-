// Supabase Edge Function: complete_ride
// Phase 3 Fixes Applied:
//   Fix 3.2 — Cash ride now explicitly confirms cash payment before completing (no silent continue)
//   Fix 3.4 — Status gate narrowed from ['assigned','arrived','in_progress'] to ['in_progress'] only
// Phase 6 Fix 6.3:
//   Cash commission changed from 15% to 19% (platform keeps 19% of cash fare from driver wallet)
//   Wallet split changed from 80/20 to 81/19 (81% driver, 19% platform)
//   Card rides (payment_status = 'captured' via Stripe webhook) are passed through without
//   a second charge — just mark ride completed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { sendPushNotification } from "../_shared/push.ts";

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

        // --- Fix 4.4: Idempotency guard — prevent double payment/processing ---
        if (ride.status === "completed") {
            console.log(`Ride ${ride_id} already completed. Returning early.`);
            return new Response(
                JSON.stringify({ success: true, error: null, data: { already_completed: true } }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Authorization ─────────────────────────────────────────────────────
        const { data: driverRecord } = await supabaseAdmin
            .from('drivers')
            .select('id, commission_tier, custom_commission_rate')
            .eq('user_id', userId)
            .maybeSingle();

        const isRider = ride.rider_id === userId;
        const isDriver = driverRecord ? ride.driver_id === driverRecord.id : false;

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
        // Platform split: 81% driver, 19% platform
        // DUAL CLOCK LEDGER:
        // 1. Pickup Wait: 180s (3-min) grace period. $0.90/min thereafter.
        const pickupWaitSec = ride.pickup_wait_seconds || 0;
        const billablePickupSec = Math.max(0, pickupWaitSec - 180);
        const billablePickupFareCents = Math.floor((billablePickupSec / 60) * 90);

        // 2. Stop Wait: ZERO grace period. $0.90/min per second.
        const stopWaitSec = ride.stop_wait_seconds || 0;
        const billableStopFareCents = Math.floor((stopWaitSec / 60) * 90);

        // 3. Gridlock Surcharge: $15 TTD if (Actual Duration - Estimated Duration) > 15 mins
        let gridlockSurchargeCents = 0;
        if (ride.duration_seconds && ride.status === 'in_progress') {
            const startTime = new Date(ride.updated_at).getTime(); // Last status update was 'in_progress'
            const now = new Date().getTime();
            const actualDurationSec = (now - startTime) / 1000;
            const delaySec = actualDurationSec - ride.duration_seconds;

            if (delaySec > 900) { // 15 mins
                gridlockSurchargeCents = 1500; // $15.00 TTD
                console.log(`Gridlock detected: Delay of ${Math.round(delaySec/60)} mins. Surcharge applied.`);
            }
        }

        const totalWaitFareCents = billablePickupFareCents + billableStopFareCents;
        const effectiveFare = (ride.total_fare_cents || 0) + totalWaitFareCents + gridlockSurchargeCents;

        let commissionRate = 0.22; // Default Standard
        if (driverRecord?.custom_commission_rate != null) {
            commissionRate = driverRecord.custom_commission_rate / 100;
        } else if (driverRecord?.commission_tier === 'pioneer') {
            commissionRate = 0.19;
        }
        // 17% tier removed to protect margins

        if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
            const { data: success, error: payError } = await supabaseAdmin
                .rpc("process_wallet_payment", {
                    p_ride_id: ride_id,
                    p_amount: effectiveFare
                });

            if (payError || !success) {
                console.error("Wallet payment failed:", payError);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Payment failed: Insufficient wallet funds",
                        data: { required: effectiveFare }
                    }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

        } else if (ride.payment_method === "cash") {
            const { error: cashError } = await supabaseAdmin
                .from("rides")
                .update({ cash_confirmed: true })
                .eq("id", ride_id)
                .eq("status", "in_progress");

            if (cashError) {
                console.error("Failed to confirm cash payment:", cashError);
                return new Response(
                    JSON.stringify({ success: false, error: "Failed to confirm cash payment", data: null }),
                    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const commission = Math.round(effectiveFare * commissionRate);
            await supabaseAdmin.from("wallet_transactions").insert({
                user_id: ride.driver_id,
                ride_id: ride_id,
                amount: -commission,
                transaction_type: "commission_fee",
                description: `Platform commission (${(commissionRate * 100).toFixed(0)}%) including $${((totalWaitFareCents + gridlockSurchargeCents)/100).toFixed(2)} extra fees`,
                status: "completed"
            });

            await supabaseAdmin.from("payment_ledger").insert({
                ride_id: ride_id,
                user_id: ride.rider_id,
                amount: (effectiveFare / 100.0),
                currency: "TTD",
                status: "captured",
                provider: "cash"
            });

        } else if (ride.payment_method === "card") {
            if (ride.payment_status !== "captured") {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Card payment has not been captured yet.",
                        data: { payment_status: ride.payment_status }
                    }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
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
            }, { count: 'exact' })
            .eq("id", ride_id)
            .in("status", ["in_progress"]);

        // Phase 11.5: Sync the final payout to the ride record for auditing
        await supabaseAdmin.from("rides").update({ 
            driver_payout_cents: Math.round(effectiveFare * (1 - commissionRate)) 
        }).eq("id", ride_id);

        // ── Push Notification to Rider ───────────────────────────────────────
        if (ride.rider_id) {
            const { data: riderProfile } = await supabaseAdmin
                .from('profiles')
                .select('push_token')
                .eq('id', ride.rider_id)
                .single();

            if (riderProfile?.push_token) {
                sendPushNotification(
                    riderProfile.push_token,
                    '🏁 Ride Completed',
                    `Your ride is finished. Final fare: $${(effectiveFare / 100).toFixed(2)} TTD.`,
                    { type: 'RIDE_COMPLETED', ride_id: ride.id }
                ).catch(err => console.error("Rider push failed:", err));
            }
        }

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
                data: { ride_id, status: "completed", total_fare_cents: effectiveFare },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("complete_ride error:", error);
        await captureException(error, { function: 'complete_ride' });
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
