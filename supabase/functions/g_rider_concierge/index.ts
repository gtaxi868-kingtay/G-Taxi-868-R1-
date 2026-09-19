// supabase/functions/g_rider_concierge/index.ts
// "G" — the one AI voice every app shares, riders and drivers alike. Despite
// the legacy filename (this was rider-only until now, and renaming the slug
// would mean cutting every caller over at once while this project sits at
// its 100-function plan cap -- not worth the churn for a name), this now
// serves both roles from one endpoint: identity resolves from the JWT, and
// the caller's REAL role is looked up server-side (a `drivers` row means
// driver, otherwise rider) -- never trusted from the request body. Same
// budget-capped gateway, same per-caller rate limit, same consent model,
// same "no LLM in the execution path for anything consequential" discipline
// for both roles; only the tool set, memory table, and system prompt differ.
//
// Consent model (identical shape for both roles, different tables):
//  - {rider,driver}_ai_preferences.ai_suggestions_enabled = master switch.
//    Off → G still answers, but stateless: no memory reads, no memory
//    writes, no history use.
//  - .memory_enabled = memory switch. Both on → G recalls and records
//    structured facts in g_{rider,driver}_memory (RLS: own rows only).
//  - action:"forget" deletes every memory row (+ reminders, riders only) —
//    the "forget me" button.
//
// Money guard, riders: G has NO payment tools. create_order_list /
// reorder_usual return DRAFTS the app renders into a cart; the rider always
// taps to confirm. initiate_lime_fleet only files a g_proposed_actions row
// for admin approval, same as every other consequential G action.
//
// Money/safety guard, drivers (stricter, on purpose -- a driver AI with
// write access to pay-adjacent columns risks real income, not just an
// unwanted cart): explain_last_payout is READ-ONLY against
// wallet_transactions (SUM(amount), this codebase's own source of truth for
// money -- never a cached balance column) and never invents a number. No
// tool can write to wallet_transactions, drivers.bank_details,
// drivers.commission_tier, or drivers.custom_commission_rate. flag_concern
// files a manual_ack g_proposed_actions row. emergency_checkin is NOT
// draft-gated -- it reaches admin immediately via raise_admin_alert() at
// CRITICAL, the same path other urgent alerts in this codebase use.
//
// Cost guard: 5 LLM calls/day per caller (g_llm_usage, department key
// `rider:<id>` / `driver:<id>`) on top of the global daily budget in
// _shared/llm.ts. Riders' proactive (unsolicited) calls use a SEPARATE
// counter (`rider_proactive:<id>`, cap 2/day) from conversational ones, so
// a chatty rider doesn't burn their one daily nudge and vice versa.
// Proactive mode is rider-only -- nothing in the driver app calls it.
//
// Auth: caller JWT (verify_jwt true). Identity resolved from auth.uid()
// only -- never a client-supplied id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, LlmMessage, LlmTool } from "../_shared/llm.ts";
import { getPlatformIdentity } from "../_shared/identity.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_ITERATIONS = 4;
const PER_CALLER_DAILY_CALLS = 5;
const PER_RIDER_DAILY_PROACTIVE_CALLS = 2;

type Role = "rider" | "driver";

// deno-lint-ignore no-explicit-any
type Svc = any;

interface Ctx {
    role: Role;
    userId: string;
    memoryOn: boolean;
    lat: number | null;
    lng: number | null;
}

// ── Tools ──────────────────────────────────────────────────────────────────────

