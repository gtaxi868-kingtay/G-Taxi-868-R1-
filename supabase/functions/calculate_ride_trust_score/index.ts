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

        const { ride_id } = await req.json();

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: ride, error: rideErr } = await supabaseAdmin
            .from("rides")
            .select("rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
            .eq("id", ride_id)
            .single();

        if (rideErr || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Authorization: the rider on the ride, the assigned driver (post-accept,
        // rides.driver_id holds drivers.id — resolve via drivers.user_id), or a
        // driver who currently holds a ride_offers row for this ride (pre-accept,
        // which is when the driver app actually needs this score).
        let isAuthorized = ride.rider_id === user.id;
        let callerDriverId: string | null = null;

        if (!isAuthorized) {
            const { data: callerDriver } = await supabaseAdmin
                .from("drivers")
                .select("id")
                .eq("user_id", user.id)
                .maybeSingle();
            callerDriverId = callerDriver?.id || null;

            if (callerDriverId && ride.driver_id === callerDriverId) {
                isAuthorized = true;
            } else if (callerDriverId) {
                const { data: offer } = await supabaseAdmin
                    .from("ride_offers")
                    .select("id")
                    .eq("ride_id", ride_id)
                    .eq("driver_id", callerDriverId)
                    .maybeSingle();
                isAuthorized = !!offer;
            }
        }

        if (!isAuthorized) {
            return new Response(
                JSON.stringify({ success: false, error: "Forbidden" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: trustResult, error: calcErr } = await supabaseAdmin.rpc(
            "calculate_ride_trust_score",
            {
                p_rider_id: ride.rider_id,
                p_pickup_lat: ride.pickup_lat,
                p_pickup_lng: ride.pickup_lng,
                p_dropoff_lat: ride.dropoff_lat || ride.pickup_lat,
                p_dropoff_lng: ride.dropoff_lng || ride.pickup_lng,
            }
        );

        if (calcErr) {
            console.error("calculate_ride_trust_score RPC error:", calcErr);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to calculate trust score" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let trustNetworkBonus = 0;
        let networkCount = 0;
        const { data: networkMemberships } = await supabaseAdmin
            .from("trust_network_members")
            .select("network_id")
            .eq("user_id", ride.rider_id);

        if (networkMemberships && networkMemberships.length > 0) {
            networkCount = networkMemberships.length;
            const networkIds = networkMemberships.map((n: any) => n.network_id);
            const { data: networks } = await supabaseAdmin
                .from("trust_networks")
                .select("trust_bonus")
                .in("id", networkIds);

            if (networks) {
                trustNetworkBonus = networks.reduce((sum: number, n: any) => sum + (n.trust_bonus || 0), 0);
            }
        }

        const trustData = Array.isArray(trustResult) ? trustResult[0] : trustResult;
        const baseScore = trustData?.score || 0;
        const intersections = trustData?.intersections || 0;

        const finalScore = Math.min(100, baseScore + trustNetworkBonus);
        let badge = "STANDARD";
        if (finalScore >= 50 && intersections >= 3) badge = "VERIFIED_SAFE";
        else if (finalScore >= 30) badge = "SAFE_ROUTE";

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    score: baseScore,
                    badge,
                    intersections,
                    trust_network_bonus: trustNetworkBonus,
                    network_count: networkCount,
                    final_score: finalScore,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("calculate_ride_trust_score error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
