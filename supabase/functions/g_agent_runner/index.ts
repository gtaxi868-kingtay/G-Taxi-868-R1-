// supabase/functions/g_agent_runner/index.ts
// G's staff: ONE shared tool-loop agent that runs a named "department"
// (ops / finance / support / content_creator / reserved) on a schedule or on
// demand. Generalizes the proven loop from platform_intelligence.
//
// Safety model:
//  - Departments and their toolsets live IN CODE (except the reserved seat,
//    whose prompt + tool whitelist load from g_config — the configurable seat).
//  - The LLM can only read named views of the data and file PROPOSALS; the only
//    write tools are propose_action (into the approval queue, pushes the owner)
//    and log_decision (audit trail). Execution of approved proposals happens in
//    g_execute_action — reviewed code, not the model.
//  - Kill checks: g_config.g_enabled, system_config.maintenance_mode, per-
//    department daily proposal cap, MAX_ITERATIONS, >5-tool-calls trip,
//    daily LLM budget (enforced inside _shared/llm.ts).
//
// Auth: x-cron-secret (PLATFORM_CRON_SECRET) or admin JWT. verify_jwt=false.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, RateLimitedError, LlmMessage, LlmTool } from "../_shared/llm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const MAX_ITERATIONS = 8;
const DEFAULT_PROPOSAL_CAP = 10;

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

// ── Expo push (self-contained, same pattern as platform_intelligence) ─────────
async function sendExpoPush(token: string | null, title: string, body: string) {
    if (!token || !token.startsWith("ExponentPushToken[")) return;
    try {
        await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: token, title, body, sound: "default" }),
        });
    } catch (_) { /* non-fatal */ }
}

// deno-lint-ignore no-explicit-any
type Svc = any;

// ── Department registry (in code, by design) ──────────────────────────────────

interface Department {
    prompt: string;
    tools: string[]; // names from TOOL_CATALOG + universal tools
}

const SHARED_RULES = `
Rules that apply to every department:
1. You NEVER execute anything — you file proposals via propose_action. A human approves; separate reviewed code executes.
2. Anything involving money, people (approvals/suspensions), or public-facing output MUST be a proposal — there is no other path.
3. Be truthful and conservative. If data is thin, say so in your reasoning instead of inventing conclusions.
4. Always finish by calling log_decision exactly once with a summary of what you saw and did (decision_type "department_run").
5. File at most 3 proposals per run; only when genuinely warranted.
6. Call tools ONE AT A TIME — never batch multiple tool calls in a single step.
7. EVIDENCE RULE: propose ONLY when the data you actually fetched shows a concrete
   problem. Quote the specific evidence in your reasoning (the exact job name, ticket id,
   amount, count). If a tool returns an empty list or all-healthy, that means NOTHING is
   wrong — do NOT invent a problem, do NOT propose, just log_decision "all clear". Never
   propose to "activate", "pause", or "fix" something you did not observe failing in the data.
Currency is TTD; amounts in the data are in cents.`;

const DEPARTMENTS: Record<string, Department> = {
    ops: {
        prompt: `You are G's Ops Manager for G-Taxi (Trinidad & Tobago ride-hailing platform).
Daily duty: check background job health, open system alerts, and the order dispatch queue.
Flag failing cron jobs and stuck dispatches. Propose fixes (category "config") when something
needs a human — e.g. a job failing repeatedly, a queue backing up.${SHARED_RULES}`,
        tools: ["get_cron_health", "get_open_alerts", "get_dispatch_queue", "propose_action", "log_decision"],
    },
    finance: {
        prompt: `You are G's Finance Controller for G-Taxi.
Daily duty: review yesterday/this-week earnings, platform take, order volume, and outstanding
driver commission debt. Flag anomalies (sudden drops, debt approaching the $300 TTD limit,
days with rides but zero settlements). Money-moving suggestions are proposals (category "money").${SHARED_RULES}`,
        tools: ["get_finance_snapshot", "get_recent_transactions", "propose_action", "log_decision"],
    },
    support: {
        prompt: `You are G's Support & Disputes officer for G-Taxi.
Daily duty: triage open support tickets by severity (refund requests and safety issues first).
For tickets needing a reply, DRAFT the response inside a proposal (category "public",
action_type "support_reply_draft", payload {ticket_id, draft}). Refunds are proposals
(category "money", action_type "refund", amount_cents set).${SHARED_RULES}`,
        tools: ["get_open_tickets", "get_ticket_detail", "propose_action", "log_decision"],
    },
    content_creator: {
        prompt: `You are G's Content Creator for G-Taxi. Brand voice: "Luxe Cool" — sleek,
confident, Trinidad & Tobago flavour, violet-to-cyan glass aesthetic; never corporate-stiff,
never clownish. Duty (runs Mon & Thu): from real platform highlights and recent post
performance, draft 2-3 social posts (caption + suggested visual description + platform) as
proposals (category "public", action_type "draft_post", payload {platform, caption, visual,
best_time}). Learn from the top/bottom performers in get_social_performance — say what you
changed and why in your reasoning. Never invent statistics about the platform.${SHARED_RULES}`,
        tools: ["get_platform_highlights", "get_social_performance", "propose_action", "log_decision"],
    },
};

