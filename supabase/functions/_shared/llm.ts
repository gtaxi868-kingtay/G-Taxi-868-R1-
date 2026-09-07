// supabase/functions/_shared/llm.ts
// Provider-agnostic chat-completions gateway with a hard daily budget stop,
// model-level fallback WITHIN a provider, and provider-level fallback ACROSS
// providers.
//
// This file's base is the version deployed 2026-09-06 (pulled from the live
// bundle, not from git — see the bundling note on LLM_GATEWAY_VERSION for why
// git is not authoritative here). Everything that version got right is kept
// verbatim: the max_tokens floor, reasoning_effort, the dedup'd retirement
// alert, and the per-model fallback chain.
//
// WHAT THIS REVISION ADDS: a second axis of fallback.
//
// The 2026-09-06 gateway falls back across MODELS but only ever talks to ONE
// provider. That covers "Groq retired this model" — the failure that actually
// happened — but not "the Groq key is revoked", "the Groq account is rate
// capped for the day", or "Groq is down". In all three the whole candidate list
// fails identically and every AI feature goes dark again, for a reason no model
// swap can fix.
//
// So providers are now a chain too. G_LLM_FALLBACKS is a comma-separated list
// (default "cerebras,gemini"); any provider whose key is not configured is
// skipped, which means arming a fallback is a secret change with no redeploy.
// All providers below are OpenAI-compatible with a free tier and no credit card
// (directory: github.com/open-free-llm-api/awesome-freellm-apis, model ids
// cross-checked against each provider's own docs 2026-09-06).
//
// Costs are metered at PAID rates even on free tiers so g_llm_usage stays an
// honest meter; when the day's spend crosses g_config.daily_llm_budget_usd,
// calls throw BudgetExceededError and callers must degrade to deterministic
// behavior (never crash the pre-steps).

// deno-lint-ignore-file no-explicit-any

import { GROQ_CHAT_MODEL as GROQ_MODEL_ID, isGptOss } from "./ai_model.ts";

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
export const LLM_GATEWAY_VERSION = "2026-09-07";

interface ProviderSpec {
    /** Short name used in alerts, logs and llmGatewayInfo(). */
    label: string;
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
    /** False for free tiers that reject tool/function-calling requests. */
    supportsTools: boolean;
}

// llama-3.3-70b-versatile was moved off Groq's free developer plan (confirmed
// live 2026-08-17, re-confirmed 2026-09-06: the id is still listed at
// console.groq.com/docs/models but now reads "Enterprise", price and rate
// limits both "Contact Sales"). It was the DEFAULT here, so every department
// using chat() with no GROQ_MODEL override was silently broken — Groq returns
// a clean 404 model_not_found on a free-tier key, not a hang.
//
// Re-confirmed live 2026-09-05: g_chat/g_briefing/admin's bundled copies of
// this file still had the dead model — the 2026-08-17 fix only touched the 4
// functions that bypassed the gateway with raw fetch() at the time, not this
// file's other consumers, since each edge function bundles its own copy.
const PROVIDERS: Record<string, ProviderSpec> = {
    groq: {
        label: "groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: GROQ_MODEL_ID,
        fallbackModels: ["openai/gpt-oss-20b", "llama-3.1-8b-instant"],
        keyEnv: "GROQ_API_KEY",
        inputPerM: 0.15,
        outputPerM: 0.60,
        supportsTools: true,
    },
    cerebras: {
        label: "cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        model: Deno.env.get("CEREBRAS_MODEL") ?? "zai-glm-4.7",
        fallbackModels: ["llama3.1-70b"],
        keyEnv: "CEREBRAS_API_KEY",
        // Free tier: 10 RPM / 100 RPD / 1M TPD. Metered at the nearest paid
        // equivalent so g_llm_usage stays honest across a failover.
        inputPerM: 0.10,
        outputPerM: 0.10,
        supportsTools: true,
    },
    gemini: {
        label: "gemini",
        // Google's OpenAI-compatibility shim — same request/response shape.
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash",
        fallbackModels: ["gemini-3.5-flash-lite"],
        keyEnv: "GEMINI_API_KEY",
        inputPerM: 0.075,
        outputPerM: 0.30,
        supportsTools: true,
    },
    mistral: {
        label: "mistral",
        url: "https://api.mistral.ai/v1/chat/completions",
        model: Deno.env.get("MISTRAL_MODEL") ?? "mistral-medium-3-5-128b",
        fallbackModels: ["open-mistral-7b"],
        keyEnv: "MISTRAL_API_KEY",
        inputPerM: 0.40,
        outputPerM: 2.00,
        supportsTools: true,
    },
    openrouter: {
        label: "openrouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        model: Deno.env.get("OPENROUTER_MODEL") ?? "nvidia/nemotron-3-super-120b-a12b:free",
        fallbackModels: ["nvidia/nemotron-3-ultra-550b-a55b:free"],
        keyEnv: "OPENROUTER_API_KEY",
        inputPerM: 0,
        outputPerM: 0,
        supportsTools: true,
    },
    xai: {
        label: "xai",
        url: "https://api.x.ai/v1/chat/completions",
        model: Deno.env.get("XAI_MODEL") ?? "grok-3-mini",
        fallbackModels: ["grok-2-1212"],
        keyEnv: "XAI_API_KEY",
        inputPerM: 0.30,
        outputPerM: 0.50,
        supportsTools: true,
    },
};

