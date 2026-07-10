import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireAuth(req: Request) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        throw new Response(JSON.stringify({ error: "Missing authorization header" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error } = await supabaseClient.auth.getUser(
        authHeader.replace("Bearer ", "")
    );
    if (error || !user) {
        throw new Response(JSON.stringify({ error: "Invalid or expired token" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    return user;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { tag_uid, driver_id, lat, lng } = await req.json();

        if (!tag_uid || !driver_id) {
            return new Response(
                JSON.stringify({ success: false, error: "tag_uid and driver_id required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Identity check: driver_id is client-supplied, so verify the caller
        // actually IS that driver (drivers.id != auth uid — resolve via user_id)
        // before we hand back a stranger's wallet balance and ride details.
        const { data: callerDriver } = await supabaseAdmin
            .from("drivers")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (!callerDriver || callerDriver.id !== driver_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Forbidden: you are not this driver" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. Look up the keychain identity
        const { data: identityTag, error: tagErr } = await supabaseAdmin
            .from("identity_tags")
            .select("profile_id, tag_uid, is_active")
            .eq("tag_uid", tag_uid)
            .single();

        if (tagErr || !identityTag || !identityTag.is_active) {
            return new Response(
                JSON.stringify({ success: false, error: "Keychain not found or inactive" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 2. Find active ride between the keychain owner and the driver
        const { data: activeRide, error: rideErr } = await supabaseAdmin
            .from("rides")
            .select("id, status, total_fare_cents, payment_method, pickup_address, dropoff_address, driver_id, rider_id")
            .eq("rider_id", identityTag.profile_id)
            .eq("driver_id", driver_id)
            .in("status", ["assigned", "arrived", "in_progress"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (rideErr || !activeRide) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "No active ride found with this driver",
                    data: { intent: "tap_registered", tag_uid, driver_id }
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Get available wallet balance
        const { data: wallet } = await supabaseAdmin
            .from("wallets")
            .select("balance_cents")
            .eq("user_id", identityTag.profile_id)
            .maybeSingle();

        const walletBalance = wallet?.balance_cents || 0;
        const fareCents = activeRide.total_fare_cents || 0;

        // 4. Build available payment methods
        const methods: string[] = [];
        if (walletBalance >= fareCents) {
            methods.push("wallet");
        }
        methods.push("cash");
        methods.push("card");

        // 5. Log the NFC tap event
        const { error: logErr } = await supabaseAdmin
            .from("nfc_event_logs")
            .insert({
                tag_uid,
                profile_id: identityTag.profile_id,
                event_type: "settlement_tap",
                location_context: {
                    driver_id,
                    ride_id: activeRide.id,
                    lat: lat || null,
                    lng: lng || null,
                },
            });
        if (logErr) console.error("Failed to log settlement_tap event:", logErr);

        // 6. Update identity tag last_tapped_at
        const { error: tagUpdateErr } = await supabaseAdmin
            .from("identity_tags")
            .update({ last_tapped_at: new Date().toISOString() })
            .eq("tag_uid", tag_uid);
        if (tagUpdateErr) console.error("Failed to update last_tapped_at:", tagUpdateErr);

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    status: "ready",
                    ride_id: activeRide.id,
                    total_due: fareCents,
                    total_due_formatted: `TTD ${(fareCents / 100).toFixed(2)}`,
                    methods,
                    pickup_address: activeRide.pickup_address,
                    dropoff_address: activeRide.dropoff_address,
                    ride_status: activeRide.status,
                    rider_id: identityTag.profile_id,
                    wallet_balance_cents: walletBalance,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("process_nfc_settlement error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
