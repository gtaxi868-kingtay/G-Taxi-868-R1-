// supabase/functions/_shared/embeddings.ts
// Provider-agnostic embedding gateway for G's memory (g_memory.embedding).
//
// Mirrors _shared/llm.ts's provider-selection shape on purpose — same
// bundling caveat applies (each edge function carries its own copy at
// deploy time; see LLM_GATEWAY_VERSION in llm.ts for why that matters).
//
// The one rule this file exists to enforce: NEVER fabricate a vector.
// supabase/functions/update_user_memory/index.ts computed its "embedding" as
// a SHA-256 hash of the text sliced to 768 floats — a hash has no semantic
// geometry, so similarity search over it returns noise, and worse, a 32-byte
// digest sliced to 768 elements is only 32 real values, silently failing the
// column's vector(768) NOT NULL constraint on every insert (confirmed live:
// 0 working rows, ever). Every function here either returns a REAL vector
// from a real embedding model, or `null` — callers must write `embedding =
// NULL` on null and let g_memory_search's hybrid retrieval fall back to
// full-text. A null embedding is an honest "no vector yet"; there is no
// fallback path in this file that produces a fake one.

// deno-lint-ignore-file no-explicit-any

const EMBED_DIM = 768;

export interface EmbedResult {
    /** Exactly EMBED_DIM floats, or null if every provider failed/unconfigured. */
    vector: number[] | null;
    model: string | null;
}

interface EmbeddingProviderSpec {
    name: string;
    keyEnv: string;
    embed: (text: string, apiKey: string) => Promise<{ vector: number[]; costUsd: number; model: string }>;
}

async function embedGemini(text: string, apiKey: string) {
    const model = "text-embedding-004";
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
        },
    );
    if (!res.ok) throw new Error(`Gemini embed error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const vector = json?.embedding?.values;
    if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
        throw new Error(`Gemini returned ${Array.isArray(vector) ? vector.length : typeof vector} dims, expected ${EMBED_DIM}`);
    }
    return { vector, costUsd: 0, model }; // Gemini's embedding tier is free as of writing
}

async function embedOpenAI(text: string, apiKey: string) {
    const model = "text-embedding-3-small";
    const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: text, dimensions: EMBED_DIM }),
    });
    if (!res.ok) throw new Error(`OpenAI embed error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const vector = json?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
        throw new Error(`OpenAI returned ${Array.isArray(vector) ? vector.length : typeof vector} dims, expected ${EMBED_DIM}`);
    }
    // $0.02 per 1M tokens; usage.total_tokens if present, else a rough estimate.
    const tokens = Number(json?.usage?.total_tokens ?? Math.ceil(text.length / 4));
    return { vector, costUsd: (tokens * 0.02) / 1_000_000, model };
}

// Order matters: Gemini first (free tier, key already used elsewhere in this
// codebase by identify_product/vision_pickup), OpenAI as the paid fallback.
const PROVIDERS: EmbeddingProviderSpec[] = [
    { name: "gemini", keyEnv: "GEMINI_API_KEY", embed: embedGemini },
    { name: "openai", keyEnv: "OPENAI_API_KEY", embed: embedOpenAI },
];

export function embeddingsConfigured(): boolean {
    return PROVIDERS.some((p) => Boolean(Deno.env.get(p.keyEnv)));
}

let consecutiveFailures = 0;

/**
 * Embeds one piece of text. Tries each configured provider in order; on
 * total failure across all of them, alerts (deduped, at most every few
 * failures) and returns { vector: null, model: null } — callers must treat
 * that as "write with embedding = NULL," never retry with a fake vector.
 */
export async function embedText(supabase: any, text: string, purpose: string): Promise<EmbedResult> {
    const trimmed = text.trim().slice(0, 8000); // generous cap; g_memory bodies are already ≤1500 chars
    if (!trimmed) return { vector: null, model: null };

    for (const provider of PROVIDERS) {
        const apiKey = Deno.env.get(provider.keyEnv);
        if (!apiKey) continue;
        try {
            const { vector, costUsd, model } = await provider.embed(trimmed, apiKey);
            consecutiveFailures = 0;
            await supabase.rpc("g_add_llm_usage", {
                p_department: "embeddings",
                p_prompt: 0,
                p_completion: 0,
                p_cost: costUsd,
            }).then(null, () => null);
            return { vector, model: `${provider.name}/${model}` };
        } catch (err) {
            console.error(`[embeddings:${provider.name}]`, err instanceof Error ? err.message : String(err));
            // fall through to the next provider
        }
    }

    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
        consecutiveFailures = 0; // reset so this doesn't fire every single call once broken
        await supabase.rpc("raise_admin_alert", {
            p_type: "G_MEMORY_EMBEDDING_DOWN",
            p_title: "G's memory embedding provider is down",
            p_body: `Every configured embedding provider (${PROVIDERS.map((p) => p.name).join(", ")}) has failed 3 times in a row for "${purpose}". Memory writes are proceeding with embedding = NULL (full-text search still works; semantic search does not until this is fixed).`,
            p_severity: "WARNING",
            p_details: { purpose, providers_tried: PROVIDERS.map((p) => p.name) },
        }).then(null, () => null);
    }
    return { vector: null, model: null };
}
