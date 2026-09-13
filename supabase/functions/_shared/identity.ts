// supabase/functions/_shared/identity.ts
// Single source of truth for "what business is G," read from g_config.
//
// Before this file existed, five separate edge functions each hardcoded their
// own prose description of the platform — same wording drift risk as
// _shared/llm.ts's per-function bundling problem that caused the 2026-08-16
// outage. Update the description in g_config once; every function picks it up
// on its next request, with no redeploy needed.
//
// Like every _shared/*.ts file, this gets bundled into each consuming
// function at deploy time — it is NOT a live shared module. A change here
// still requires redeploying every consumer to take effect in their code path,
// but the platform FACTS themselves (name, market, verticals) no longer live
// in that bundled code at all, so THOSE update everywhere the instant the
// g_config row changes, with zero redeploy.

// deno-lint-ignore-file no-explicit-any

export interface PlatformIdentity {
    name: string;
    market: string;
    verticals: string[];
    /** One sentence, safe to drop straight into a system prompt. */
    description: string;
}

const FALLBACK: PlatformIdentity = {
    name: "G-Taxi",
    market: "Trinidad & Tobago",
    verticals: ["rides", "grocery/merchant delivery", "G-Escape group travel", "a commander-run franchise grid"],
    description: "G-Taxi — a multi-vertical platform in Trinidad & Tobago (rides, grocery/merchant delivery, G-Escape group travel, a commander-run franchise grid)",
};

/**
 * Reads g_config.platform_identity. Falls back to a hardcoded copy (kept in
 * sync manually, same risk this file exists to reduce elsewhere) only if the
 * config row is ever missing or malformed — a prompt must never come back
 * empty just because a config read failed.
 */
export async function getPlatformIdentity(supabase: any): Promise<PlatformIdentity> {
    try {
        const { data } = await supabase
            .from("g_config").select("value").eq("key", "platform_identity").maybeSingle();
        const v = data?.value;
        if (v && typeof v.description === "string" && v.description.length > 0) {
            return {
                name: typeof v.name === "string" ? v.name : FALLBACK.name,
                market: typeof v.market === "string" ? v.market : FALLBACK.market,
                verticals: Array.isArray(v.verticals) ? v.verticals : FALLBACK.verticals,
                description: v.description,
            };
        }
    } catch { /* fall through to the fallback below */ }
    return FALLBACK;
}
