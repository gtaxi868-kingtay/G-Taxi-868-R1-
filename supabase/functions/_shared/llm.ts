// supabase/functions/_shared/llm.ts
// Provider-agnostic chat-completions gateway with a hard daily budget stop.
//
// Providers are OpenAI-compatible. Default is Groq (free tier, key already set).
// To switch to Grok (xAI): set G_LLM_PROVIDER=xai and XAI_API_KEY in dashboard
// secrets — no code change. Costs are metered at PAID rates even on free tiers
// so g_llm_usage is an honest meter; when the day's spend crosses the
// g_config.daily_llm_budget_usd cap, calls throw BudgetExceededError and
// callers must degrade to deterministic behavior (never crash the pre-steps).

// deno-lint-ignore-file no-explicit-any

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
    /** Which G department (or function name) is spending — recorded in g_llm_usage. */
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

// Thrown when the provider's per-minute rate limit is still hitting after
// retries (common on Groq's free tier: 12k tokens/min shared org-wide).
// Callers should treat this as a soft "try again in a moment", not a crash.
export class RateLimitedError extends Error {
    constructor(detail: string) {
        super(`Provider rate-limited: ${detail}`);
        this.name = "RateLimitedError";
    }
}

interface ProviderSpec {
    url: string;
    model: string;
    keyEnv: string;
    // USD per 1M tokens, used for honest metering even while the tier is free.
    inputPerM: number;
    outputPerM: number;
}

const PROVIDERS: Record<string, ProviderSpec> = {
    groq: {
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
        keyEnv: "GROQ_API_KEY",
        inputPerM: 0.59,
        outputPerM: 0.79,
    },
    xai: {
        url: "https://api.x.ai/v1/chat/completions",
        model: Deno.env.get("XAI_MODEL") ?? "grok-3-mini",
        keyEnv: "XAI_API_KEY",
        inputPerM: 0.30,
        outputPerM: 0.50,
    },
};

const DEFAULT_DAILY_BUDGET_USD = 0.80;

function activeProvider(): ProviderSpec {
    const name = (Deno.env.get("G_LLM_PROVIDER") ?? "groq").toLowerCase();
    return PROVIDERS[name] ?? PROVIDERS.groq;
}

/** True when an LLM key is configured for the active provider. */
export function llmConfigured(): boolean {
    return Boolean(Deno.env.get(activeProvider().keyEnv));
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

/**
 * One chat-completions call through the gateway. Returns the raw OpenAI-style
 * response JSON. Throws BudgetExceededError when the daily cap is reached, or
 * Error on provider failure (after one retry on 429/5xx).
 */
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

    const body: Record<string, unknown> = {
        model: provider.model,
        max_tokens: Math.min(opts.maxTokens ?? 2048, 4096),
        temperature: opts.temperature ?? 0.3,
        messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            ...opts.messages,
        ],
    };
    if (opts.tools?.length) {
        body.tools = opts.tools;
        body.tool_choice = opts.toolChoice ?? "auto";
    }

    let lastErr = "";
    const backoffs = [3000, 8000, 16000]; // Groq free tier TPM window needs ~15s
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
            if (!res.ok) throw new Error(`LLM API error ${res.status}: ${await res.text()}`);

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

            return json;
        } finally {
            clearTimeout(timer);
        }
    }
    if (/^429/.test(lastErr)) throw new RateLimitedError(lastErr);
    throw new Error(`LLM API unavailable after retry (${lastErr})`);
}
