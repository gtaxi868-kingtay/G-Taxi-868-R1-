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

        const { driver_id, referral_code } = await req.json();

        if (!driver_id && !referral_code) {
            return new Response(
                JSON.stringify({ success: false, error: "driver_id or referral_code required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let targetDriverId = driver_id;

        // If referral_code provided, resolve to driver_id
        if (referral_code && !driver_id) {
            const { data: codeRecord } = await supabaseAdmin
                .from("referral_codes")
                .select("user_id")
                .eq("code", referral_code)
                .eq("type", "driver")
                .maybeSingle();

            if (!codeRecord) {
                return new Response(
                    JSON.stringify({ success: false, error: "Invalid referral code" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const { data: driverRecord } = await supabaseAdmin
                .from("drivers")
                .select("id")
                .eq("user_id", codeRecord.user_id)
                .maybeSingle();

            if (!driverRecord) {
                return new Response(
                    JSON.stringify({ success: false, error: "Referral driver not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            targetDriverId = driverRecord.id;
        }

        // Verify driver exists and is active
        const { data: driver } = await supabaseAdmin
            .from("drivers")
            .select("id, user_id, name")
            .eq("id", targetDriverId)
            .eq("is_online", true)
            .single();

        if (!driver) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Driver not found or not active. Please check the referral link.",
                }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check rider doesn't already have this referral source
        const { data: existingProfile } = await supabaseAdmin
            .from("profiles")
            .select("referral_source_driver_id")
            .eq("id", user.id)
            .single();

        if (existingProfile?.referral_source_driver_id) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "You are already linked to a driver referral network",
                    data: { existing_driver_id: existingProfile.referral_source_driver_id },
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Execute the dual-link: create trust network + add member
        const { data: networkResult, error: networkErr } = await supabaseAdmin
            .rpc("create_driver_referral_network", {
                p_rider_id: user.id,
                p_driver_id: targetDriverId,
            });

        if (networkErr || networkResult?.success === false) {
            console.error("create_driver_referral_network error:", networkErr || networkResult?.error);
            return new Response(
                JSON.stringify({ success: false, error: networkResult?.error || "Failed to create referral bond" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Apply referral credit if referral_code was used
        if (referral_code) {
            const { error: applyErr } = await supabaseAdmin
                .rpc("apply_referral_code", {
                    p_referee_id: user.id,
                    p_code: referral_code,
                    p_type: "driver",
                });
            if (applyErr) console.error("apply_referral_code failed (non-fatal):", applyErr);
        }

        // Log the referral signup event
        const { error: logErr } = await supabaseAdmin
            .from("ride_events")
            .insert({
                event_type: "referral_signup",
                ride_id: null,
                metadata: {
                    rider_id: user.id,
                    driver_id: targetDriverId,
                    driver_name: driver.name,
                    referral_code: referral_code || null,
                    network_id: networkResult?.network_id,
                },
            });
        if (logErr) console.error("Failed to log referral_signup event:", logErr);

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    rider_id: user.id,
                    driver_id: targetDriverId,
                    driver_name: driver.name,
                    network_id: networkResult?.network_id,
                    trust_bonus: networkResult?.trust_bonus || 10,
                    message: `You are now linked to ${driver.name}'s trust network. Ride with confidence!`,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("referral_driver_signup error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
