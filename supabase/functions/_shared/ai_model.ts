// supabase/functions/_shared/ai_model.ts
// The one place the Groq chat model id is written down.
//
// Six edge functions call Groq's REST endpoint directly instead of going
// through the gateway in _shared/llm.ts: parse_natural_language, handle_voice,
// daily_push_notifications, ai_concierge_proactive, generate_ai_greeting,
// ai_suggest_stops. Each used to hardcode the model as a string literal, which
// is why fixing the gateway on 2026-08-17 did not bring them back — and why
// handle_voice and generate_ai_greeting were still serving the retired
// llama-3.3-70b-versatile in production on 2026-09-06.
//
// Deliberately kept tiny and dependency-free rather than exporting this from
// llm.ts: every edge function bundles its own copy of whatever it imports, and
// those six do not need a 500-line gateway in their bundle to learn a string.
// llm.ts imports THIS, so there is still exactly one source of truth.

/**
 * Current Groq free-tier chat model.
 *
 * NOT llama-3.3-70b-versatile. That id is still listed in Groq's docs but now
 * reads "Enterprise" with price and rate limits both "Contact Sales" — it moved
 * off the free developer plan, so a free-tier key gets a 404 on a model that is
 * still publicly documented. "Does the id still exist" is the wrong test; ask
 * whether it still has developer-plan rate limits.
 *
 * Override with the GROQ_MODEL secret to change every caller at once, no deploy.
 */
export const GROQ_CHAT_MODEL: string =
    Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";

/**
 * GPT-OSS models spend completion_tokens on a hidden chain-of-thought before
 * the visible answer, so a tight max_tokens budget is consumed entirely by
 * reasoning and returns empty content with a 200 (measured 2026-08-17:
 * reasoning_tokens 254 of 256, finish_reason "length"). Callers must give these
 * models room and turn reasoning_effort down.
 */
export function isGptOss(model: string): boolean {
    return model.startsWith("openai/gpt-oss") || model.startsWith("gpt-oss");
}
