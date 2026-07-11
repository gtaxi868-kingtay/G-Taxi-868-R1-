// supabase/functions/g_rider_concierge/index.ts
// Rider-facing "G" — one chat/voice endpoint that remembers the rider (ONLY
// with consent), drafts order lists, sets reminders, and suggests places.
//
// Consent model:
//  - rider_ai_preferences.ai_suggestions_enabled = master switch. Off → G still
//    answers, but stateless: no memory reads, no memory writes, no history use.
//  - rider_ai_preferences.memory_enabled = memory switch. Both on → G recalls
//    and records structured facts in g_rider_memory (RLS: own rows only).
//  - action:"forget" deletes every memory row — the "forget me" button.
//
// Money guard: G has NO payment tools. create_order_list / reorder_usual return
// DRAFTS the app renders into a cart; the rider always taps to confirm.
//
// Cost guard: 5 LLM calls per rider per day (g_llm_usage, department
// "rider_concierge") on top of the global daily budget in _shared/llm.ts.
//
// Auth: rider JWT (verify_jwt true).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, LlmMessage, LlmTool } from "../_shared/llm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_ITERATIONS = 4;
const PER_RIDER_DAILY_CALLS = 5;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// deno-lint-ignore no-explicit-any
type Svc = any;

interface RiderCtx {
    riderId: string;
    memoryOn: boolean;
    lat: number | null;
    lng: number | null;
}

// ── Tools ──────────────────────────────────────────────────────────────────────

const TOOL_DEFS: LlmTool[] = [
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
];

async function executeTool(
    name: string, input: Record<string, unknown>, supabase: Svc, ctx: RiderCtx,
): Promise<unknown> {
    switch (name) {
        case "remember_fact": {
            if (!ctx.memoryOn) return { error: "memory is off — the rider has not enabled it" };
            const kind = String(input.kind ?? "fact");
            if (!["preference", "frequent_order", "place", "fact"].includes(kind)) {
                return { error: "invalid kind" };
            }
            const { error } = await supabase.from("g_rider_memory").insert({
                rider_id: ctx.riderId,
                kind,
                content: input.content ?? {},
            });
            return error ? { error: error.message } : { success: true, remembered: true };
        }

        case "reorder_usual": {
            const { data: usual } = await supabase.from("user_service_history")
                .select("merchant_id, visit_count, merchants(name)")
                .eq("user_id", ctx.riderId)
                .order("visit_count", { ascending: false }).limit(1).maybeSingle();
            if (!usual) return { error: "no order history yet" };
            const { data: lastOrder } = await supabase.from("orders")
                .select("id, total_cents, order_items(name, quantity, price_cents)")
                .eq("user_id", ctx.riderId).eq("merchant_id", usual.merchant_id)
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
                rider_id: ctx.riderId,
                message: String(input.message ?? "").slice(0, 200),
                due_at: dueAt.toISOString(),
                recurrence,
            });
            return error ? { error: error.message } : { success: true, due_at: dueAt.toISOString() };
        }

        case "suggest_places": {
            if (ctx.lat == null || ctx.lng == null) return { error: "no location provided" };
            const { data, error } = await supabase.rpc("g_rank_merchants", {
                p_rider_id: ctx.riderId,
                p_lat: ctx.lat,
                p_lng: ctx.lng,
                p_store_type: input.store_type ? String(input.store_type) : null,
                p_limit: 5,
            });
            return error ? { error: error.message } : data ?? [];
        }

        default:
            return { error: `unknown tool ${name}` };
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // Identity from JWT — never from the request body.
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
        authHeader?.replace("Bearer ", "") ?? "",
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: { message?: string; lat?: number; lng?: number; action?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }

    // Consent flags.
    const { data: prefs } = await supabase.from("rider_ai_preferences")
        .select("ai_suggestions_enabled, memory_enabled")
        .eq("user_id", user.id).maybeSingle();
    const suggestionsOn = prefs?.ai_suggestions_enabled === true;
    const memoryOn = suggestionsOn && prefs?.memory_enabled === true;

    // "Forget me" — wipes memory and reminders, no LLM involved.
    if (body.action === "forget") {
        await Promise.all([
            supabase.from("g_rider_memory").delete().eq("rider_id", user.id),
            supabase.from("g_rider_reminders").delete().eq("rider_id", user.id).is("delivered_at", null),
        ]);
        return json({ success: true, forgotten: true });
    }

    const message = String(body.message ?? "").slice(0, 1000);
    if (!message) return json({ error: "message required" }, 400);
    if (!llmConfigured()) return json({ error: "assistant offline", offline: true }, 503);

    // Per-rider daily cap (shares the g_llm_usage meter; per-rider count via
    // memory-cheap department key would explode rows, so count today's calls
    // from the rider's own recent decisions instead: simple counter table row).
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase.from("g_llm_usage")
        .select("calls").eq("day", today).eq("department", `rider:${user.id}`).maybeSingle();
    if ((usage?.calls ?? 0) >= PER_RIDER_DAILY_CALLS) {
        return json({ reply: "You've reached today's G limit — I'll be fresh again tomorrow.", limited: true });
    }
    await supabase.rpc("g_add_llm_usage", {
        p_department: `rider:${user.id}`, p_prompt: 0, p_completion: 0, p_cost: 0,
    }).then(null, () => null);

    const ctx: RiderCtx = {
        riderId: user.id,
        memoryOn,
        lat: typeof body.lat === "number" ? body.lat : null,
        lng: typeof body.lng === "number" ? body.lng : null,
    };

    // Personal context — ONLY with consent.
    let memoryBlock = "The rider has not enabled personalization; answer statelessly and do not reference any history.";
    if (memoryOn) {
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
    } else if (suggestionsOn) {
        memoryBlock = "Suggestions are on but memory is OFF: you may use suggest_places, but do not store or reference personal history.";
    }

    const system = `You are G, the rider's personal assistant inside the G-Taxi app (Trinidad & Tobago).
Warm, brief, useful — never pushy, never invasive. You help them move, order, and remember.
${memoryBlock}
Hard rules:
- You cannot spend money. Order tools return DRAFTS the rider confirms in the app — say so naturally.
- Only call remember_fact for things the rider clearly stated or asked you to remember${memoryOn ? "" : " (memory is OFF — never call it)"}.
- Keep replies under 80 words. TTD currency. If you used a tool, weave the result in naturally.`;

    const messages: LlmMessage[] = [{ role: "user", content: message }];
    const tools = TOOL_DEFS.filter((t) =>
        memoryOn ? true : t.function.name !== "remember_fact"
    );
    const toolResults: Array<{ tool: string; result: unknown }> = [];

    try {
        let iterations = 0;
        let reply = "";
        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const res = await chat(supabase, {
                department: "rider_concierge",
                system,
                messages,
                tools: suggestionsOn ? tools : undefined,
                maxTokens: 700,
                temperature: 0.5,
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
        return json({ success: true, reply: reply || "Done.", tool_results: toolResults });
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return json({ reply: "I'm resting to stay within budget — try me tomorrow.", limited: true });
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[g_rider_concierge]", msg);
        return json({ error: msg }, 500);
    }
});
