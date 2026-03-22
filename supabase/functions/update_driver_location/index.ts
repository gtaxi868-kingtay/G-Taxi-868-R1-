// Supabase Edge Function: update_driver_location
// HARDENED MODE - Strict Auth Verification & GPS Spoof Detection
//
// Called by the Driver App to update location.
// Writes to 'driver_locations' (history) and 'drivers' (current snapshot).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireDriver } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    sos?: boolean; // SOS Trigger
}

// Calculate distance in meters using Haversine formula
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth radius in meters
    const toRadians = (deg: number) => deg * (Math.PI / 180);
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { user, driver } = await requireDriver(req, adminClient);
        const driver_id = driver.id;

        // RULE 2 - Suspended driver check
        if (driver.spoof_suspended === true) {
            return new Response(
                JSON.stringify({ success: false, error: "Account suspended pending review" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const rateCheck = await checkRateLimit(adminClient, user.id, "update_driver_location");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Parse Body
        let body: RequestBody;
        try {
            body = await req.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid JSON body" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { lat, lng, heading = 0, speed = 0, sos = false } = body;

        if (lat === undefined || lng === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing lat or lng" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // --- GPS SPOOF DETECTION ---

        // STEP 1 - Fetch last known position
        const { data: historyData, error: historyFetchError } = await adminClient
            .from("driver_locations")
            .select("lat, lng, created_at")
            .eq("driver_id", driver_id)
            .order("created_at", { ascending: false })
            .limit(1);

        if (historyFetchError) {
            console.error("Error fetching location history:", historyFetchError);
            throw historyFetchError;
        }

        const lastRecord = historyData && historyData.length > 0 ? historyData[0] : null;

        if (lastRecord) {
            // STEP 2 - Calculate time delta
            const now = new Date();
            const lastTime = new Date(lastRecord.created_at);
            let timeDeltaSeconds = (now.getTime() - lastTime.getTime()) / 1000;
            if (timeDeltaSeconds <= 0) timeDeltaSeconds = 1;

            // STEP 3 - Calculate distance using Haversine
            const distanceMeters = haversine(lastRecord.lat, lastRecord.lng, lat, lng);

            // STEP 4 - Calculate implied speed
            // km/h = (meters / 1000) / (seconds / 3600)
            const impliedSpeedKmh = (distanceMeters / 1000) / (timeDeltaSeconds / 3600);

            // RULE 1 - Teleportation check
            if (impliedSpeedKmh > 250) {
                // Log the spoof attempt
                await adminClient.from("gps_spoof_log").insert({
                    driver_id,
                    reported_lat: lat,
                    reported_lng: lng,
                    last_known_lat: lastRecord.lat,
                    last_known_lng: lastRecord.lng,
                    implied_speed_kmh: impliedSpeedKmh,
                    time_delta_seconds: timeDeltaSeconds,
                    distance_meters: distanceMeters,
                    rejection_reason: "implied_speed_too_high"
                });

                // Increment flag count and potentially auto-suspend
                await adminClient.rpc("increment_spoof_flag", { p_driver_id: driver_id });

                return new Response(
                    JSON.stringify({ success: false, error: "Location update rejected: invalid movement detected" }),
                    { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // RULE 3 - Stationary jitter allowance
            if (timeDeltaSeconds < 3 && distanceMeters < 50) {
                // Normal GPS jitter. Permitted to continue down to insert/update untouched.
            }

            // --- SAFETY: SOS & DETOUR DETECTION ---
            if (sos) {
                console.warn(`[SAFETY] SOS TRIGGERED for driver ${driver_id}`);
                await adminClient.from("ride_events").insert({
                    event_type: "emergency_sos",
                    actor_type: "driver",
                    actor_id: driver_id,
                    metadata: { lat, lng, timestamp: now.toISOString() }
                });
                // Note: Twilio Hook would go here to text the Next of Kin
            }

            // DETOUR DETECTION
            // Fetch active ride to check destination drift
            const { data: activeRide } = await adminClient
                .from("rides")
                .select("id, status, destination_lat, destination_lng")
                .eq("driver_id", driver_id)
                .in("status", ["in_progress"])
                .maybeSingle();

            if (activeRide && activeRide.destination_lat) {
                const distToDest = haversine(lat, lng, activeRide.destination_lat, activeRide.destination_lng);
                const lastDistToDest = haversine(lastRecord.lat, lastRecord.lng, activeRide.destination_lat, activeRide.destination_lng);

                // If moving AWAY from destination by more than 500m in one update sequence 
                // OR if very far from destination while 'in_progress'
                if (distToDest > lastDistToDest + 500) {
                    await adminClient.from("ride_events").insert({
                        ride_id: activeRide.id,
                        event_type: "safety_detour_detected",
                        actor_type: "system",
                        metadata: {
                            current_dist: Math.round(distToDest),
                            prev_dist: Math.round(lastDistToDest),
                            lat, lng
                        }
                    });
                }
            }
            // --- END SAFETY ---
        }

        // --- END SPOOF DETECTION ---

        // A. Insert into history (driver_locations)
        const { error: historyError } = await adminClient
            .from("driver_locations")
            .insert({
                driver_id,
                lat,
                lng,
                heading,
                speed
            });

        if (historyError) {
            console.error("History insert error:", historyError);
            throw historyError;
        }

        // B. Update current snapshot (drivers table)
        // This keeps the "Ghost Cars" and distance calcs fresh.
        const { error: snapshotError } = await adminClient
            .from("drivers")
            .update({
                lat,
                lng,
                heading,
                is_online: true, // Implicitly mark as online if sending updates
                last_seen: new Date().toISOString()
            })
            .eq("id", driver_id);

        if (snapshotError) {
            console.error("Snapshot update error:", snapshotError);
            throw snapshotError;
        }

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("update_driver_location error:", error);
        if (error instanceof Response) return error;
        return new Response(
            JSON.stringify({ success: false, error: error.message || "Internal Error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
