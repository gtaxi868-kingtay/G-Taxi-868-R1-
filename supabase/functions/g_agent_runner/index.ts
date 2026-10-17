// supabase/functions/g_agent_runner/index.ts
// G's staff: ONE shared tool-loop agent that runs a named "department"
// (ops / finance / support / content_creator / reserved) on a schedule or on
// demand. Generalizes the proven loop from platform_intelligence.
//
// Safety model:
//  - Departments and their toolsets live IN CODE (except the reserved seat,
//    whose prompt + tool whitelist load from g_config — the configurable seat).
//  - The LLM can only read named views of the data and file PROPOSALS; the write
//    tools are propose_action (into the approval queue, pushes the owner),
//    log_decision (audit trail), and remember (persistent memory — g_memory,
//    capped at 3 writes/run, cannot create 'directive' rows). Execution of
//    approved proposals happens in g_execute_action — reviewed code, not the
//    model.
//  - Kill checks: g_config.g_enabled, system_config.maintenance_mode, per-
//    department daily proposal cap, MAX_ITERATIONS, >5-tool-calls trip,
//    daily LLM budget (enforced inside _shared/llm.ts).
//
// Auth: x-cron-secret (PLATFORM_CRON_SECRET) or admin JWT. verify_jwt=false.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, RateLimitedError, LlmMessage, LlmTool } from "../_shared/llm.ts";
import { getPlatformIdentity } from "../_shared/identity.ts";
import { embedText } from "../_shared/embeddings.ts";
import { proposeActionInputSchema, validateActionPayloadShape } from "../_shared/actionPayloadSchema.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const MAX_ITERATIONS = 8;
const DEFAULT_PROPOSAL_CAP = 10;



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
8. MEMORY RULE: use remember only for something that will still matter in a week — a
   decision and its reason, an outcome, or a thing you are actively chasing. Never memorize
   a number you can just re-query next run; that is exactly how memory rots into noise.
   If a memory shown to you under "WHAT YOU ALREADY KNOW" is now wrong, pass its id as
   supersedes_memory_id on the corrected remember call instead of leaving both to coexist.
Currency is TTD; amounts in the data are in cents.`;

const DEPARTMENTS: Record<string, Department> = {
    ops: {
        prompt: `You are G's Ops Manager for __PLATFORM__.
Daily duty: check background job health, open system alerts, and the order dispatch queue.
Flag failing cron jobs and stuck dispatches. Propose fixes (category "config") when something
needs a human — e.g. a job failing repeatedly, a queue backing up.${SHARED_RULES}`,
        tools: ["get_cron_health", "get_open_alerts", "get_dispatch_queue", "propose_action", "log_decision"],
    },
    finance: {
        prompt: `You are G's Finance Controller for __PLATFORM__.
Daily duty: review yesterday/this-week earnings, platform take, order volume, and outstanding
driver commission debt. Flag anomalies (sudden drops, debt approaching the $300 TTD limit,
days with rides but zero settlements). Money-moving suggestions are proposals (category "money").${SHARED_RULES}`,
        tools: ["get_finance_snapshot", "get_recent_transactions", "propose_action", "log_decision"],
    },
    support: {
        prompt: `You are G's Support & Disputes officer for __PLATFORM__.
Daily duty: triage open support tickets by severity (refund requests and safety issues first).
For tickets needing a reply, DRAFT the response inside a proposal (category "public",
action_type "support_reply_draft", payload {ticket_id, draft}). Refunds are proposals
(category "money", action_type "refund", amount_cents set).${SHARED_RULES}`,
        tools: ["get_open_tickets", "get_ticket_detail", "propose_action", "log_decision"],
    },
    content_creator: {
        prompt: `You are G's Content Creator for __PLATFORM__. Brand voice: "Luxe Cool" — sleek,