const DEFAULT_DAILY_BUDGET_USD = 0.80;
const DEFAULT_FALLBACK_PROVIDERS = "cerebras,gemini";

// Re-exported for callers that already import it from here. The definition
// lives in ./ai_model.ts so the six direct callers can take the string without
// bundling this entire gateway.
export { GROQ_CHAT_MODEL } from "./ai_model.ts";

/** A provider error that means "this model is gone", not "bad request". */
function isModelGone(status: number, body: string): boolean {
    // Groq answers a retired/entitlement-gated id with a clean 404
    // model_not_found. Other providers in the chain use 400/403 for the same
    // condition, so accept those too — the body text is what disambiguates.
    if (status !== 400 && status !== 403 && status !== 404) return false;
    const b = body.toLowerCase();
    return b.includes("model_not_found") ||
        b.includes("does not exist") ||
        b.includes("decommission") ||
        b.includes("no longer available") ||
        b.includes("no longer supported") ||
        b.includes("unknown model") ||
        b.includes("invalid model") ||
        b.includes("not authorized to use");
}

/**
 * File ONE durable alert that the configured model has been retired. Deduped on
 * an unresolved alert for the same provider+model so a 5-minute sweep can't spam
 * the inbox. Best-effort: alerting must never be the reason a chat call fails.
 */
async function alertModelGone(
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
                ? `${provider}'s "${model}" no longer exists. Still answering on "${servedBy}", but update the model/provider default before that fallback goes too.`
                : `${provider}'s "${model}" no longer exists and every fallback also failed. G's departments are offline until this is changed.`,
            p_severity: servedBy ? "HIGH" : "CRITICAL",
            p_details: { provider, model, served_by: servedBy, gateway: LLM_GATEWAY_VERSION },
        });
    } catch { /* never let alerting break the call path */ }
}

/**
 * Alert that an entire provider was skipped over — a different failure from a
 * retired model, and the one a model-level fallback cannot fix (revoked key,
 * daily cap, provider outage). Reuses the same dedup shape.
 */
async function alertProviderFailover(
    supabase: any, from: string, to: string, detail: string,
): Promise<void> {
    try {
        const { data: open } = await supabase
            .from("system_alerts")
            .select("id")
            .eq("type", "G_LLM_PROVIDER_FAILOVER")
            .is("resolved_at", null)
            .contains("details", { from_provider: from })
            .maybeSingle();
        if (open) return;

        await supabase.rpc("raise_admin_alert", {
            p_type: "G_LLM_PROVIDER_FAILOVER",
            p_title: `LLM provider failover: ${from} → ${to}`,
            p_body: `Every model on "${from}" failed, so G is answering on "${to}". ` +
                `This is not a model retirement — check the ${from} key, its daily cap, and provider status.`,
            p_severity: "HIGH",
            p_details: {
                from_provider: from,
                to_provider: to,
                detail: detail.slice(0, 500),
                gateway: LLM_GATEWAY_VERSION,
            },
        });
    } catch { /* never let alerting break the call path */ }
}

function primaryProviderName(): string {
    const name = (Deno.env.get("G_LLM_PROVIDER") ?? "groq").toLowerCase();
    return name in PROVIDERS ? name : "groq";
}

/**
 * Ordered provider chain: primary first, then each configured fallback that
 * actually has a key. An unkeyed fallback is a no-op, not an error — that is
 * what makes arming one a pure secret change.
 */
function providerChain(): ProviderSpec[] {
    const names = [
        primaryProviderName(),
        ...(Deno.env.get("G_LLM_FALLBACKS") ?? DEFAULT_FALLBACK_PROVIDERS)
            .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    ];

    const seen = new Set<string>();
    const chain: ProviderSpec[] = [];
    for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        const spec = PROVIDERS[name];
        if (!spec || !Deno.env.get(spec.keyEnv)) continue;
        chain.push(spec);
    }
    return chain;
}

export function llmConfigured(): boolean {
    return providerChain().length > 0;
}

/**
 * What THIS deployed bundle is actually running. Because every edge function
 * carries its own copy of this file, comparing this across functions is the only
 * reliable way to prove they are in sync — assuming propagation is what let a
 * retired model survive in three functions after being fixed in three others.
 * Deliberately makes no network call, so it is free to poll.
 */
