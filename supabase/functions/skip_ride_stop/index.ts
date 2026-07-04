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

        const { ride_id, stop_id, skip_all } = await req.json();

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: ride, error: rideErr } = await supabaseAdmin
            .from("rides")
            .select("rider_id, driver_id, status")
            .eq("id", ride_id)
            .single();

        if (rideErr || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (ride.rider_id !== user.id) {
            return new Response(
                JSON.stringify({ success: false, error: "Only rider can skip stops" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (skip_all) {
            const { data: pending, error: pendErr } = await supabaseAdmin
                .from("ride_stops")
                .select("id, stop_order, place_name")
                .eq("ride_id", ride_id)
                .eq("status", "pending")
                .order("stop_order");

            if (pendErr) {
                return new Response(
                    JSON.stringify({ success: false, error: "Failed to fetch stops" }),
                    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            for (const stop of pending || []) {
                await supabaseAdmin
                    .from("ride_stops")
                    .update({ status: "skipped" })
                    .eq("id", stop.id);

                const { error: logErr } = await supabaseAdmin
                    .from("ride_events")
                    .insert({
                        event_type: "stop_skipped",
                        ride_id,
                        metadata: { stop_id: stop.id, stop_order: stop.stop_order, place_name: stop.place_name },
                    });
                if (logErr) console.error("Failed to log stop_skipped event:", logErr);
            }

            await supabaseAdmin
                .from("rides")
                .update({ has_stops: false })
                .eq("id", ride_id);

            return new Response(
                JSON.stringify({ success: true, data: { skipped: pending?.length || 0, stop_ids: (pending || []).map((s: any) => s.id) } }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!stop_id) {
            return new Response(
                JSON.stringify({ success: false, error: "stop_id or skip_all required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: stop, error: stopErr } = await supabaseAdmin
            .from("ride_stops")
            .select("*")
            .eq("id", stop_id)
            .eq("ride_id", ride_id)
            .eq("status", "pending")
            .single();

        if (stopErr || !stop) {
            return new Response(
                JSON.stringify({ success: false, error: "Stop not found or already completed/skipped" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        await supabaseAdmin
            .from("ride_stops")
            .update({ status: "skipped" })
            .eq("id", stop_id);

        const { error: logErr } = await supabaseAdmin
            .from("ride_events")
            .insert({
                event_type: "stop_skipped",
                ride_id,
                metadata: { stop_id: stop.id, stop_order: stop.stop_order, place_name: stop.place_name },
            });
        if (logErr) console.error("Failed to log stop_skipped event:", logErr);

        const { data: remaining } = await supabaseAdmin
            .from("ride_stops")
            .select("id")
            .eq("ride_id", ride_id)
            .eq("status", "pending");

        if (!remaining || remaining.length === 0) {
            await supabaseAdmin
                .from("rides")
                .update({ has_stops: false })
                .eq("id", ride_id);
        }

        return new Response(
            JSON.stringify({ success: true, data: { skipped: stop_id, remaining: remaining?.length || 0 } }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("skip_ride_stop error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
