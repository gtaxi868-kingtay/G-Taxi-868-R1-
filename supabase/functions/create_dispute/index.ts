import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { ride_id, subject, description, category, priority } = await req.json();

        if (!subject || !description) {
            return new Response(JSON.stringify({ error: "subject and description are required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const validCategories = ["overcharge", "double_charge", "driver_issue", "safety", "lost_item", "refund_request", "account", "other"];
        const resolvedCategory = validCategories.includes(category) ? category : "other";

        const { data: ticket, error: insertError } = await supabase
            .from("support_tickets")
            .insert({
                user_id: user.id,
                ride_id: ride_id || null,
                subject,
                description,
                category: resolvedCategory,
                status: "open",
                priority: priority === "urgent" || priority === "high" ? priority : "normal",
            })
            .select()
            .single();

        if (insertError) throw insertError;

        return new Response(JSON.stringify({
            success: true,
            ticket: {
                id: ticket.id,
                subject: ticket.subject,
                category: ticket.category,
                status: ticket.status,
                priority: ticket.priority,
                created_at: ticket.created_at,
            },
        }), {
            status: 200,
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
