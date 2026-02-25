// Supabase Edge Function: update_driver_location
// HARDENED MODE - Strict Auth Verification
//
// Called by the Driver App to update location.
// Writes to 'driver_locations' (history) and 'drivers' (current snapshot).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireDriver } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
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
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { user, driver } = await requireDriver(req, adminClient);
        const driver_id = driver.id;

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

        const { lat, lng, heading = 0, speed = 0 } = body;

        if (lat === undefined || lng === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing lat or lng" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

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