confident, Trinidad & Tobago flavour, violet-to-cyan glass aesthetic; never corporate-stiff,
never clownish. Duty (runs Mon & Thu): from real platform highlights and recent post
performance, draft 2-3 social posts (caption + suggested visual description + platform) as
proposals (category "public", action_type "draft_post", payload {platform, caption, visual,
best_time}). Learn from the top/bottom performers in get_social_performance — say what you
changed and why in your reasoning. Never invent statistics about the platform.${SHARED_RULES}`,
        tools: ["get_platform_highlights", "get_social_performance", "propose_action", "log_decision"],
    },
    fleet: {
        prompt: `You are G's Fleet & Compliance officer for __PLATFORM__.
Daily duty: (1) driver registration compliance — every driver's vehicle must carry a legal
'H' (for-hire) plate to legally carry paying passengers in Trinidad & Tobago; a private plate
voids insurance on any accident. Flag drivers still "unverified" after a reasonable window,
and any driver marked "private" (non-compliant) — these are people-category proposals asking
the owner to follow up, never an auto-suspend. (2) G Garage — review pending driver vehicle-
sourcing requests (g_garage_requests). Use get_knowledge_documents for any admin-uploaded
context (ATL dealer terms, legal opinions on import, customs guidance) before reasoning about
a request. Only propose action_type "approve_garage_request" (payload {request_id}) when the
request's requested_daily_contribution_cents already falls inside its own computed min/max
range (it always will — that's enforced server-side) AND the driver's registration_class is
not "private". If registration_class is "unverified", propose flagging it for follow-up
instead of approving the vehicle request — don't hand a car to a driver whose plate status is
unknown. Never invent a legal or financial conclusion that isn't backed by an uploaded document
or the real request data.${SHARED_RULES}`,
        tools: ["get_registration_compliance", "get_garage_requests", "get_knowledge_documents", "propose_action", "log_decision"],
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
    get_registration_compliance: {
        type: "function",
        function: {
            name: "get_registration_compliance",
            description: "Counts of drivers by registration_class (unverified/H/R/private), plus the list of drivers still unverified or marked private.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_garage_requests: {
        type: "function",
        function: {
            name: "get_garage_requests",
            description: "Pending G Garage vehicle-sourcing requests, joined with the requesting driver's registration_class and rank.",
            parameters: { type: "object", properties: {} },
        },
    },
    get_knowledge_documents: {
        type: "function",
        function: {
            name: "get_knowledge_documents",
            description: "Admin-uploaded reference documents (title, category, notes) — legal opinions, vendor quotes, research — relevant to fleet/compliance decisions. Read the notes field; it is the actual content a human summarized, not OCR of the file.",
            parameters: { type: "object", properties: {} },
        },
    },
    // NOTE: this static definition is the FALLBACK only (used if the
    // g_action_types fetch in serve() fails for some reason). The real,
    // per-run tool sent to the model is built by buildProposeActionTool()
    // below, with `enum` populated from the live registry so G can never
    // again invent an action_type with no handler — the exact bug that
    // produced a 0-for-31 execution record before this phase (see
    // 20260908000000_g_action_type_registry.sql for the full incident).
    propose_action: {
        type: "function",
        function: {
            name: "propose_action",
            description: "File a proposal into the owner's approval inbox. Required for anything involving money, people, public output, or config changes.",
            parameters: {
                type: "object",
                properties: {
                    action_type: { type: "string", description: "Use 'recommendation' if nothing more specific applies." },
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
    remember: {
        type: "function",
        function: {
            name: "remember",
            description: "Save something to your persistent memory so a FUTURE run of this department can recall it — you have zero memory of past runs otherwise. Only for things that will still matter in a week: a decision and its reason, an outcome, or something you are actively chasing. Never memorize a number you can just re-query. Max 3 calls per run. Cannot create 'directive' memories — those are standing owner instructions and can only be set via Talk to G.",
            parameters: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: ["observation", "decision", "outcome", "entity_fact", "open_thread"] },
                    title: { type: "string", description: "One line — this is what gets shown to your future self." },
                    body: { type: "string", description: "Up to ~1500 chars. The actual content." },
                    confidence: { type: "number", description: "0-1, default 0.7." },
                    entity_type: { type: "string", description: "Optional — e.g. 'driver', 'cron_job', 'proposal'." },
                    entity_key: { type: "string", description: "Optional — a human-readable identifier for the entity." },
                    supersedes_memory_id: { type: "string", description: "If this replaces an earlier memory shown to you, its id — marks the old one superseded instead of leaving a contradiction." },
                },
                required: ["kind", "title", "body"],
            },
        },
    },
};

interface ActionTypeRow {
    action_type: string;
    category_default: string;
    description: string;
    payload_schema: { required?: string[] };
}

// Builds propose_action fresh, per run, with `enum` populated from the live
// g_action_types registry — the actual fix for the 0-for-31 execution
// record. Falls back to the static TOOL_DEFS.propose_action (unconstrained
// action_type) only if this fetch itself fails, so a registry outage can't
// take down every department run — it just means less protection that run.
async function buildProposeActionTool(supabase: Svc): Promise<{ tool: LlmTool; schemas: Map<string, string[]> }> {
    const schemas = new Map<string, string[]>();
    try {
        const { data, error } = await supabase.from("g_action_types")
            .select("action_type, category_default, description, payload_schema")
            .eq("is_enabled", true);
        if (error || !data?.length) throw new Error(error?.message ?? "empty registry");

        const rows = data as ActionTypeRow[];
        for (const r of rows) schemas.set(r.action_type, r.payload_schema?.required ?? []);

        const catalogText = rows.map((r) => `- ${r.action_type} (${r.category_default}): ${r.description}`).join("\n");

        return {
            tool: {
                type: "function",
                function: {
                    name: "propose_action",
                    description: `File a proposal into the owner's approval inbox. action_type MUST be one of the types below — this is a closed list because every type here either has a real handler or is a known manual-review type; a type not on this list has no way to ever be carried out.\n\n${catalogText}`,
                    parameters: {
                        type: "object",
                        properties: {
                            action_type: { type: "string", enum: rows.map((r) => r.action_type) },
                            title: { type: "string", description: "one line the owner reads on their phone" },
                            reasoning: { type: "string" },
                            category: { type: "string", enum: ["money", "people", "public", "config", "other"] },
                            amount_cents: { type: "number", description: "set when category is money" },
                            payload: { type: "object", description: "everything needed to execute later — see the required keys listed per type above" },
                        },
                        required: ["action_type", "title", "reasoning", "category"],
                    },
                },
            },
            schemas,
        };
    } catch (err) {
        console.error("[g_agent_runner:buildProposeActionTool]", err instanceof Error ? err.message : String(err));
        return { tool: TOOL_DEFS.propose_action, schemas };
    }
}

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
    async get_registration_compliance(supabase) {
        const { data, error } = await supabase.from("drivers")
            .select("id, name, plate_number, registration_class, registration_verified_at, status")
            .order("registration_class", { ascending: true });
        if (error) return { error: error.message };
        const rows = data ?? [];
        const counts: Record<string, number> = { unverified: 0, H: 0, R: 0, private: 0 };
        for (const r of rows) counts[r.registration_class] = (counts[r.registration_class] ?? 0) + 1;
        return {
            counts,
            unverified_drivers: rows.filter((r: { registration_class: string }) => r.registration_class === "unverified").slice(0, 25),
            non_compliant_private_drivers: rows.filter((r: { registration_class: string }) => r.registration_class === "private"),
        };
    },
    async get_garage_requests(supabase) {
        const { data, error } = await supabase.from("g_garage_requests")
            .select("id, source, min_daily_contribution_cents, max_daily_contribution_cents, requested_daily_contribution_cents, status, created_at, driver:driver_id(id, name, registration_class, rank), vehicle_class:vehicle_class_key(key, label)")
            .eq("status", "pending")
            .order("created_at", { ascending: true }).limit(25);
        return error ? { error: error.message } : data ?? [];
    },
    async get_knowledge_documents(supabase) {
        const { data, error } = await supabase.from("g_knowledge_documents")
            .select("title, category, notes, created_at")
            .eq("is_active", true)
            .order("created_at", { ascending: false }).limit(25);
        return error ? { error: error.message } : data ?? [];
    },
};

