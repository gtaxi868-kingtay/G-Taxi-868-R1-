// supabase/functions/g_driver_concierge/index.ts
// Driver-facing "G" — Phase 2 of the reviewed 3-voice AI architecture.
// Mirrors g_rider_concierge's proven pattern (budget-capped via
// _shared/llm.ts, per-driver rate limit, consent-gated memory, no tool that
// can touch money or bank details) rather than inventing a new safety model.
// Before this, drivers had NO AI touchpoint at all -- confirmed by grepping
// the entire driver app for any AI/concierge reference: zero matches.
//
// Consent model (identical shape to rider_ai_preferences):
//  - driver_ai_preferences.ai_suggestions_enabled = master switch.
//  - driver_ai_preferences.memory_enabled = memory switch. Both on → G
//    recalls and records facts in g_driver_memory (RLS: own rows only).
//  - action:"forget" deletes every memory row.
//
// Money/safety guard (stricter than the rider's, on purpose -- a driver AI
// with write access to pay-adjacent columns risks real income, not just an
// unwanted cart):
//  - explain_last_payout is READ-ONLY against wallet_transactions
//    (SUM(amount), this codebase's own source of truth for money -- never a
//    cached balance column) and rides' fare columns. It cannot invent a
//    number: if the data isn't there, it says so.
//  - No tool can write to wallet_transactions, drivers.bank_details,
//    drivers.commission_tier, or drivers.custom_commission_rate — those
//    stay entirely outside this AI's reach, read or write.
//  - flag_concern files a g_proposed_actions row (manual_ack, admin sees it,
//    nothing auto-executes).
//  - emergency_checkin is NOT draft-gated — it reaches admin immediately via
//    the same raise_admin_alert() path other CRITICAL alerts in this
//    codebase already use, not a parallel channel.
//
// Cost guard: 5 LLM calls per driver per day (g_llm_usage, department
// "driver_concierge") on top of the global daily budget in _shared/llm.ts.
//
// Auth: driver JWT (verify_jwt true). Identity resolved from auth.uid()
// only -- never a client-supplied id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, LlmMessage, LlmTool } from "../_shared/llm.ts";
import { getPlatformIdentity } from "../_shared/identity.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_ITERATIONS = 4;
const PER_DRIVER_DAILY_CALLS = 5;

// deno-lint-ignore no-explicit-any
type Svc = any;

interface DriverCtx {
    driverUserId: string;
    driverPk: string | null;
    memoryOn: boolean;
}

// ── Tools ──────────────────────────────────────────────────────────────────────