async function loadReservedDepartment(supabase: Svc): Promise<Department | null> {
    const { data } = await supabase.from("g_config").select("value").eq("key", "department.reserved").maybeSingle();
    const cfg = data?.value;
    if (!cfg?.enabled || !cfg?.prompt) return null;
    const allowed = new Set([...(cfg.tools ?? []), "propose_action", "log_decision"]);
    return {
        prompt: `${cfg.prompt}${SHARED_RULES}`,
        tools: [...allowed].filter((t) => t in TOOL_CATALOG || t === "propose_action" || t === "log_decision"),
    };
}

// ── Tool catalog ───────────────────────────────────────────────────────────────

const TOOL_DEFS: Record<string, LlmTool> = {
    get_cron_health: {
        type: "function",
        function: {
            name: "get_cron_health",
            description: "List all scheduled background jobs with their last run status.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_open_alerts: {
        type: "function",
        function: {
            name: "get_open_alerts",
            description: "Unresolved system_alerts from the last 7 days.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_dispatch_queue: {
        type: "function",
        function: {
            name: "get_dispatch_queue",
            description: "Current order dispatch queue (pending order deliveries).",
            parameters: { type: "object", properties: {} },
        },
    },
    get_finance_snapshot: {
        type: "function",
        function: {
            name: "get_finance_snapshot",
            description: "Earnings today/7d, platform take, order volume, cancellations, and top outstanding driver debts.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_recent_transactions: {
        type: "function",
        function: {
            name: "get_recent_transactions",
            description: "Last 25 wallet transactions (type, amount, status).",
            parameters: { type: "object", properties: {} },
        },
    },
    get_open_tickets: {
        type: "function",
        function: {
            name: "get_open_tickets",
            description: "Open/pending support tickets with subject, category, priority, refund ask.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_ticket_detail: {
        type: "function",
        function: {
            name: "get_ticket_detail",
            description: "Full detail of one support ticket including the linked ride.",
            parameters: {
                type: "object",
                properties: { ticket_id: { type: "string" } },
                required: ["ticket_id"],
            },
        },
    },
    get_platform_highlights: {
        type: "function",
        function: {
            name: "get_platform_highlights",
            description: "Real marketing-worthy facts: weekly ride count, newly activated merchants, live escape/travel packages.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_social_performance: {
        type: "function",
        function: {
            name: "get_social_performance",
            description: "Recent social posts with metrics, plus top-3 and bottom-3 by engagement.",
            parameters: { type: "object", properties: {} },
        },
    },
    propose_action: {
        type: "function",
        function: {
            name: "propose_action",
            description: "File a proposal into the owner's approval inbox. Required for anything involving money, people, public output, or config changes.",
            parameters: {
                type: "object",
                properties: {
                    action_type: { type: "string", description: "machine-readable type, e.g. refund, draft_post, support_reply_draft, pause_cron_job" },
                    title: { type: "string", description: "one line the owner reads on their phone" },
                    reasoning: { type: "string" },
                    category: { type: "string", enum: ["money", "people", "public", "config", "other"] },
                    amount_cents: { type: "number", description: "set when category is money" },
                    payload: { type: "object", description: "everything needed to execute later" },
                },
                required: ["action_type", "title", "reasoning", "category"],
            },
        },
    },
    log_decision: {
        type: "function",
        function: {
            name: "log_decision",
            description: "Write to the audit log. Call exactly once at the end of the run with a summary.",
            parameters: {
                type: "object",
                properties: {
                    decision_type: { type: "string" },
                    reasoning: { type: "string" },
                    payload: { type: "object" },
                },
                required: ["decision_type", "reasoning"],
            },
        },
    },
};

const TOOL_CATALOG: Record<string, (supabase: Svc, input: Record<string, unknown>, ctx: RunCtx) => Promise<unknown>> = {
    async get_cron_health(supabase) {
        const { data, error } = await supabase.rpc("g_cron_health");
        return error ? { error: error.message } : data ?? [];
    },
    async get_open_alerts(supabase) {
        const { data, error } = await supabase.from("system_alerts")
            .select("type, severity, title, details, created_at")
            .is("resolved_at", null)
            .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
            .order("created_at", { ascending: false }).limit(25);
        return error ? { error: error.message } : data ?? [];
    },
    async get_dispatch_queue(supabase) {
        const { data, error } = await supabase.rpc("get_order_dispatch_queue");
        return error ? { error: error.message } : data ?? [];
    },
    async get_finance_snapshot(supabase) {
        const dayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const weekIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const [ridesDay, ridesWeek, ordersWeek, cancelledWeek, debt] = await Promise.all([
            supabase.from("rides").select("total_fare_cents, platform_fee_cents, driver_payout_cents")
                .in("status", ["completed", "payment_confirmed", "closed"]).gte("created_at", dayIso),
            supabase.from("rides").select("total_fare_cents, platform_fee_cents")
                .in("status", ["completed", "payment_confirmed", "closed"]).gte("created_at", weekIso),
            supabase.from("orders").select("total_cents, status").gte("created_at", weekIso),
            supabase.from("rides").select("id", { count: "exact", head: true })
                .eq("status", "cancelled").gte("created_at", weekIso),
            supabase.from("wallet_transactions").select("user_id, amount")
                .eq("transaction_type", "commission_debt"),
        ]);
        // deno-lint-ignore no-explicit-any
        const sum = (rows: any[] | null, key: string) => (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
        const debtByDriver: Record<string, number> = {};
        for (const r of debt.data ?? []) {
            debtByDriver[r.user_id] = (debtByDriver[r.user_id] ?? 0) + Math.abs(Number(r.amount ?? 0));
        }
        const topDebt = Object.entries(debtByDriver)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([user_id, cents]) => ({ user_id, debt_cents: cents }));
        return {
            currency: "TTD",
            rides_finished_24h: ridesDay.data?.length ?? 0,
            gross_fares_24h_cents: sum(ridesDay.data, "total_fare_cents"),
            platform_take_24h_cents: sum(ridesDay.data, "platform_fee_cents"),
            gross_fares_7d_cents: sum(ridesWeek.data, "total_fare_cents"),
            platform_take_7d_cents: sum(ridesWeek.data, "platform_fee_cents"),
            orders_7d: ordersWeek.data?.length ?? 0,
            order_volume_7d_cents: sum(ordersWeek.data, "total_cents"),
            rides_cancelled_7d: cancelledWeek.count ?? 0,
            top_driver_debt: topDebt,
            debt_limit_cents: 30000,
        };
    },
    async get_recent_transactions(supabase) {
        const { data, error } = await supabase.from("wallet_transactions")
            .select("transaction_type, amount, currency, status, description, created_at")
            .order("created_at", { ascending: false }).limit(25);
        return error ? { error: error.message } : data ?? [];
    },
    async get_open_tickets(supabase) {
        const { data, error } = await supabase.from("support_tickets")
            .select("id, subject, category, status, priority, refund_amount_cents, created_at")
            .in("status", ["open", "pending"])
            .order("created_at", { ascending: true }).limit(25);
        return error ? { error: error.message } : data ?? [];
    },
    async get_ticket_detail(supabase, input) {
        const id = String(input.ticket_id ?? "");
        const { data: ticket, error } = await supabase.from("support_tickets")
            .select("*").eq("id", id).maybeSingle();
        if (error || !ticket) return { error: error?.message ?? "ticket not found" };
        let ride = null;
        if (ticket.ride_id) {
            const { data } = await supabase.from("rides")
                .select("id, status, total_fare_cents, created_at, cancelled_reason")
                .eq("id", ticket.ride_id).maybeSingle();
            ride = data;
        }
        return { ticket, ride };
    },
    async get_platform_highlights(supabase) {
        const weekIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const [rides, newMerchants, packages] = await Promise.all([
            supabase.from("rides").select("id", { count: "exact", head: true })
                .in("status", ["completed", "payment_confirmed", "closed"]).gte("created_at", weekIso),
            supabase.from("merchants").select("name, category, store_type, activated_at")
                .eq("activation_status", "active").gte("activated_at", weekIso),
            supabase.from("escape_packages").select("id, status").limit(10),
        ]);
        return {
            rides_completed_this_week: rides.count ?? 0,
            merchants_activated_this_week: newMerchants.data ?? [],
            escape_packages: packages.data ?? [],
        };
    },
    async get_social_performance(supabase) {
        const { data, error } = await supabase.from("g_social_metrics")
            .select("platform, post_ref, caption, metrics, posted_at")
            .order("posted_at", { ascending: false }).limit(20);
        if (error) return { error: error.message };
        // deno-lint-ignore no-explicit-any
        const engagement = (m: any) => {
            const x = m?.metrics ?? {};
            return Number(x.engagement ?? 0) ||
                Number(x.likes ?? 0) + Number(x.comments ?? 0) + Number(x.shares ?? 0) + Number(x.saves ?? 0);
        };
        const sorted = [...(data ?? [])].sort((a, b) => engagement(b) - engagement(a));
        return {
            recent: data ?? [],
            top_3: sorted.slice(0, 3),
            bottom_3: sorted.slice(-3).reverse(),
        };
    },
};

// ── Run context + universal write tools ───────────────────────────────────────

interface RunCtx {
    runId: string;
    department: string;
    proposalCap: number;
    proposalsFiled: number;
}

async function notifyAdmins(supabase: Svc, title: string, body: string) {
    const { data: admins } = await supabase.from("profiles")
        .select("push_token").eq("role", "admin").not("push_token", "is", null).limit(5);
    await Promise.allSettled(
        (admins ?? []).map((a: { push_token: string }) => sendExpoPush(a.push_token, title, body)),
    );
}

async function executeTool(
    name: string, input: Record<string, unknown>, supabase: Svc, ctx: RunCtx,
): Promise<unknown> {
    if (name === "propose_action") {
        const todayIso = new Date(new Date().setUTCHours(4, 0, 0, 0)).toISOString();
        const { count } = await supabase.from("g_proposed_actions")
            .select("id", { count: "exact", head: true })
            .eq("department", ctx.department).gte("created_at", todayIso);
        if ((count ?? 0) >= ctx.proposalCap || ctx.proposalsFiled >= 3) {
            return { error: "proposal cap reached for this department today — do not file more" };
        }
        const category = String(input.category ?? "other");
        if (!["money", "people", "public", "config", "other"].includes(category)) {
            return { error: "invalid category" };
        }
        const { data, error } = await supabase.from("g_proposed_actions").insert({
            department: ctx.department,
            action_type: String(input.action_type ?? "unspecified"),
            title: String(input.title ?? "").slice(0, 200),
            reasoning: String(input.reasoning ?? ""),
            category,
            amount_cents: typeof input.amount_cents === "number" ? Math.round(input.amount_cents) : null,
            payload: input.payload ?? {},
        }).select("id").single();
        if (error) return { error: error.message };
        ctx.proposalsFiled++;
        await notifyAdmins(supabase, `G proposal · ${ctx.department}`, String(input.title ?? ""));
        return { success: true, proposal_id: data.id, status: "pending_owner_approval" };
    }

    if (name === "log_decision") {
        const { error } = await supabase.from("agent_decision_log").insert({
            run_id: ctx.runId,
            department: ctx.department,
            decision_type: String(input.decision_type ?? "department_run"),
            reasoning: String(input.reasoning ?? ""),
            tool_used: null,
            payload: input.payload ?? {},
            outcome: "logged",
        });
        return error ? { error: error.message } : { success: true };
    }

    const fn = TOOL_CATALOG[name];
    if (!fn) return { error: `unknown tool ${name}` };
    return await fn(supabase, input, ctx);
}

// ── Auth guard (same as platform_intelligence) ─────────────────────────────────

async function isAuthorized(req: Request, supabase: Svc): Promise<boolean> {
    const cronHeader = req.headers.get("x-cron-secret");
    if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) return true;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return false;
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return false;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

// ── Main ───────────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAuthorized(req, supabase))) return json({ error: "Unauthorized" }, 401);

    let body: { department?: string } = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const deptName = String(body.department ?? "");

    // Kill checks — before anything else.
    const [{ data: enabledRow }, { data: maint }] = await Promise.all([
        supabase.from("g_config").select("value").eq("key", "g_enabled").maybeSingle(),
        supabase.from("system_config").select("value").eq("key", "maintenance_mode").maybeSingle(),
    ]);
    if (enabledRow && enabledRow.value === false) {
        return json({ success: false, killed: "g_enabled=false" });
    }
    if (maint?.value === "true") {
        return json({ success: false, killed: "maintenance_mode" });
    }

    let dept: Department | undefined = DEPARTMENTS[deptName];
    if (!dept && deptName === "reserved") {
        dept = (await loadReservedDepartment(supabase)) ?? undefined;
        if (!dept) return json({ success: false, skipped: "reserved seat not configured" });
    }
    if (!dept) {
        return json({ error: `unknown department '${deptName}'`, available: [...Object.keys(DEPARTMENTS), "reserved"] }, 400);
    }
    if (!llmConfigured()) return json({ success: false, skipped: "no LLM key configured" });

    const { data: capRow } = await supabase.from("g_config")
        .select("value").eq("key", "max_proposals_per_department_per_day").maybeSingle();
    const ctx: RunCtx = {
        runId: crypto.randomUUID(),
        department: deptName,
        proposalCap: Number(capRow?.value) || DEFAULT_PROPOSAL_CAP,
        proposalsFiled: 0,
    };

    const tools: LlmTool[] = dept.tools.map((t) => TOOL_DEFS[t]).filter(Boolean);
    const messages: LlmMessage[] = [{
        role: "user",
        content: `Run your ${deptName} check now (${new Date().toISOString()}). Gather your data, act within your rules, then log_decision.`,
    }];

    try {
        let iterations = 0;
        let continueLoop = true;
        while (continueLoop && iterations < MAX_ITERATIONS) {
            iterations++;
            const res = await chat(supabase, {
                department: deptName,
                system: dept.prompt,
                messages,
                tools,
                maxTokens: 2048,
            });
            const choice = res.choices?.[0];
            if (!choice) throw new Error("LLM returned no choices");
            const msg = choice.message;
            messages.push(msg);

            if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
                continueLoop = false;
            } else {
                if (msg.tool_calls.length > 8) {
                    await supabase.from("system_alerts").insert({
                        type: "RATE_LIMIT_BURST",
                        severity: "CRITICAL",
                        title: `Circuit breaker: G ${deptName} tool spam`,
                        details: { count: msg.tool_calls.length, run_id: ctx.runId },
                    }).then(null, () => null);
                    throw new Error("Circuit breaker: >5 tool calls in one step");
                }
                for (const toolCall of msg.tool_calls) {
                    let parsed: Record<string, unknown> = {};
                    try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* empty */ }
                    const result = await executeTool(toolCall.function.name, parsed, supabase, ctx);
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result),
                    });
                }
            }
        }

        return json({ success: true, run_id: ctx.runId, department: deptName, iterations, proposals_filed: ctx.proposalsFiled });
    } catch (err) {
        // Budget exhaustion and per-minute rate limits are expected soft states
        // (Groq free tier shares 12k tokens/min) — degrade gracefully, don't 500.
        const budget = err instanceof BudgetExceededError;
        const rateLimited = err instanceof RateLimitedError;
        const soft = budget || rateLimited;
        const rawMsg = err instanceof Error ? err.message : String(err);
        const note = rateLimited
            ? "G is busy — the free AI tier hit its per-minute limit. Give it about a minute and try again (or add the Grok key to remove the limit)."
            : budget
            ? "G has spent today's AI budget and is resting until tomorrow. Live numbers are still accurate."
            : rawMsg;
        if (!soft) console.error(`[g_agent_runner:${deptName}]`, rawMsg);
        await supabase.from("agent_decision_log").insert({
            run_id: ctx.runId,
            department: deptName,
            decision_type: budget ? "budget_skip" : rateLimited ? "rate_limited" : "run_error",
            reasoning: rawMsg,
            payload: {},
            outcome: soft ? "skipped" : "error",
        }).then(null, () => null);
        return json({ success: soft, run_id: ctx.runId, department: deptName, note }, soft ? 200 : 500);
    }
});
