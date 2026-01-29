// Supabase Edge Function: update_driver_location
// Path: supabase/functions/update_driver_location/index.ts
//
// Called by the Driver App (or simulation script) to update location.
// Writes to 'driver_locations' (history) and 'drivers' (current snapshot).
// Broadcasts Realtime event for the Rider App.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    driver_id: string; // In production, get from Auth. For MVP/Sim, body.
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
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
        const body: RequestBody = await req.json();
        const { driver_id, lat, lng, heading = 0, speed = 0 } = body;

        if (!driver_id || lat === undefined || lng === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing driver_id, lat, or lng" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Insert into history (driver_locations)
        // Fire and forget? No, we want to confirm receipt.
        const { error: historyError } = await supabase
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
            // We continue anyway? No, history is important.
            throw historyError;
        }

        // 2. Update current snapshot (drivers table) for "Ghost Car" queries
        // This allows 'get_nearby_drivers' to work fast without joining huge history table.
        // We also update 'location' geography column for PostGIS.
        const { error: snapshotError } = await supabase
            .from("drivers")
            .update({
                lat,
                lng,
                heading,
                // Make sure to sync PostGIS location!
                // We trust the database trigger 'sync_driver_location' (from 005) to handle the 'location' column update based on lat/lng.
                last_seen: new Date().toISOString() // Assuming we added this, or just updated_at
            })
            .eq("id", driver_id);

        if (snapshotError) {
            console.error("Snapshot update error:", snapshotError);
            throw snapshotError;
        }

        // 3. (Optional) Explicit Realtime Broadcast?
        // Supabase Realtime listens to DB changes.
        // Since we updated 'drivers' and 'driver_locations', the clients subscribed to:
        // 'drivers' table (filter: id=eq.driver_id) WILL get the update automatically!
        // So we don't need to manually broadcast unless we wanted a custom channel.
        // Uber Standard: Database is source of truth. Rely on Postgres WAL.

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("update_driver_location error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal Error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
