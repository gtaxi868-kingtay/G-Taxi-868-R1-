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

        const { ride_id, method, tag_uid } = await req.json();

        if (!ride_id || !method) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id and method required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!["wallet", "card", "cash"].includes(method)) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid method. Must be wallet, card, or cash" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify caller owns this ride. rides.driver_id holds drivers.id, not
        // the auth uid, so the driver side must resolve through drivers.user_id.
        const { data: ride, error: rideErr } = await supabaseAdmin
            .from("rides")
            .select("rider_id, driver_id, total_fare_cents, status, payment_status")
            .eq("id", ride_id)
            .single();

        if (rideErr || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let isAuthorized = ride.rider_id === user.id;
        if (!isAuthorized && ride.driver_id) {
            const { data: callerDriver } = await supabaseAdmin
                .from("drivers")
                .select("id")
                .eq("user_id", user.id)
                .maybeSingle();
            isAuthorized = !!callerDriver && callerDriver.id === ride.driver_id;
        }

        if (!isAuthorized) {
            return new Response(
                JSON.stringify({ success: false, error: "Forbidden" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!["assigned", "arrived", "in_progress"].includes(ride.status)) {
            return new Response(
                JSON.stringify({ success: false, error: `Cannot settle ride in status '${ride.status}'` }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const fareCents = ride.total_fare_cents || 0;

        if (method === "wallet") {
            const { data: walletResult, error: payError } = await supabaseAdmin.rpc(
                "process_wallet_payment_hardened",
                {
                    p_ride_id: ride_id,
                    p_amount: fareCents,
                    p_idempotency_key: `confirm_payment_${ride_id}`,
                }
            );

            // process_wallet_payment_hardened RETURNS TABLE — PostgREST hands
            // back an array of one row; the row's own `success` field is the
            // real outcome, not just whether the RPC call itself errored.
            const walletRow = Array.isArray(walletResult) ? walletResult[0] : walletResult;

            if (payError || !walletRow?.success) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: walletRow?.error_message || "Wallet payment failed: insufficient funds",
                    }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            await supabaseAdmin
                .from("rides")
                .update({ payment_status: "captured", payment_method: "wallet" })
                .eq("id", ride_id);
        } else if (method === "cash") {
            await supabaseAdmin
                .from("rides")
                .update({ cash_confirmed: true, payment_method: "cash" })
                .eq("id", ride_id);
        } else if (method === "card") {
            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        action_required: "card_authorization",
                        ride_id,
                        amount_cents: fareCents,
                        message: "Please complete card payment via the payment sheet",
                    },
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { error: logErr } = await supabaseAdmin
            .from("ride_events")
            .insert({
                event_type: "payment_confirmed",
                ride_id,
                metadata: { method, source: tag_uid ? "nfc_flow" : "app" },
            });
        if (logErr) console.error("Failed to log payment_confirmed event:", logErr);

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    ride_id,
                    method,
                    amount_cents: fareCents,
                    status: "confirmed",
                    message: method === "wallet"
                        ? "Payment confirmed from wallet"
                        : method === "cash"
                        ? "Cash payment recorded"
                        : "Card payment initiated",
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("confirm_nfc_payment error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