// ── Run context + universal write tools ───────────────────────────────────────

interface RunCtx {
    runId: string;
    department: string;
    proposalCap: number;
    proposalsFiled: number;
    memoriesWritten: number;
    /** action_type -> required payload keys, from g_action_types, for pre-flight validation. */
    actionTypeSchemas: Map<string, string[]>;
}

// ── Memory injection ─────────────────────────────────────────────────────────
// Before this, every department run started from zero — no recall of what it
// noticed or decided last time. This assembles a "what you already know"
// block: similarity-ranked recent memories PLUS, deterministically, every
// live directive and open_thread for this department, since those must never
// be lost to a similarity miss (a standing owner instruction shouldn't
// silently drop out just because this run's topic ranked it low).
//
// Hard-capped by g_config.memory_inject_max_chars — Groq's free tier shares
// ~12k tokens/min org-wide, and the department prompt + tool defs + tool
// results already use a meaningful slice of that budget per run.
async function buildMemoryBlock(supabase: Svc, deptName: string, runId: string): Promise<string> {
    try {
        const { data: enabledRow } = await supabase.from("g_config")
            .select("value").eq("key", "memory_enabled").maybeSingle();
        if (enabledRow?.value === false) return "";

        const [{ data: maxItemsRow }, { data: maxCharsRow }] = await Promise.all([
            supabase.from("g_config").select("value").eq("key", "memory_inject_max_items").maybeSingle(),
            supabase.from("g_config").select("value").eq("key", "memory_inject_max_chars").maybeSingle(),
        ]);
        const maxItems = Number(maxItemsRow?.value) || 8;
        const maxChars = Number(maxCharsRow?.value) || 2400;

        const { vector } = await embedText(supabase, `${deptName} department daily check`, `inject:${deptName}`);
        const { data: ranked } = await supabase.rpc("g_memory_search", {
            p_query_text: `${deptName} department`,
            p_query_embedding: vector ? `[${vector.join(",")}]` : null,
            p_scope: "department",
            p_department: deptName,
            p_kinds: null,
            p_limit: maxItems,
        });

        // Deterministic pulls — never subject to similarity ranking.
        const { data: mustInclude } = await supabase
            .from("g_memory")
            .select("id, title, body, kind, department, confidence, created_at")
            .is("superseded_by_id", null)
            .in("kind", ["directive", "open_thread"])
            .or(`department.eq.${deptName},scope.eq.platform`)
            .order("created_at", { ascending: false })
            .limit(10);

        const byId = new Map<string, { title: string; body: string; kind: string }>();
        for (const row of mustInclude ?? []) byId.set(row.id, row);
        for (const row of ranked ?? []) if (!byId.has(row.id)) byId.set(row.id, row);

        if (byId.size === 0) return "";

        let chars = 0;
        const lines: string[] = [];
        const usedIds: string[] = [];
        for (const [id, m] of byId) {
            const line = `- [${m.kind}] ${m.title} — ${m.body}`;
            if (chars + line.length > maxChars) break;
            lines.push(line);
            usedIds.push(id);
            chars += line.length;
        }

        await supabase.from("agent_decision_log").insert({
            run_id: runId,
            department: deptName,
            decision_type: "memory_injected",
            reasoning: `Injected ${lines.length} memor${lines.length === 1 ? "y" : "ies"} (${vector ? "hybrid" : "fts_only"} retrieval)`,
            tool_used: "buildMemoryBlock",
            payload: { memory_ids: usedIds, retrieval_mode: vector ? "hybrid" : "fts_only", chars },
            outcome: "logged",
        }).then(null, () => null);

        return `\n\nWHAT YOU ALREADY KNOW (your own memory — directives and open threads are always shown; the rest is ranked by relevance):\n${lines.join("\n")}`;
    } catch (err) {
        // Memory is an enhancement, not a hard dependency — a broken retrieval
        // must never take down a department run that would otherwise succeed.
        console.error("[g_agent_runner:buildMemoryBlock]", err instanceof Error ? err.message : String(err));
        return "";
    }
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
        // Bug fixed: setUTCHours(4,0,0,0) with no rollback guard is a FUTURE
        // timestamp between 00:00-04:00 UTC, so the cap query's `gte`
        // silently matched zero rows and the daily cap never applied in that
        // window. g_briefing already had the correct guard; ported here.
        const todayStart = new Date();
        todayStart.setUTCHours(4, 0, 0, 0);
        if (todayStart.getTime() > Date.now()) todayStart.setUTCDate(todayStart.getUTCDate() - 1);
        const todayIso = todayStart.toISOString();

        const { count } = await supabase.from("g_proposed_actions")
            .select("id", { count: "exact", head: true })
            .eq("department", ctx.department).gte("created_at", todayIso);
        if ((count ?? 0) >= ctx.proposalCap || ctx.proposalsFiled >= 3) {
            return { error: "proposal cap reached for this department today — do not file more" };
        }
        // Shape/type validation before any of the manual checks below — was
        // previously just presence checks with no type checking, so a
        // string where a dollar amount belongs, or a malformed id, sailed
        // through untouched until it reached a real RPC at execution time.
        const parsed = proposeActionInputSchema.safeParse(input);
        if (!parsed.success) {
            return { error: `invalid propose_action call: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
        }
        const category = parsed.data.category;
        const actionType = parsed.data.action_type;
        const payload = parsed.data.payload;
        const payloadViolations = validateActionPayloadShape(payload);
        if (payloadViolations.length > 0) {
            return { error: `payload has invalid field(s) for '${actionType}': ${payloadViolations.join("; ")}. Fill them in correctly and call propose_action again.` };
        }
        // Pre-flight payload validation against g_action_types.payload_schema
        // — the fix for e.g. escape_open_lane-class failures where the
        // payload was missing a field the handler needs, only discovered
        // after approval. Returns a retryable error so the model can fix it
        // in the same run instead of filing a proposal doomed to fail later.
        const required = ctx.actionTypeSchemas.get(actionType) ?? [];
        const missing = required.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === "");
        if (missing.length > 0) {
            return { error: `payload missing required field(s) for '${actionType}': ${missing.join(", ")}. Fill them in and call propose_action again.` };
        }
        const { data, error } = await supabase.from("g_proposed_actions").insert({
            department: ctx.department,
            action_type: actionType,
            title: parsed.data.title.slice(0, 200),
            reasoning: parsed.data.reasoning,
            category,
            amount_cents: parsed.data.amount_cents !== undefined ? Math.round(parsed.data.amount_cents) : null,
            payload,
        }).select("id").single();
        if (error) return { error: error.message };
        ctx.proposalsFiled++;
        await notifyAdmins(supabase, `G proposal · ${ctx.department}`, parsed.data.title);
        return { success: true, proposal_id: data.id, status: "pending_owner_approval" };
    }

    if (name === "remember") {
        if (ctx.memoriesWritten >= 3) {
            return { error: "memory cap reached for this run (3) — do not write more" };
        }
        const kind = String(input.kind ?? "");
        if (!["observation", "decision", "outcome", "entity_fact", "open_thread"].includes(kind)) {
            // 'directive' is deliberately not in this list — G cannot write its
            // own standing orders, only the owner can, via Talk to G.
            return { error: "invalid kind, or 'directive' is not writable from a department run" };
        }
        const title = String(input.title ?? "").slice(0, 200);
        const body = String(input.body ?? "").slice(0, 1500);
        if (!title || !body) return { error: "title and body required" };

        const { vector, model } = await embedText(supabase, `${title}\n${body}`, `remember:${ctx.department}`);

        const { data: newId, error } = await supabase.rpc("g_memory_write", {
            p_scope: "department",
            p_department: ctx.department,
            p_entity_type: input.entity_type ? String(input.entity_type) : null,
            p_entity_key: input.entity_key ? String(input.entity_key) : null,
            p_entity_id: null,
            p_kind: kind,
            p_title: title,
            p_body: body,
            p_confidence: typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : 0.7,
            p_source: "agent_run",
            p_source_ref: { run_id: ctx.runId },
            p_valid_until: null,
            p_supersedes_id: input.supersedes_memory_id ? String(input.supersedes_memory_id) : null,
            // g_memory_write takes the embedding as vector literal text
            // ("[0.1,0.2,...]") and casts internally — see
            // 20260907010000_g_memory_embedding_param_as_text.sql for why a
            // raw JSON array parameter was not used.
            p_embedding: vector ? `[${vector.join(",")}]` : null,
            p_embedding_model: model,
        });
        if (error) return { error: error.message };
        ctx.memoriesWritten++;
        return { success: true, memory_id: newId, embedded: vector !== null };
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
  const corsHeaders = getCorsHeaders(req);
  function json(payload: unknown, status = 200): Response {
      return new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  }

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
    // Built fresh per run from the live g_action_types registry — this is
    // the actual fix for propose_action ever inventing an unhandled type.
    const { tool: proposeActionTool, schemas: actionTypeSchemas } = await buildProposeActionTool(supabase);

    const ctx: RunCtx = {
        runId: crypto.randomUUID(),
        department: deptName,
        proposalCap: Number(capRow?.value) || DEFAULT_PROPOSAL_CAP,
        proposalsFiled: 0,
        memoriesWritten: 0,
        actionTypeSchemas,
    };

    // Universal write tools every department gets, alongside its own
    // read-only tool set from DEPARTMENTS/loadReservedDepartment. The
    // department's own tools list still names "propose_action" (so the
    // read-only vs. write-tool grouping stays visible in DEPARTMENTS), but
    // the actual definition sent to the model is the dynamic one built above,
    // not the static TOOL_DEFS.propose_action fallback.
    const tools: LlmTool[] = [
        ...dept.tools
            .map((t) => (t === "propose_action" ? proposeActionTool : TOOL_DEFS[t]))
            .filter(Boolean),
        TOOL_DEFS.remember,
    ];
    const messages: LlmMessage[] = [{
        role: "user",
        content: `Run your ${deptName} check now (${new Date().toISOString()}). Gather your data, act within your rules, then log_decision.`,
    }];

    // __PLATFORM__ replaces what used to be "G-Taxi" hardcoded into each
    // department's prompt string above — now sourced from g_config so the
    // platform description lives in exactly one place across all 5 G functions.
    const identity = await getPlatformIdentity(supabase);
    const memoryBlock = await buildMemoryBlock(supabase, deptName, ctx.runId);
    const systemPrompt = dept.prompt.replace(/__PLATFORM__/g, identity.description) + memoryBlock;

    try {
        let iterations = 0;
        let continueLoop = true;
        while (continueLoop && iterations < MAX_ITERATIONS) {
            iterations++;
            const res = await chat(supabase, {
                department: deptName,
                system: systemPrompt,
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

        // Deterministic proof-of-life. The failure path below ALWAYS logs
        // (run_error / rate_limited / budget_skip) but success previously logged
        // nothing unless the model happened to call log_decision itself — so
        // "did any department succeed recently?" was unanswerable, and a healthy
        // run that simply didn't call the tool was indistinguishable from a dead
        // brain. Confirmed live 2026-09-06: a successful ops run (6 iterations,
        // 1 proposal filed) wrote no department_run row at all. The
        // g_department_brain health check keys on this row, so it must be
        // written by the server, never left to the model's discretion.
        await supabase.from("agent_decision_log").insert({
            run_id: ctx.runId,
            department: deptName,
            decision_type: "run_completed",
            reasoning: `${deptName} run finished: ${iterations} iteration(s), ${ctx.proposalsFiled} proposal(s) filed`,
            tool_used: "serve",
            payload: { iterations, proposals_filed: ctx.proposalsFiled },
            outcome: "ok",
        }).then(null, () => null);

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
