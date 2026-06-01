// Supabase Edge Function: accept_ride
// Path: supabase/functions/accept_ride/index.ts
//
// Called by Driver App when satisfying a ride request.
// Atomic transaction to lock the ride.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireDriver } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { sendPushNotification } from "../_shared/push.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    ride_id: string;
}

serve(async (req: Request) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { user, driver } = await requireDriver(req, supabaseAdmin);

        const rateCheck = await checkRateLimit(supabaseAdmin, user.id, "accept_ride");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body: RequestBody = await req.json();
        const { ride_id } = body;

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing ride_id" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── DRIVER CAPACITY CHECK ─────────────────────────────────
        // Prevent driver from accepting if they already have an active ride
        const { data: activeRides, error: activeRidesError } = await supabaseAdmin
            .from("rides")
            .select("id, status")
            .eq("driver_id", driver.id)
            .in("status", ["assigned", "arrived", "in_progress"]);

        if (activeRidesError) {
            console.error("Capacity check failed:", activeRidesError);
            return new Response(
                JSON.stringify({ success: false, error: "System error checking driver capacity" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (activeRides && activeRides.length > 0) {
            console.error(`Driver ${driver.id} attempted to accept ride ${ride_id} but already has active ride(s):`, activeRides);
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: "You already have an active ride. Complete it before accepting a new one.",
                    details: {
                        active_ride_count: activeRides.length,
                        active_ride_ids: activeRides.map(r => r.id)
                    }
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. ATOMIC OFFER LOCK
        // Verify this driver actually holds a 'pending' offer for this ride.
        const { data: offer, error: offerError } = await supabaseAdmin
            .from("ride_offers")
            .update({ status: "accepted" })
            .eq("ride_id", ride_id)
            .eq("driver_id", driver.id)
            .eq("status", "pending")
            .select()
            .single();

        if (offerError || !offer) {
            console.error("Accept failed: Offer expired or invalid", offerError);
            return new Response(
                JSON.stringify({ success: false, error: "Offer expired or no longer available" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 2. ATOMIC RIDE ASSIGNMENT
        // Only update if status is 'searching' or 'requested'.
        // This prevents race conditions where two drivers accept same ride.
        const { data, error } = await supabaseAdmin
            .from("rides")
            .update({
                status: "assigned",
                driver_id: driver.id,
                updated_at: new Date().toISOString()
            })
            .eq("id", ride_id)
            .in("status", ["requested", "searching"]) // CRITICAL: Concurrency Control
            .select()
            .single();

        if (error || !data) {
            console.error("Accept failed:", error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Ride unavailable or already taken."
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Push Notification to Rider ─────────────────────────────────────
        try {
            const { data: riderProfile } = await supabaseAdmin
                .from("profiles")
                .select("push_token, notification_enabled")
                .eq("id", data.rider_id)
                .single();

            const driverName = driver.name || driver.vehicle_model || "a driver";
            const vehicleInfo = driver.vehicle_model && driver.plate_number
                ? `${driver.vehicle_model} (${driver.plate_number})`
                : "";

            if (riderProfile?.push_token && riderProfile?.notification_enabled !== false) {
                sendPushNotification(
                    riderProfile.push_token,
                    '🚖 Driver Assigned',
                    `${driverName} ${vehicleInfo} is on the way to pick you up!`,
                    { type: 'DRIVER_ASSIGNED', ride_id, driver_id: driver.id }
                ).catch(err => console.error("Rider accept push failed:", err));
            }
        } catch (err) {
            console.error("Failed to send acceptance push (non-fatal):", err);
        }

        // 2. Log Event
        await supabaseAdmin.from("user_events").insert({
            user_id: user.id,
            event_type: "ride_accepted",
            metadata: { ride_id, driver_id: driver.id }
        });

        return new Response(
            JSON.stringify({ success: true, data }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("accept_ride error:", error);
        if (error instanceof Response) return error;
        await captureException(error, { function: "accept_ride" });

        return new Response(
            JSON.stringify({ success: false, error: typeof error === "string" ? error : (error?.message || "Internal Error") }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