const RIDER_TOOLS: LlmTool[] = [
    {
        type: "function",
        function: {
            name: "remember_fact",
            description: "Save something the rider told you or a clear preference you observed. Only available when the rider enabled memory.",
            parameters: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: ["preference", "frequent_order", "place", "fact"] },
                    content: { type: "object", description: "e.g. {summary: 'always orders Blue Waters from Massy', items: [...]}" },
                },
                required: ["kind", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "reorder_usual",
            description: "Build a DRAFT cart from the rider's most-ordered merchant and their last order there. The rider confirms in the app — this buys nothing.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "create_order_list",
            description: "Draft a shopping list / cart from what the rider asked for plus remembered frequent orders. Returns a draft — the rider confirms in the app.",
            parameters: {
                type: "object",
                properties: {
                    items: { type: "array", items: { type: "string" }, description: "item names the rider wants" },
                    merchant_hint: { type: "string", description: "merchant name if the rider named one" },
                },
                required: ["items"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "set_reminder",
            description: "Schedule a push reminder for the rider (e.g. 'Saturday market run 8am').",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string" },
                    due_at_iso: { type: "string", description: "ISO 8601 datetime, future" },
                    recurrence: { type: "string", enum: ["none", "daily", "weekly"] },
                },
                required: ["message", "due_at_iso"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "suggest_places",
            description: "Ranked nearby merchants for this rider (personalized when they consented; distance otherwise).",
            parameters: {
                type: "object",
                properties: {
                    store_type: { type: "string", description: "e.g. grocery, restaurant, pharmacy; omit for all" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "initiate_lime_fleet",
            description: "Propose a split-fare 'Lime Fleet' for a group outing (individual cars for everyone, no designated driver needed). Use IMMEDIATELY when the rider mentions meeting friends, going out, or 'liming'. Files a request for a quick admin check -- never creates the session directly.",
            parameters: {
                type: "object",
                properties: {
                    friend_count: { type: "number", description: "how many friends besides the rider, e.g. 3" },
                },
            },
        },
    },
];

const DRIVER_TOOLS: LlmTool[] = [
    {
        type: "function",
        function: {
            name: "remember_fact",
            description: "Save something the driver told you (a route preference, a recurring note). Only available when the driver enabled memory.",
            parameters: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: ["preference", "route_note"] },
                    content: { type: "object", description: "e.g. {summary: 'avoids the Beetham after dark'}" },
                },
                required: ["kind", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "explain_last_payout",
            description: "Explain the driver's most recent ride earnings using real transaction records. Read-only -- never invents a number.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "flag_concern",
            description: "File a concern for admin to review (safety issue, pay question, general feedback). Does not resolve anything itself -- an admin sees and acts on it manually.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "one-line summary of the concern" },
                    category: { type: "string", enum: ["safety", "pay", "other"] },
                },
                required: ["summary", "category"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "emergency_checkin",
            description: "Use IMMEDIATELY if the driver indicates they feel unsafe, are in danger, or need urgent help right now. Reaches admin instantly, not a queued request.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "what the driver said, briefly" },
                },
                required: ["summary"],
            },
        },
    },
];

async function executeTool(
    name: string, input: Record<string, unknown>, supabase: Svc, ctx: Ctx,
): Promise<unknown> {
    switch (name) {
        case "remember_fact": {
            if (!ctx.memoryOn) return { error: `memory is off — the ${ctx.role} has not enabled it` };
            const kind = String(input.kind ?? (ctx.role === "driver" ? "route_note" : "fact"));
            const validKinds = ctx.role === "driver"
                ? ["preference", "route_note"]
                : ["preference", "frequent_order", "place", "fact"];
            if (!validKinds.includes(kind)) return { error: "invalid kind" };
            const table = ctx.role === "driver" ? "g_driver_memory" : "g_rider_memory";
            const idColumn = ctx.role === "driver" ? "driver_user_id" : "rider_id";
            const { error } = await supabase.from(table).insert({
                [idColumn]: ctx.userId,
                kind,
                content: input.content ?? {},
            });
            return error ? { error: error.message } : { success: true, remembered: true };
        }

        // ── Rider-only tools ────────────────────────────────────────────────
        case "reorder_usual": {
            const { data: usual } = await supabase.from("user_service_history")
                .select("merchant_id, visit_count, merchants(name)")
                .eq("user_id", ctx.userId)
                .order("visit_count", { ascending: false }).limit(1).maybeSingle();
            if (!usual) return { error: "no order history yet" };
            const { data: lastOrder } = await supabase.from("orders")
                .select("id, total_cents, order_items(name, quantity, price_cents)")
                .eq("user_id", ctx.userId).eq("merchant_id", usual.merchant_id)
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
            return {
                draft: true,
                note: "Draft only — rider confirms in the app before anything is ordered.",
                merchant_id: usual.merchant_id,
                merchant_name: usual.merchants?.name ?? null,
                items: lastOrder?.order_items ?? [],
                last_total_cents: lastOrder?.total_cents ?? null,
            };
        }

        case "create_order_list": {
            const items = Array.isArray(input.items) ? input.items.map(String).slice(0, 30) : [];
            let merchant = null;
            if (input.merchant_hint) {
                const { data } = await supabase.from("merchants")
                    .select("id, name, store_type, is_open")
                    .ilike("name", `%${String(input.merchant_hint)}%`)
                    .eq("activation_status", "active").limit(1).maybeSingle();
                merchant = data;
            }
            return {
                draft: true,
                note: "Draft list — rider reviews and confirms in the cart.",
                items,
                merchant,
            };
        }

        case "set_reminder": {
            const dueAt = new Date(String(input.due_at_iso ?? ""));
            if (isNaN(dueAt.getTime()) || dueAt.getTime() < Date.now()) {
                return { error: "due_at_iso must be a valid future datetime" };
            }
            const recurrence = ["none", "daily", "weekly"].includes(String(input.recurrence))
                ? String(input.recurrence) : "none";
            const { error } = await supabase.from("g_rider_reminders").insert({
                rider_id: ctx.userId,
                message: String(input.message ?? "").slice(0, 200),
                due_at: dueAt.toISOString(),
                recurrence,
            });
            return error ? { error: error.message } : { success: true, due_at: dueAt.toISOString() };
        }

        case "suggest_places": {
            if (ctx.lat == null || ctx.lng == null) return { error: "no location provided" };
            const { data, error } = await supabase.rpc("g_rank_merchants", {
                p_rider_id: ctx.userId,
                p_lat: ctx.lat,
                p_lng: ctx.lng,
                p_store_type: input.store_type ? String(input.store_type) : null,
                p_limit: 5,
            });
            return error ? { error: error.message } : data ?? [];
        }

        // Previously (as Jarvis's initiate_lime_fleet) called create_split_session
        // directly with the rider's own access token -- a wrong AI guess about
        // friend count/fare created a real, other-people-visible split session
        // with zero admin oversight. Files a g_proposed_actions row instead, same
        // table/inbox/execution pattern every other consequential G action uses.
        // g_execute_action's initiate_lime_fleet handler creates the real
        // split_sessions row only after an admin approves, reading rider_id from
        // the row itself rather than a token that may have expired by then.
        case "initiate_lime_fleet": {
            const count = typeof input.friend_count === "number" && input.friend_count > 0
                ? Math.min(Math.floor(input.friend_count), 19) : 3;
            const total = 40000; // $400 TTD placeholder
            const participantCount = count + 1;
            const share = Math.floor(total / participantCount);

            const { error } = await supabase.from("g_proposed_actions").insert({
                department: "rider_concierge",
                action_type: "initiate_lime_fleet",
                title: `Lime Fleet for ${participantCount} people`,
                reasoning: "Rider asked G to start a group split-fare via chat.",
                category: "money",
                amount_cents: total,
                payload: {
                    rider_id: ctx.userId,
                    friend_count: count,
                    participant_count: participantCount,
                    share_cents: share,
                },
                status: "pending",
            });
            if (error) return { error: error.message };
            return {
                success: true,
                pending_admin_review: true,
                note: "Sent to the team for a quick check -- the rider will hear back shortly.",
                participant_count: participantCount,
            };
        }

        // ── Driver-only tools ───────────────────────────────────────────────
        case "explain_last_payout": {
            // wallet_transactions is this codebase's own source of truth for
            // money (SUM(amount)), never a cached balance column. Reads the
            // driver's last completed ride's earnings and whatever else
            // posted around it -- never computes or guesses a number that
            // isn't a real row here.
            const { data: rows, error } = await supabase
                .from("wallet_transactions")
                .select("amount, transaction_type, description, ride_id, created_at")
                .eq("user_id", ctx.userId)
                .order("created_at", { ascending: false })
                .limit(10);
            if (error) return { error: error.message };
            if (!rows?.length) return { note: "No transactions on record yet for this account." };

            const lastRideId = rows.find((r: any) => r.ride_id)?.ride_id ?? null;
            const relevant = lastRideId ? rows.filter((r: any) => r.ride_id === lastRideId) : rows.slice(0, 3);
            const total = relevant.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
            return {
                ride_id: lastRideId,
                line_items: relevant.map((r: any) => ({
                    type: r.transaction_type, amount: r.amount, description: r.description, at: r.created_at,
                })),
                total_cents: total,
            };
        }

        case "flag_concern": {
            const summary = String(input.summary ?? "").slice(0, 500);
            const category = ["safety", "pay", "other"].includes(String(input.category))
                ? String(input.category) : "other";
            if (!summary) return { error: "summary required" };
            const { error } = await supabase.from("g_proposed_actions").insert({
                department: "driver_concierge",
                action_type: "driver_concern",
                title: `Driver concern (${category}): ${summary.slice(0, 80)}`,
                reasoning: "Driver raised this via the driver AI voice.",
                category: "people",
                payload: { driver_user_id: ctx.userId, concern: summary, concern_category: category },
                status: "pending",
            });
            if (ctx.memoryOn) {
                await supabase.from("g_driver_memory").insert({
                    driver_user_id: ctx.userId, kind: "concern",
                    content: { summary, category },
                }).then(null, () => null);
            }
            return error ? { error: error.message } : { success: true, filed: true };
        }

        case "emergency_checkin": {
            const summary = String(input.summary ?? "Driver requested an emergency check-in via G.").slice(0, 500);
            const { error } = await supabase.rpc("raise_admin_alert", {
                p_type: "DRIVER_EMERGENCY_CHECKIN",
                p_title: "Driver emergency check-in",
                p_body: summary,
                p_severity: "CRITICAL",
                p_details: { driver_user_id: ctx.userId },
            });
            return error ? { error: error.message } : { success: true, admin_notified: true };
        }

        default:
            return { error: `unknown tool ${name}` };
    }
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

    // Identity from JWT — never from the request body.
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
        authHeader?.replace("Bearer ", "") ?? "",
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Role is resolved server-side, never trusted from the request: a
    // `drivers` row for this auth id means driver, anything else is treated
    // as rider. This is the whole "one shared AI connection" -- the caller
    // never declares who they are, the backend already knows.
    const { data: driverRow } = await supabase.from("drivers")
        .select("id").eq("user_id", user.id).maybeSingle();
    const role: Role = driverRow ? "driver" : "rider";

    let body: {
        message?: string; lat?: number; lng?: number; action?: string;
        mode?: string; hour?: number; is_rush_hour?: boolean; is_home_mode?: boolean;
        destination_name?: string; poi_data?: Array<Record<string, unknown>>;
    } = {};
    try { body = await req.json(); } catch { /* empty */ }

    const prefsTable = role === "driver" ? "driver_ai_preferences" : "rider_ai_preferences";
    const { data: prefs } = await supabase.from(prefsTable)
        .select("ai_suggestions_enabled, memory_enabled")
        .eq("user_id", user.id).maybeSingle();
    const suggestionsOn = prefs?.ai_suggestions_enabled === true;
    const memoryOn = suggestionsOn && prefs?.memory_enabled === true;

    // "Forget me" — wipes memory (+ reminders, riders only) — no LLM involved.
    if (body.action === "forget") {
        if (role === "driver") {
            await supabase.from("g_driver_memory").delete().eq("driver_user_id", user.id);
        } else {
            await Promise.all([
                supabase.from("g_rider_memory").delete().eq("rider_id", user.id),
                supabase.from("g_rider_reminders").delete().eq("rider_id", user.id).is("delivered_at", null),
            ]);
        }
        return json({ success: true, forgotten: true });
    }

    // Proactive mode is rider-only -- nothing in the driver app calls it.
    const isProactive = role === "rider" && body.mode === "proactive";
    const message = String(body.message ?? "").slice(0, 1000);
    if (!isProactive && !message) return json({ error: "message required" }, 400);
    if (!llmConfigured()) return json({ error: "assistant offline", offline: true }, 503);

    // Proactive suggestions need the rider to have opted in at all -- unlike a
    // conversational message (the rider is actively asking), an unsolicited
    // nudge with suggestions off would be exactly the "pushy, invasive" thing
    // this function's own system prompt promises never to be.
    if (isProactive && !suggestionsOn) {
        return json({ success: true, reply: null, skipped: "suggestions_off" });
    }

    // Per-caller daily cap. Proactive and conversational calls use SEPARATE
    // counters so a chatty rider doesn't burn their one daily nudge, and
    // vice versa. Driver and rider calls always use separate counters too
    // (different department key prefix) — separate budgets per role.
    const today = new Date().toISOString().slice(0, 10);
    const usageDept = isProactive ? `rider_proactive:${user.id}` : `${role}:${user.id}`;
    const dailyCap = isProactive ? PER_RIDER_DAILY_PROACTIVE_CALLS : PER_CALLER_DAILY_CALLS;
    const { data: usage } = await supabase.from("g_llm_usage")
        .select("calls").eq("day", today).eq("department", usageDept).maybeSingle();
    if ((usage?.calls ?? 0) >= dailyCap) {
        return isProactive
            ? json({ success: true, reply: null, skipped: "daily_cap" })
            : json({ reply: "You've reached today's G limit — I'll be fresh again tomorrow.", limited: true });
    }
    await supabase.rpc("g_add_llm_usage", {
        p_department: usageDept, p_prompt: 0, p_completion: 0, p_cost: 0,
    }).then(null, () => null);

    const ctx: Ctx = {
        role,
        userId: user.id,
        memoryOn,
        lat: typeof body.lat === "number" ? body.lat : null,
        lng: typeof body.lng === "number" ? body.lng : null,
    };

    // Personal context — ONLY with consent.
    let memoryBlock = `The ${role} has not enabled personalization; answer statelessly and do not reference any history.`;
    if (memoryOn && role === "driver") {
        const { data: memories } = await supabase.from("g_driver_memory")
            .select("kind, content, last_confirmed_at")
            .eq("driver_user_id", user.id)
            .order("last_confirmed_at", { ascending: false }).limit(15);
        memoryBlock = `Driver memory (consented): ${JSON.stringify(memories ?? [])}`;
    } else if (memoryOn) {
        const [{ data: memories }, { data: usuals }] = await Promise.all([
            supabase.from("g_rider_memory")
                .select("kind, content, last_confirmed_at")
                .eq("rider_id", user.id)
                .order("last_confirmed_at", { ascending: false }).limit(15),
            supabase.from("user_service_history")
                .select("visit_count, merchants(name, store_type)")
                .eq("user_id", user.id)
                .order("visit_count", { ascending: false }).limit(3),
        ]);
        memoryBlock = `Rider memory (consented): ${JSON.stringify(memories ?? [])}\nUsual merchants: ${JSON.stringify(usuals ?? [])}`;
    } else if (suggestionsOn && role === "rider") {
        memoryBlock = "Suggestions are on but memory is OFF: you may use suggest_places, but do not store or reference personal history.";
    }

    // Platform description sourced from g_config.platform_identity, not
    // hardcoded here — see _shared/identity.ts.
    const platformIdentity = await getPlatformIdentity(supabase);

    let system: string;
    if (role === "driver") {
        system = `You are G, this driver's assistant inside the ${platformIdentity.name} driver app (${platformIdentity.market}).
Direct, respectful, useful. You help with pay questions, safety, and being heard -- never chatty for its own sake.
${memoryBlock}
Hard rules:
- You have NO ability to change pay, commission, or bank details. explain_last_payout only reads real transaction records -- if the data isn't there, say so, never estimate.
- flag_concern sends something to admin for manual review -- it does not resolve anything itself; say so.
- Use emergency_checkin IMMEDIATELY if the driver signals they are unsafe or in danger right now -- do not hesitate or ask clarifying questions first.
- Only call remember_fact for things the driver clearly stated${memoryOn ? "" : " (memory is OFF — never call it)"}.
- Keep replies under 80 words. TTD currency.`;
    } else {
        const proactiveGuidance = isProactive
            ? `\nThis is an UNSOLICITED proactive check-in, not a reply to something the rider said -- keep it to one short, warm suggestion (10-15 words, one emoji), not a full conversation.
Trinidad & Tobago moments to draw on when relevant: Carnival (fete tickets, J'ouvert drivers, costume runners), inter-island trips (CAL/ferry to Tobago, villas), flash-flood-season routing (POS/Churchill-Roosevelt), local eats (doubles from Debe/Curepe, bake & shark from Maracas via the Merchant app), VIP nightlife (Ariapita Ave).`
            : "";
        system = `You are G, the rider's personal assistant inside the ${platformIdentity.name} app (${platformIdentity.market}).
Warm, brief, useful — never pushy, never invasive. You help them move, order, and remember.
${memoryBlock}${proactiveGuidance}
Hard rules:
- You cannot spend money. Order tools return DRAFTS the rider confirms in the app — say so naturally. initiate_lime_fleet only files a request for admin approval -- never claim a Lime Fleet is confirmed.
- Only call remember_fact for things the rider clearly stated or asked you to remember${memoryOn ? "" : " (memory is OFF — never call it)"}.
- Keep replies under 80 words. TTD currency. If you used a tool, weave the result in naturally.`;
    }

    const userContent = isProactive
        ? `Time: ${body.hour ?? new Date().getUTCHours()}:00 AST. ${body.is_rush_hour ? "Rush hour traffic." : "Traffic normal."} ${body.is_home_mode === false ? `In a ride toward ${body.destination_name || "their destination"}.` : "At home/idle."} Nearby: ${JSON.stringify((body.poi_data ?? []).slice(0, 5))}. Give one proactive suggestion or say nothing useful applies.`
        : message;

    const messages: LlmMessage[] = [{ role: "user", content: userContent }];
    const roleTools = role === "driver" ? DRIVER_TOOLS : RIDER_TOOLS;
    const tools = roleTools.filter((t) => memoryOn ? true : t.function.name !== "remember_fact");
    const toolResults: Array<{ tool: string; result: unknown }> = [];

    try {
        let iterations = 0;
        let reply = "";
        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const res = await chat(supabase, {
                department: role === "driver" ? "driver_concierge" : "rider_concierge",
                system,
                messages,
                tools: suggestionsOn ? tools : undefined,
                maxTokens: 700,
                temperature: role === "driver" ? 0.4 : 0.5,
            });
            const choice = res.choices?.[0];
            if (!choice) throw new Error("no choices");
            const msg = choice.message;
            messages.push(msg);

            if (!msg.tool_calls?.length) {
                reply = typeof msg.content === "string" ? msg.content : "";
                break;
            }
            for (const toolCall of msg.tool_calls.slice(0, 3)) {
                let parsed: Record<string, unknown> = {};
                try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* empty */ }
                const result = await executeTool(toolCall.function.name, parsed, supabase, ctx);
                toolResults.push({ tool: toolCall.function.name, result });
                messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
            }
        }
        return json({ success: true, reply: reply || (isProactive ? null : "Done."), tool_results: toolResults });
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return isProactive
                ? json({ success: true, reply: null, skipped: "budget_exceeded" })
                : json({ reply: "I'm resting to stay within budget — try me tomorrow.", limited: true });
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[g_rider_concierge]", msg);
        return isProactive ? json({ success: true, reply: null, skipped: "error" }) : json({ error: msg }, 500);
    }
});
