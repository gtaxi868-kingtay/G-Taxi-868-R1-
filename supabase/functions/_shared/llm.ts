export interface LlmTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface LlmMessage {
    role: string;
    content: unknown;
    tool_call_id?: string;
    tool_calls?: unknown[];
}

export interface ChatOptions {
    department: string;
    messages: LlmMessage[];
    system?: string;
    tools?: LlmTool[];
    toolChoice?: "auto" | "none";
    maxTokens?: number;
    temperature?: number;
}

export class BudgetExceededError extends Error {
    constructor(spent: number, budget: number) {
        super(`Daily LLM budget exhausted: $${spent.toFixed(4)} of $${budget.toFixed(2)}`);
        this.name = "BudgetExceededError";
    }
}

export class RateLimitedError extends Error {
    constructor(detail: string) {
        super(`Provider rate-limited: ${detail}`);
        this.name = "RateLimitedError";
    }
}

// Bump when this file changes. Each edge function bundles its OWN COPY of this
// file at deploy time, so a fix here does NOT propagate to already-deployed
// functions — that is exactly how g_agent_runner, platform_intelligence and
// g_rider_concierge sat on a retired model for three weeks after g_chat was
// fixed. Exposed via each function's ?health=1 branch so drift is provable
// instead of assumed.
export const LLM_GATEWAY_VERSION = "2026-09-06";

interface ProviderSpec {
    url: string;
    model: string;
    /**
     * Tried in order when the primary model 404s (model_not_found). A provider
     * retiring a model must degrade to a working one, never take G offline.
     */
    fallbackModels: string[];
    keyEnv: string;
    inputPerM: number;
    outputPerM: number;
}

// llama-3.3-70b-versatile was fully retired from Groq's production catalog
// (confirmed live 2026-08-17 against console.groq.com/docs/models, replaced
// by the openai/gpt-oss family) — it was the DEFAULT here, so every
// department using chat() with no GROQ_MODEL override was silently broken
// (Groq returns a clean 404 model_not_found, not a hang). Re-confirmed live
// 2026-09-05: g_chat/g_briefing/admin's bundled copies of this file still
// had the dead model — the 2026-08-17 fix only touched the 4 functions that
// bypassed the gateway with raw fetch() at the time, not this file's other
// consumers, since each edge function bundles its own copy.
const PROVIDERS: Record<string, ProviderSpec> = {
    groq: {
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
        fallbackModels: ["openai/gpt-oss-20b", "llama-3.1-8b-instant"],
        keyEnv: "GROQ_API_KEY",
        inputPerM: 0.15,
        outputPerM: 0.60,
    },
    xai: {
        url: "https://api.x.ai/v1/chat/completions",
        model: Deno.env.get("XAI_MODEL") ?? "grok-3-mini",
        fallbackModels: ["grok-2-1212"],
        keyEnv: "XAI_API_KEY",
        inputPerM: 0.30,
        outputPerM: 0.50,
    },
};

/** A provider 404 that means "this model is gone", not "bad request". */
function isModelGone(status: number, body: string): boolean {
    if (status !== 404) return false;
    const b = body.toLowerCase();
    return b.includes("model_not_found") || b.includes("does not exist");
}

/**
 * File ONE durable alert that the configured model has been retired. Deduped on
 * an unresolved alert for the same provider+model so a 5-minute sweep can't spam
 * the inbox. Best-effort: alerting must never be the reason a chat call fails.
 */
async function alertModelGone(
    // deno-lint-ignore no-explicit-any
    supabase: any, provider: string, model: string, servedBy: string | null,
): Promise<void> {
    try {
        const { data: open } = await supabase
            .from("system_alerts")
            .select("id")
            .eq("type", "G_LLM_MODEL_UNAVAILABLE")
            .is("resolved_at", null)
            .contains("details", { provider, model })
            .maybeSingle();
        if (open) return;

        await supabase.rpc("raise_admin_alert", {
            p_type: "G_LLM_MODEL_UNAVAILABLE",
            p_title: `LLM model retired: ${model}`,
            p_body: servedBy
                ? `${provider}'s "${model}" no longer exists. Still answering on the fallback "${servedBy}", but update GROQ_MODEL/the gateway default before the fallback goes too.`
                : `${provider}'s "${model}" no longer exists and every fallback also failed. G's departments are offline until this is changed.`,
            p_severity: servedBy ? "HIGH" : "CRITICAL",
            p_details: { provider, model, served_by: servedBy, gateway: LLM_GATEWAY_VERSION },
        });
    } catch { /* never let alerting break the call path */ }
}

const DEFAULT_DAILY_BUDGET_USD = 0.80;

function activeProviderName(): string {
    const name = (Deno.env.get("G_LLM_PROVIDER") ?? "groq").toLowerCase();
    return name in PROVIDERS ? name : "groq";
}

function activeProvider(): ProviderSpec {
    return PROVIDERS[activeProviderName()];
}

export function llmConfigured(): boolean {
    return Boolean(Deno.env.get(activeProvider().keyEnv));
}

/**
 * What THIS deployed bundle is actually running. Because every edge function
 * carries its own copy of this file, comparing this across functions is the only
 * reliable way to prove they are in sync — assuming propagation is what let a
 * retired model survive in three functions after being fixed in three others.
 * Deliberately makes no network call, so it is free to poll.
 */
