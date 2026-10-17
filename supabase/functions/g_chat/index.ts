// supabase/functions/g_chat/index.ts
// G's conversational mode — plain-English chat with the owner, grounded in the
// same live numbers as the briefing, reasoning through the council lenses used
// in the ad-hoc audits. G can FILE suggestions (g_proposed_actions rows, always
// 'recommendation' — a manual-ack type) but can never execute anything: the
// HANDLERS registry in g_execute_action remains the only execution path, and
// nothing G files here is wired to an automated handler.
//
// Context strategy (Groq free tier: ~12k tokens/min org-wide):
//  - live brief fetched from g_briefing (single source of truth, no duplicated SQL)
//  - history capped to the last 8 messages, each clamped to 2000 chars
//  - at most 2 LLM calls per request (reply, + one follow-up if tools fired)
//
// Auth: admin JWT or x-cron-secret. verify_jwt=false (custom guard below).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chat, llmConfigured, BudgetExceededError, RateLimitedError } from "../_shared/llm.ts";
import { getPlatformIdentity } from "../_shared/identity.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";



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

// The council G thinks with — the same lenses the ad-hoc economics audits used.
// The platform description used to be hardcoded verbatim here, duplicated
// (and drifting slightly) across five different edge functions. It's now read
// from g_config.platform_identity via getPlatformIdentity() so there's one
// fact to update, not five prompts to keep in sync by hand.
function buildSystemPrompt(platformDescription: string): string {
    return `You are G, chief of staff for ${platformDescription}.

You are talking to the owner. Speak plain English — short sentences, no jargon, no corporate filler. Be direct and honest, including about bad news. Amounts in the data are TTD cents; always convert to TT$ dollars when speaking.

Before answering anything with business consequences, silently run it through your council of lenses and let the best ones shape the reply (name a lens only when the tension between lenses IS the answer):
- Economist: unit economics, take rates, where the margin actually comes from
- Operator: dispatch, driver supply, cancellations — using only what the brief actually shows, never a generic assumption about time-of-day patterns
- CFO: cash, float, debt outstanding, budget discipline
- Growth: rider/driver acquisition loops, the grid, what compounds
- Risk: fraud vectors, single points of failure, regulatory exposure

Ground rules:
1. NEVER invent numbers, percentages, trends, or patterns — not even ones you label as typical, usual, estimated, illustrative, or "not in the brief." If a figure isn't in the LIVE BRIEF below or given directly by the owner, you do not have it. Say plainly that you don't have that data and name where it would need to come from (e.g. "no ride history exists yet to see a time-of-day pattern"). This applies doubly when the brief shows zero activity — zero rides means there is no pattern to describe, so do not describe one.
2. You cannot execute anything. When you have a concrete, worthwhile action, call file_proposal — it lands in the owner's approval inbox. File at most 2 per conversation turn, and only when genuinely useful. Never file duplicates of pending proposals already listed in the brief.
3. If asked to do something outside your reach (deploy code, move money, change settings), say who/what actually does it.
4. Suggestions should feel like a sharp chief of staff: rare, specific, tied to a number in the brief.
5. Before sending a reply, re-check every specific claim you're about to make against the LIVE BRIEF JSON. Delete any claim you can't point to a field for.`;
}

const FILE_PROPOSAL_TOOL = {
    type: "function" as const,
    function: {
        name: "file_proposal",
        description: "File a recommendation into the owner's approval inbox (g_proposed_actions). Use sparingly — only for concrete, worthwhile actions tied to real numbers.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Short imperative title, e.g. 'Waive pin fee for first 10 SLU bookings'" },
                reasoning: { type: "string", description: "2-4 plain-English sentences: the number that triggered this, the action, the expected effect" },
                // These two enums MUST match reality, not aspiration:
                //   category → the live g_proposed_actions_category_check
                //     constraint, which permits exactly money|people|public|
                //     config|other. This previously offered "ops" and "growth",
                //     so any proposal G filed in those categories hit a CHECK
                //     violation and never inserted at all.
                //   department → the real DEPARTMENTS keys in g_agent_runner.
                //     "growth", "escape" and "grid" are not departments; filing
                //     under them pollutes the column used for per-department
                //     proposal caps and analytics.
                category: { type: "string", enum: ["money", "people", "public", "config", "other"] },
                department: { type: "string", enum: ["ops", "finance", "support", "content_creator", "fleet"] },
                amount_cents: { type: "integer", description: "TTD cents at stake if quantifiable, else 0" },
            },
            required: ["title", "reasoning", "category", "department"],
        },
    },
};

