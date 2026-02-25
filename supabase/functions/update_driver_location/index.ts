// Supabase Edge Function: update_driver_location
// HARDENED MODE - Strict Auth Verification
//
// Called by the Driver App to update location.
// Writes to 'driver_locations' (history) and 'drivers' (current snapshot).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
        // 1. Initialize Supabase Client with Auth Context
        const authClient = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: req.headers.get("Authorization")! },
                },
            }
        );

        // 2. AUTHENTICATION (The Gatekeeper)
        // Verify the user is logged in.
        const {
            data: { user },
            error: authError,
        } = await authClient.auth.getUser();

        if (authError || !user) {
            console.error("Auth failed:", authError);
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized: Valid JWT required" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const driver_id = user.id; // STRICT usage of verified ID. Cannot spoof others.

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

        // 4. DB Interaction (Privileged)
        // We use the Service Role key to ensure we can write to the tables 
        // regardless of RLS, since we have already authenticated the user ourselves.
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
        return new Response(
            JSON.stringify({ success: false, error: error.message || "Internal Error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
