// Supabase Edge Function: cancel_ride
//
// Cancels a ride request. Rider or the assigned driver may cancel.
//
// All the actual state-mutation (fee math, driver-identity resolution,
// acceptance-rate penalty, ride_offers cleanup, the atomic status update)
// lives in cancel_ride_atomic() (Postgres, SECURITY DEFINER, service_role
// only) -- this file only does auth/ownership verification, then reports
// the result. Moved there 2026-08-16 to close a TOCTOU race (the old inline
// version decided the cancellation fee off a stale pre-fetched ride row)
// and a silent identity bug (the fee credit targeted rides.driver_id
// directly, which is drivers.id not an auth user id, violating the
// wallet_transactions FK on every single "nearby cancellation" -- the fee
// never actually charged, and the error was swallowed).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
        // 1. AUTHENTICATION
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

        // 2. PARSE INPUT
        const { ride_id, reason } = await req.json();
        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 3. GET RIDE AND VERIFY OWNERSHIP
        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("id, rider_id, driver_id")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found", data: null }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Security: Allow rider OR assigned driver to cancel
        const isRider = ride.rider_id === userId;

        let isDriver = false;
        if (ride.driver_id) {
            const { data: driverData } = await supabaseAdmin
                .from("drivers")
                .select("user_id")
                .eq("id", ride.driver_id)
                .single();

            isDriver = driverData?.user_id === userId;
        }

        if (!isRider && !isDriver) {
            return new Response(
                JSON.stringify({ success: false, error: "Not authorized to cancel this ride", data: null }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. ATOMIC CANCELLATION (fee math, driver identity, acceptance-rate
        // penalty, ride_offers cleanup, and the status update all happen
        // together, against the ride row locked at the moment of decision --
        // not a value read earlier in this request.)
        const { data: result, error: rpcError } = await supabaseAdmin
            .rpc("cancel_ride_atomic", {
                p_ride_id: ride_id,
                p_is_rider: isRider,
                p_is_driver: isDriver,
                p_reason: reason || null,
            });

        if (rpcError || !result?.success) {
            const message = result?.error || rpcError?.message || "Ride cannot be cancelled";
            console.error("Cancel ride failed:", { ride_id, message, rpcError });
            return new Response(
                JSON.stringify({ success: false, error: message, data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Push Notification on Cancellation ───────────────────────────────
        // Notify the DRIVER if the RIDER cancels
        if (isRider && result.driver_id) {
            const { data: driverProfile } = await supabaseAdmin
                .from('drivers')
                .select('push_token')
                .eq('id', result.driver_id)
                .single();

            if (driverProfile?.push_token) {
                sendPushNotification(
                    driverProfile.push_token,
                    '🛑 Ride Cancelled',
                    result.fee_charged
                        ? 'The rider has cancelled. You have been compensated $5 TTD for the trip to pickup. You are now available for new orders.'
                        : 'The rider has cancelled the request. You are now available for new orders.',
                    { type: 'RIDE_CANCELLED', ride_id }
                ).catch(err => console.error("Driver cancel notification failed:", err));
            }
        }

        // Notify the RIDER if the DRIVER cancels
        if (isDriver && result.rider_id) {
            const { data: riderProfile } = await supabaseAdmin
                .from('profiles')
                .select('push_token')
                .eq('id', result.rider_id)
                .single();

            if (riderProfile?.push_token) {
                // Nothing automatically re-dispatches this ride to another
                // driver -- the rider has to request again. Previously this
                // claimed "we are looking for a new driver for you," which
                // was never true.
                sendPushNotification(
                    riderProfile.push_token,
                    '🛑 Driver Cancelled',
                    'Your driver has cancelled the ride. Please request a new ride.',
                    { type: 'RIDE_CANCELLED', ride_id }
                ).catch(err => console.error("Rider cancel notification failed:", err));
            }
        }

        // AI LAYER: Log ride_cancelled event
        await supabaseAdmin.from("user_events").insert({
            user_id: userId,
            event_type: "ride_cancelled",
            payload: {
                ride_id,
                reason: reason || (isRider ? "Rider cancelled" : "Driver cancelled"),
                was_rider: isRider,
                fee_charged: result.fee_charged,
            }
        }).then((res) => res, (err: unknown) => console.error("user_events insert failed (non-fatal):", err));

        // Rider-side repeated-cancellation tracking (profiles.cancellation_count
        // existed with no writer anywhere -- wired here so a pattern of
        // cancellations is at least visible for future fraud/abuse review).
        if (isRider) {
            await supabaseAdmin
                .rpc("increment_rider_cancellation_count", { p_rider_id: userId })
                .then((res) => res, (err: unknown) => console.error("cancellation_count update failed (non-fatal):", err));
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id,
                    status: "cancelled",
                    fee_charged: result.fee_charged,
                    fee_cents: result.fee_cents,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Cancel ride error:", error);
        await captureException(error, { function: "cancel_ride" });
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