export function llmGatewayInfo(): Record<string, unknown> {
    const p = activeProvider();
    return {
        gateway_version: LLM_GATEWAY_VERSION,
        provider: activeProviderName(),
        model: p.model,
        fallback_models: p.fallbackModels,
        key_configured: Boolean(Deno.env.get(p.keyEnv)),
    };
}

async function readDailyBudget(supabase: any): Promise<number> {
    const { data } = await supabase
        .from("g_config").select("value").eq("key", "daily_llm_budget_usd").maybeSingle();
    const v = Number(data?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_BUDGET_USD;
}

async function readSpentToday(supabase: any): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
        .from("g_llm_usage").select("est_cost_usd").eq("day", today);
    return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.est_cost_usd || 0), 0);
}

export async function chat(supabase: any, opts: ChatOptions): Promise<any> {
    const provider = activeProvider();
    const apiKey = Deno.env.get(provider.keyEnv);
    if (!apiKey) throw new Error(`LLM key ${provider.keyEnv} not configured`);

    const [budget, spent] = await Promise.all([
        readDailyBudget(supabase),
        readSpentToday(supabase),
    ]);
    if (spent >= budget) {
        await supabase.from("system_alerts").insert({
            type: "G_BUDGET_EXHAUSTED",
            severity: "WARNING",
            title: "G daily LLM budget exhausted — deterministic mode",
            details: { spent_usd: spent, budget_usd: budget, department: opts.department },
        }).then(null, () => null);
        throw new BudgetExceededError(spent, budget);
    }

    // GPT-OSS models spend completion_tokens on a hidden chain-of-thought
    // before the visible answer — a low max_tokens budget gets entirely
    // consumed by reasoning, returning empty content with a 200 (confirmed
    // live 2026-08-17: reasoning_tokens 254/256, finish_reason "length").
    // Floor raised gateway-wide so no caller can under-budget this away, and
    // reasoning_effort turned down for GPT-OSS specifically so more of the
    // budget lands in the actual answer.
    const isGptOss = provider.model.startsWith("openai/gpt-oss");
    const body: Record<string, unknown> = {
        model: provider.model,
        max_tokens: Math.min(Math.max(opts.maxTokens ?? 2048, 512), 4096),
        temperature: opts.temperature ?? 0.3,
        messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            ...opts.messages,
        ],
    };
    if (isGptOss) {
        body.reasoning_effort = "low";
    }
    if (opts.tools?.length) {
        body.tools = opts.tools;
        body.tool_choice = opts.toolChoice ?? "auto";
    }

    let lastErr = "";
    const backoffs = [3000, 8000, 16000];

    // Try the configured model, then each fallback. A retired model must cost us
    // one failed request, not three weeks of silence — on 2026-08-16 the default
    // here was retired by Groq and every department 404'd daily until 2026-09-05
    // without anything degrading, retrying, or alerting.
    const candidates = [provider.model, ...provider.fallbackModels];

    for (let c = 0; c < candidates.length; c++) {
        const model = candidates[c];
        body.model = model;
        // reasoning_effort is a GPT-OSS-only parameter; a fallback to a
        // non-GPT-OSS model must not carry it or the request is rejected.
        if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
        else delete body.reasoning_effort;

        let modelGone = false;

        for (let attempt = 0; attempt < backoffs.length; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            try {
                const res = await fetch(provider.url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                if (res.status === 429 || res.status >= 500) {
                    lastErr = `${res.status}: ${await res.text()}`;
                    await new Promise((r) => setTimeout(r, backoffs[attempt]));
                    continue;
                }
                if (!res.ok) {
                    const text = await res.text();
                    lastErr = `${res.status}: ${text}`;
                    // Model retired — no amount of retrying fixes it. Move on.
                    if (isModelGone(res.status, text)) {
                        modelGone = true;
                        break;
                    }
                    throw new Error(`LLM API error ${res.status}: ${text}`);
                }

                const json = await res.json();
                const usage = json.usage ?? {};
                const promptTokens = Number(usage.prompt_tokens ?? 0);
                const completionTokens = Number(usage.completion_tokens ?? 0);
                const cost = (promptTokens * provider.inputPerM + completionTokens * provider.outputPerM) / 1_000_000;
                await supabase.rpc("g_add_llm_usage", {
                    p_department: opts.department,
                    p_prompt: promptTokens,
                    p_completion: completionTokens,
                    p_cost: cost,
                }).then(null, () => null);

                // Served by a fallback: still answer, but make the retirement
                // loudly visible so the default gets updated deliberately.
                if (c > 0) await alertModelGone(supabase, activeProviderName(), provider.model, model);

                return json;
            } finally {
                clearTimeout(timer);
            }
        }

        if (!modelGone) break; // a non-model failure won't be fixed by another model
    }

    // Every candidate is gone — this is the state that took G offline for three
    // weeks. Alert at CRITICAL before throwing, so it can never be silent again.
    if (isModelGone(Number(lastErr.split(":")[0]), lastErr)) {
        await alertModelGone(supabase, activeProviderName(), provider.model, null);
    }
    if (/^429/.test(lastErr)) throw new RateLimitedError(lastErr);
    throw new Error(`LLM API unavailable after retry (${lastErr})`);
}