const TOOL_DEFS: LlmTool[] = [
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
    name: string, input: Record<string, unknown>, supabase: Svc, ctx: DriverCtx,
): Promise<unknown> {
    switch (name) {
        case "remember_fact": {
            if (!ctx.memoryOn) return { error: "memory is off — the driver has not enabled it" };
            const kind = String(input.kind ?? "route_note");
            if (!["preference", "route_note"].includes(kind)) return { error: "invalid kind" };
            const { error } = await supabase.from("g_driver_memory").insert({
                driver_user_id: ctx.driverUserId,
                kind,
                content: input.content ?? {},
            });
            return error ? { error: error.message } : { success: true, remembered: true };
        }

        case "explain_last_payout": {
            if (!ctx.driverPk) return { error: "no driver record found for this account" };
            // wallet_transactions is this codebase's own source of truth for
            // money (SUM(amount)), never a cached balance column. Reads the
            // driver's last completed ride's earnings and whatever else
            // posted around it -- never computes or guesses a number that
            // isn't a real row here.
            const { data: rows, error } = await supabase
                .from("wallet_transactions")
                .select("amount, transaction_type, description, ride_id, created_at")
                .eq("user_id", ctx.driverUserId)
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
                payload: { driver_user_id: ctx.driverUserId, concern: summary, concern_category: category },
                status: "pending",
            });
            if (ctx.memoryOn) {
                await supabase.from("g_driver_memory").insert({
                    driver_user_id: ctx.driverUserId, kind: "concern",
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
                p_details: { driver_user_id: ctx.driverUserId },
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

    // Must actually be a registered driver -- this is a driver-facing
    // endpoint, not a general chat surface.
    const { data: driverRow } = await supabase.from("drivers")
        .select("id").eq("user_id", user.id).maybeSingle();
    if (!driverRow) return json({ error: "Not a registered driver" }, 403);

    let body: { message?: string; action?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }

    const { data: prefs } = await supabase.from("driver_ai_preferences")
        .select("ai_suggestions_enabled, memory_enabled")
        .eq("user_id", user.id).maybeSingle();
    const suggestionsOn = prefs?.ai_suggestions_enabled === true;
    const memoryOn = suggestionsOn && prefs?.memory_enabled === true;

    if (body.action === "forget") {
        await supabase.from("g_driver_memory").delete().eq("driver_user_id", user.id);
        return json({ success: true, forgotten: true });
    }

    const message = String(body.message ?? "").slice(0, 1000);
    if (!message) return json({ error: "message required" }, 400);
    if (!llmConfigured()) return json({ error: "assistant offline", offline: true }, 503);

    const today = new Date().toISOString().slice(0, 10);
    const usageDept = `driver:${user.id}`;
    const { data: usage } = await supabase.from("g_llm_usage")
        .select("calls").eq("day", today).eq("department", usageDept).maybeSingle();
    if ((usage?.calls ?? 0) >= PER_DRIVER_DAILY_CALLS) {
        return json({ reply: "You've reached today's G limit — I'll be fresh again tomorrow.", limited: true });
    }
    await supabase.rpc("g_add_llm_usage", {
        p_department: usageDept, p_prompt: 0, p_completion: 0, p_cost: 0,
    }).then(null, () => null);

    const ctx: DriverCtx = { driverUserId: user.id, driverPk: driverRow.id, memoryOn };

    let memoryBlock = "The driver has not enabled personalization; answer statelessly and do not reference any history.";
    if (memoryOn) {
        const { data: memories } = await supabase.from("g_driver_memory")
            .select("kind, content, last_confirmed_at")
            .eq("driver_user_id", user.id)
            .order("last_confirmed_at", { ascending: false }).limit(15);
        memoryBlock = `Driver memory (consented): ${JSON.stringify(memories ?? [])}`;
    }

    const platformIdentity = await getPlatformIdentity(supabase);
    const system = `You are G, this driver's assistant inside the ${platformIdentity.name} driver app (${platformIdentity.market}).
Direct, respectful, useful. You help with pay questions, safety, and being heard -- never chatty for its own sake.
${memoryBlock}
Hard rules:
- You have NO ability to change pay, commission, or bank details. explain_last_payout only reads real transaction records -- if the data isn't there, say so, never estimate.
- flag_concern sends something to admin for manual review -- it does not resolve anything itself; say so.
- Use emergency_checkin IMMEDIATELY if the driver signals they are unsafe or in danger right now -- do not hesitate or ask clarifying questions first.
- Only call remember_fact for things the driver clearly stated${memoryOn ? "" : " (memory is OFF — never call it)"}.
- Keep replies under 80 words. TTD currency.`;

    const messages: LlmMessage[] = [{ role: "user", content: message }];
    const tools = TOOL_DEFS.filter((t) => memoryOn ? true : t.function.name !== "remember_fact");
    const toolResults: Array<{ tool: string; result: unknown }> = [];

    try {
        let iterations = 0;
        let reply = "";
        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const res = await chat(supabase, {
                department: "driver_concierge",
                system,
                messages,
                tools: suggestionsOn ? tools : undefined,
                maxTokens: 700,
                temperature: 0.4,
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
        console.error("[g_driver_concierge]", msg);
        return json({ error: msg }, 500);
    }
});