export function llmGatewayInfo(): Record<string, unknown> {
    const chain = providerChain();
    const primary = PROVIDERS[primaryProviderName()];
    return {
        gateway_version: LLM_GATEWAY_VERSION,
        provider: primaryProviderName(),
        model: primary.model,
        fallback_models: primary.fallbackModels,
        key_configured: Boolean(Deno.env.get(primary.keyEnv)),
        // The chain is what actually protects us — an empty tail means the
        // primary is a single point of failure no matter how many models it lists.
        provider_chain: chain.map((p) => p.label),
        provider_fallbacks_armed: Math.max(chain.length - 1, 0),
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
    const chain = providerChain();
    if (chain.length === 0) {
        throw new Error(`LLM key ${PROVIDERS[primaryProviderName()].keyEnv} not configured`);
    }

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

    const backoffs = [3000, 8000, 16000];
    let lastErr = "";

    for (let p = 0; p < chain.length; p++) {
        const provider = chain[p];
        const apiKey = Deno.env.get(provider.keyEnv)!;

        // GPT-OSS models spend completion_tokens on a hidden chain-of-thought
        // before the visible answer — a low max_tokens budget gets entirely
        // consumed by reasoning, returning empty content with a 200 (confirmed
        // live 2026-08-17: reasoning_tokens 254/256, finish_reason "length").
        // Floor raised gateway-wide so no caller can under-budget this away, and
        // reasoning_effort turned down for GPT-OSS specifically so more of the
        // budget lands in the actual answer.
        const body: Record<string, unknown> = {
            model: provider.model,
            max_tokens: Math.min(Math.max(opts.maxTokens ?? 2048, 512), 4096),
            temperature: opts.temperature ?? 0.3,
            messages: [
                ...(opts.system ? [{ role: "system", content: opts.system }] : []),
                ...opts.messages,
            ],
        };
        if (opts.tools?.length && provider.supportsTools) {
            body.tools = opts.tools;
            body.tool_choice = opts.toolChoice ?? "auto";
        }

        // Try this provider's configured model, then each of its fallbacks. A
        // retired model must cost us one failed request, not three weeks of
        // silence — on 2026-08-16 the default here was retired by Groq and every
        // department 404'd daily until 2026-09-05 without anything degrading,
        // retrying, or alerting.
        const candidates = [provider.model, ...provider.fallbackModels];

        for (let c = 0; c < candidates.length; c++) {
            const model = candidates[c];
            body.model = model;
            // reasoning_effort is a GPT-OSS-only parameter; a fallback to a
            // non-GPT-OSS model must not carry it or the request is rejected.
            if (isGptOss(model)) body.reasoning_effort = "low";
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
                        lastErr = `${provider.label} ${res.status}: ${await res.text()}`;
                        await new Promise((r) => setTimeout(r, backoffs[attempt]));
                        continue;
                    }

                    if (!res.ok) {
                        const text = await res.text();
                        lastErr = `${provider.label} ${res.status}: ${text}`;
                        // Model retired — no amount of retrying fixes it. Move on
                        // to this provider's next model.
                        if (isModelGone(res.status, text)) {
                            modelGone = true;
                            break;
                        }
                        // Any other 4xx (bad key, malformed request) will not be
                        // fixed by another model on this provider either — hand
                        // off to the next provider in the chain.
                        break;
                    }

                    const json = await res.json();
                    const usage = json.usage ?? {};
                    const promptTokens = Number(usage.prompt_tokens ?? 0);
                    const completionTokens = Number(usage.completion_tokens ?? 0);
                    const cost = (promptTokens * provider.inputPerM +
                        completionTokens * provider.outputPerM) / 1_000_000;
                    await supabase.rpc("g_add_llm_usage", {
                        p_department: opts.department,
                        p_prompt: promptTokens,
                        p_completion: completionTokens,
                        p_cost: cost,
                    }).then(null, () => null);

                    // Served by a fallback model: still answer, but make the
                    // retirement loudly visible so the default gets updated.
                    if (c > 0) await alertModelGone(supabase, provider.label, provider.model, model);
                    // Served by a fallback PROVIDER: a louder, different problem
                    // — the primary is failing for a reason no model swap fixes.
                    if (p > 0) await alertProviderFailover(supabase, chain[0].label, provider.label, lastErr);

                    json._g_provider = provider.label;
                    json._g_model = model;
                    return json;
                } catch (err) {
                    // Network failure or the 30s abort. Retry within this model,
                    // then let the loops carry us onward.
                    lastErr = `${provider.label} fetch failed: ${(err as Error).message}`;
                    if (attempt < backoffs.length - 1) {
                        await new Promise((r) => setTimeout(r, backoffs[attempt]));
                        continue;
                    }
                } finally {
                    clearTimeout(timer);
                }
            }

            // A non-model failure (bad key, 429 after backoff, network) won't
            // be fixed by another model on this provider — stop burning its
            // model list and hand off to the next provider in the chain.
            if (!modelGone) break;
        }

        if (p === chain.length - 1) {
            // End of the chain with nothing served. This is the state that took
            // G offline for three weeks — alert before throwing, never silent.
            await alertModelGone(supabase, provider.label, provider.model, null);
        }
    }

    if (/ 429:/.test(lastErr)) throw new RateLimitedError(lastErr);
    throw new Error(`LLM unavailable — every provider in the chain failed (${lastErr})`);
}
