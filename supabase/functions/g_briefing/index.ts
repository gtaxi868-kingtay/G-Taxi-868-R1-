// supabase/functions/g_briefing/index.ts
// "G, what's up?" — assembles the owner's brief with PURE SQL. The LLM never
// invents a number: pass ?prose=true to get a narrated version of the same JSON.
//
// Auth: x-cron-secret (PLATFORM_CRON_SECRET — the laptop cockpit carries the
// same secret) OR an admin JWT. Deployed with verify_jwt=false because the
// cockpit path has no JWT; the guard below is the auth.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError } from "../_shared/llm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function isAuthorized(req: Request): Promise<boolean> {
    const cronHeader = req.headers.get("x-cron-secret");
    if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) return true;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return false;
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return false;
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    if (!(await isAuthorized(req))) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const wantProse = url.searchParams.get("prose") === "true";

    const todayStart = new Date();
    todayStart.setUTCHours(4, 0, 0, 0); // midnight in Trinidad (UTC-4)
    if (todayStart.getTime() > Date.now()) todayStart.setUTCDate(todayStart.getUTCDate() - 1);
    const dayIso = todayStart.toISOString();
    const weekIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    try {
        const [
            pendingProposals,
            cronHealth,
            openTickets,
            pendingDrivers,
            pendingNodes,
            ridesToday,
            ridesWeek,
            ordersToday,
            debtRows,
            cancelledToday,
            decisions24h,
            executed24h,
            alerts24h,
            socialRecent,
        ] = await Promise.all([
            supabase.from("g_proposed_actions")
                .select("id, department, action_type, title, category, amount_cents, created_at")
                .eq("status", "pending").order("created_at", { ascending: false }).limit(20),
            supabase.rpc("g_cron_health"),
            supabase.from("support_tickets").select("id", { count: "exact", head: true })
                .in("status", ["open", "pending"]),
            supabase.from("drivers").select("id", { count: "exact", head: true })
                .eq("is_verified", false),
            supabase.from("kiosk_nodes").select("id", { count: "exact", head: true })
                .eq("provision_status", "pending_review"),
            supabase.from("rides").select("total_fare_cents, platform_fee_cents")
                .in("status", ["completed", "payment_confirmed", "closed"]).gte("created_at", dayIso),
            supabase.from("rides").select("total_fare_cents, platform_fee_cents")
                .in("status", ["completed", "payment_confirmed", "closed"]).gte("created_at", weekIso),
            supabase.from("orders").select("total_cents").gte("created_at", dayIso),
            supabase.from("wallet_transactions").select("amount")
                .eq("transaction_type", "commission_debt"),
            supabase.from("rides").select("id", { count: "exact", head: true })
                .eq("status", "cancelled").gte("created_at", dayIso),
            supabase.from("agent_decision_log").select("decision_type, department")
                .gte("created_at", dayAgoIso).limit(500),
            supabase.from("g_proposed_actions").select("id", { count: "exact", head: true })
                .eq("status", "executed").gte("decided_at", dayAgoIso),
            supabase.from("system_alerts").select("type, severity, title, created_at")
                .is("resolved_at", null).gte("created_at", dayAgoIso)
                .order("created_at", { ascending: false }).limit(10),
            supabase.from("g_social_metrics").select("platform, post_ref, caption, metrics, posted_at")
                .order("posted_at", { ascending: false }).limit(5),
        ]);

        const failingJobs = (cronHealth.data ?? []).filter(
            (j: { active: boolean; last_status: string | null }) => j.active && j.last_status === "failed",
        );

        const sumCents = (rows: Array<{ total_fare_cents?: number | null; platform_fee_cents?: number | null }> | null, key: "total_fare_cents" | "platform_fee_cents") =>
            (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);

        const debtOutstandingCents = (debtRows.data ?? []).reduce(
            (s: number, r: { amount: number | null }) => s + Math.abs(Number(r.amount ?? 0)), 0,
        );

        const decisionCounts: Record<string, number> = {};
        for (const d of decisions24h.data ?? []) {
            const k = `${d.department ?? "platform"}:${d.decision_type}`;
            decisionCounts[k] = (decisionCounts[k] ?? 0) + 1;
        }

        const brief = {
            generated_at: new Date().toISOString(),
            attention: {
                pending_proposals: pendingProposals.data ?? [],
                failing_cron_jobs: failingJobs,
                open_alerts: alerts24h.data ?? [],
                open_support_tickets: openTickets.count ?? 0,
                drivers_awaiting_approval: pendingDrivers.count ?? 0,
                nodes_awaiting_review: pendingNodes.count ?? 0,
            },
            money: {
                gross_fares_today_cents: sumCents(ridesToday.data, "total_fare_cents"),
                platform_take_today_cents: sumCents(ridesToday.data, "platform_fee_cents"),
                gross_fares_7d_cents: sumCents(ridesWeek.data, "total_fare_cents"),
                platform_take_7d_cents: sumCents(ridesWeek.data, "platform_fee_cents"),
                order_volume_today_cents: (ordersToday.data ?? []).reduce(
                    (s: number, r: { total_cents: number | null }) => s + Number(r.total_cents ?? 0), 0,
                ),
                driver_debt_outstanding_cents: debtOutstandingCents,
                currency: "TTD",
            },
            ops: {
                rides_finished_today: ridesToday.data?.length ?? 0,
                rides_cancelled_today: cancelledToday.count ?? 0,
                orders_today: ordersToday.data?.length ?? 0,
                cron_jobs_total: cronHealth.data?.length ?? 0,
                cron_jobs_failing: failingJobs.length,
            },
            engagement: {
                recent_posts: socialRecent.data ?? [],
            },
            g_activity: {
                decisions_24h: decisionCounts,
                proposals_pending: pendingProposals.data?.length ?? 0,
                proposals_executed_24h: executed24h.count ?? 0,
            },
        };

        if (!wantProse || !llmConfigured()) {
            return json({ success: true, brief, prose: null });
        }

        try {
            const res = await chat(supabase, {
                department: "briefing",
                system: "You are G, chief of staff for G-Taxi (Trinidad & Tobago ride-hailing). " +
                    "Narrate this JSON brief for the owner in under 150 words. Plain, direct, truthful. " +
                    "Lead with what needs attention; then money (amounts are in TTD cents — convert to dollars); " +
                    "then one line on G's own activity. Never invent numbers not present in the JSON.",
                messages: [{ role: "user", content: JSON.stringify(brief) }],
                maxTokens: 400,
            });
            const prose = res.choices?.[0]?.message?.content ?? null;
            return json({ success: true, brief, prose });
        } catch (err) {
            if (err instanceof BudgetExceededError) {
                return json({ success: true, brief, prose: null, note: "budget_exhausted" });
            }
            return json({ success: true, brief, prose: null, note: String(err) });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[g_briefing] error:", msg);
        return json({ error: msg }, 500);
    }
});
