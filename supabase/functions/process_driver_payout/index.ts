import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { supabaseAdmin } = await requireAdmin(req);

        const { payout_id, action, rejection_reason } = await req.json();

        if (!payout_id || !action) {
            return new Response(JSON.stringify({ error: "payout_id and action are required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (action === "complete") {
            const { data: payout, error: updateError } = await supabaseAdmin
                .from("payout_requests")
                .update({ status: "completed", processed_at: new Date().toISOString() })
                .eq("id", payout_id)
                .eq("status", "pending")
                .select("id, driver_id, amount_cents");

            if (updateError) throw updateError;

            if (!payout || payout.length === 0) {
                return new Response(JSON.stringify({ error: "Payout already processed or not found" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            const { error: walletError } = await supabaseAdmin
                .from("wallet_transactions")
                .insert({
                    user_id: payout[0].driver_id,
                    amount: -Math.abs(payout[0].amount_cents),
                    transaction_type: "payout",
                    description: `Payout processed: $${(payout[0].amount_cents / 100).toFixed(2)} TTD`,
                    status: "completed",
                });

            if (walletError) {
                console.error("Failed to record payout wallet transaction:", walletError);
            }

            return new Response(JSON.stringify({ success: true, payout_id, action: "completed" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (action === "reject") {
            const { error: rejectError } = await supabaseAdmin
                .from("payout_requests")
                .update({
                    status: "rejected",
                    rejection_reason: rejection_reason || "No reason provided",
                })
                .eq("id", payout_id);

            if (rejectError) throw rejectError;

            return new Response(JSON.stringify({ success: true, payout_id, action: "rejected" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: "Invalid action. Use 'complete' or 'reject'." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        if (err instanceof Response) return err;
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