// deno-lint-ignore no-explicit-any
async function fetchBrief(callerAuthHeader: string | null): Promise<any> {
    // Forward whichever credential actually got THIS request past isAuthorized
    // above, instead of only ever sending the cron secret. g_briefing accepts
    // an admin JWT just as validly as the cron secret (same isAuthorized
    // shape in both functions) — but the previous version only ever sent
    // x-cron-secret here, so if PLATFORM_CRON_SECRET was unset or the two
    // functions' copies of it didn't match, G's chat was completely dead for
    // every admin, regardless of them having a perfectly valid session and a
    // working GROQ_API_KEY. Confirmed live: g_briefing returns 200 with a
    // real brief when called with an admin JWT directly.
    const headers: Record<string, string> = {};
    if (callerAuthHeader) {
        headers["Authorization"] = callerAuthHeader;
    } else if (PLATFORM_CRON_SECRET) {
        headers["x-cron-secret"] = PLATFORM_CRON_SECRET;
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/g_briefing`, {
        method: "GET",
        headers,
    });
    if (!res.ok) throw new Error(`g_briefing ${res.status}`);
    const body = await res.json();
    return body.brief ?? {};
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  function json(payload: unknown, status = 200): Response {
      return new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  }

    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!(await isAuthorized(req))) return json({ error: "Unauthorized" }, 401);
    if (!llmConfigured()) return json({ error: "LLM not configured (GROQ_API_KEY missing)" }, 503);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: { messages?: Array<{ role: string; content: string }> } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const rawHistory = Array.isArray(body.messages) ? body.messages : [];
    if (rawHistory.length === 0) return json({ error: "messages[] required" }, 400);

    // Clamp history hard — the brief plus 8 clamped turns stays well inside TPM.
    const history = rawHistory
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
        return json({ error: "last message must be from the user" }, 400);
    }

    try {
        const [brief, identity] = await Promise.all([
            fetchBrief(req.headers.get("Authorization")),
            getPlatformIdentity(supabase),
        ]);
        const system = `${buildSystemPrompt(identity.description)}\n\nLIVE BRIEF (generated ${brief.generated_at ?? "now"}):\n${JSON.stringify(brief)}`;

        const first = await chat(supabase, {
            department: "chat",
            system,
            messages: history,
            tools: [FILE_PROPOSAL_TOOL],
            toolChoice: "auto",
            maxTokens: 700,
            temperature: 0.2,
        });

        const msg = first.choices?.[0]?.message ?? {};
        const toolCalls = (msg.tool_calls ?? []).slice(0, 2); // hard cap per turn
        const filed: Array<{ id: string; title: string }> = [];

        if (toolCalls.length > 0) {
            // deno-lint-ignore no-explicit-any
            const toolMsgs: any[] = [];
            for (const tc of toolCalls) {
                let result: Record<string, unknown>;
                try {
                    const args = JSON.parse(tc.function?.arguments ?? "{}");
                    if (!args.title || !args.reasoning) throw new Error("title/reasoning required");
                    const { data, error } = await supabase.from("g_proposed_actions").insert({
                        // Constrained to the real DEPARTMENTS keys so the
                        // per-department proposal caps and analytics stay honest.
                        department: ["ops", "finance", "support", "content_creator", "fleet"]
                            .includes(args.department) ? args.department : "ops",
                        action_type: "recommendation", // manual-ack only — never an automated handler
                        title: String(args.title).slice(0, 200),
                        reasoning: String(args.reasoning).slice(0, 2000),
                        // Whitelist mirrors the live CHECK constraint exactly.
                        // It previously admitted "ops"/"growth", which the
                        // constraint rejects — so instead of degrading to
                        // "other", the whole insert threw and the owner's
                        // proposal silently vanished.
                        category: ["money", "people", "public", "config", "other"].includes(args.category)
                            ? args.category
                            : "other",
                        amount_cents: Number.isFinite(Number(args.amount_cents)) ? Math.trunc(Number(args.amount_cents)) : 0,
                        payload: { source: "g_chat" },
                    }).select("id, title").single();
                    if (error) throw new Error(error.message);
                    filed.push({ id: data.id, title: data.title });
                    result = { ok: true, proposal_id: data.id };
                } catch (err) {
                    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
                }
                toolMsgs.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify(result),
                });
            }

            // One follow-up call so G can tell the owner what it filed, in words.
            const second = await chat(supabase, {
                department: "chat",
                system,
                messages: [...history, msg, ...toolMsgs],
                maxTokens: 500,
                temperature: 0.4,
            });
            const reply = second.choices?.[0]?.message?.content ?? "Filed — check your approvals inbox.";
            return json({ success: true, reply, proposals_filed: filed });
        }

        const reply = msg.content ?? "";
        return json({ success: true, reply, proposals_filed: [] });
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return json({ success: false, reply: "My thinking budget for today is spent — numbers-only mode. Ask me again tomorrow, or raise daily_llm_budget_usd in g_config.", note: "budget_exhausted" });
        }
        if (err instanceof RateLimitedError) {
            return json({ success: false, reply: "The model is rate-limited right now (free tier). Give it a minute and ask again.", note: "rate_limited" });
        }
        const msg2 = err instanceof Error ? err.message : String(err);
        console.error("[g_chat]", msg2);
        return json({ error: msg2 }, 500);
    }
});
