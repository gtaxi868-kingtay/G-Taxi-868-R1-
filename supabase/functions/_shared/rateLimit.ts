// Deliberately NOT importing SupabaseClient from a pinned supabase-js.
//
// This module used `SupabaseClient` from supabase-js@2.45.0, but 65 of the
// edge functions import bare `supabase-js@2` (which resolves to the latest
// 2.x) while only 26 pin 2.45.0. Two copies of the library produce two
// structurally-incompatible SupabaseClient types, so every bare-@2 function
// that called checkRateLimit failed to typecheck:
//
//   TS2345: Argument of type 'SupabaseClient<any, "public", any>' is not
//   assignable to parameter of type 'SupabaseClient<unknown, never, ...>'
//
// checkRateLimit only ever calls `.rpc()`. Typing that one method
// structurally accepts a client from ANY supabase-js version and cannot
// drift again when a function bumps its pin.
type RpcCapableClient = {
    rpc(
        fn: string,
        params?: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
}

// Rate limit configs per endpoint
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
    create_ride: { maxRequests: 5, windowSeconds: 60 },
    estimate_fare: { maxRequests: 30, windowSeconds: 60 },
    match_driver: { maxRequests: 10, windowSeconds: 60 },
    accept_ride: { maxRequests: 10, windowSeconds: 60 },
    cancel_ride: { maxRequests: 5, windowSeconds: 300 },
    complete_ride: { maxRequests: 5, windowSeconds: 60 },
    create_payment_intent: { maxRequests: 5, windowSeconds: 60 },
    update_driver_location: { maxRequests: 60, windowSeconds: 60 },
    geocode: { maxRequests: 20, windowSeconds: 60 },
    parse_natural_language: { maxRequests: 10, windowSeconds: 60 },
    mirror_ride: { maxRequests: 10, windowSeconds: 60 },
    nfc_event_handler: { maxRequests: 10, windowSeconds: 60 },
    nfc_restore_session: { maxRequests: 5, windowSeconds: 300 },
    send_push_notification: { maxRequests: 30, windowSeconds: 60 },
    update_ride_status: { maxRequests: 10, windowSeconds: 60 },
    merchant_gateway: { maxRequests: 30, windowSeconds: 60 },
    merchant_order_picker: { maxRequests: 20, windowSeconds: 60 },
    merchant_update_order_status: { maxRequests: 10, windowSeconds: 60 },
    create_wallet_topup: { maxRequests: 5, windowSeconds: 60 },
    // Failed-auth limiter for the unauthenticated B2B endpoint: without this,
    // an endpoint with no config silently returns { allowed: true } and the
    // API-key space is brute-forceable for free.
    merchant_gateway_auth: { maxRequests: 10, windowSeconds: 60 },
    // Was being called with a key that had no config, i.e. no limit at all.
    grocery_create_payment_intent: { maxRequests: 5, windowSeconds: 60 },
    handle_voice: { maxRequests: 20, windowSeconds: 60 },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * check_rate_limit(p_user_id uuid, ...) requires a real UUID, but callers pass
 * composite keys like `merchant_<id>` and `gw_ip_<addr>`. Postgres rejected those,
 * the RPC returned an error, and checkRateLimit fell into its fail-closed branch --
 * which every bare `await checkRateLimit(...)` call site then discarded. Net effect:
 * those endpoints had NO rate limiting at all.
 *
 * Derive a stable v4-shaped UUID from any string so composite keys work; a key that
 * already is a UUID passes through untouched.
 */
async function toUuidKey(key: string): Promise<string> {
    if (UUID_RE.test(key)) return key;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const b = new Uint8Array(buf).slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const h = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export async function checkRateLimit(
    adminClient: RpcCapableClient,
    userId: string,
    endpoint: string
): Promise<{ allowed: boolean; error?: string }> {
    const config = RATE_LIMITS[endpoint];
    if (!config) return { allowed: true }; // No config = no limit

    const { data, error } = await adminClient.rpc("check_rate_limit", {
        p_user_id: await toUuidKey(userId),
        p_endpoint: endpoint,
        p_max_requests: config.maxRequests,
        p_window_seconds: config.windowSeconds,
    });

    if (error) {
        console.error("[RateLimit] check failed:", error.message);
        return { allowed: false, error: "Rate limit unavailable. Try again." };
    }

    if (!data) {
        return {
            allowed: false,
            error: `Rate limit exceeded for ${endpoint}. Please wait before retrying.`
        };
    }

    return { allowed: true };
}

/**
 * Enforcing wrapper around checkRateLimit.
 *
 * checkRateLimit RETURNS { allowed, error } — it does not throw. Six call sites
 * were written as bare `await checkRateLimit(...)`, discarding the result, so the
 * limit was computed and then ignored: no limiting at all. Any endpoint whose key
 * is missing from RATE_LIMITS is likewise unlimited, because `!config` short
 * circuits to { allowed: true }.
 *
 * This throws a ready-to-return 429 Response instead, so forgetting to inspect the
 * result fails closed rather than open. Callers should `if (e instanceof Response)
 * return e;` in their catch, which is the same convention _shared/auth.ts uses.
 */
export async function enforceRateLimit(
    adminClient: RpcCapableClient,
    userId: string,
    endpoint: string,
    corsHeaders: Record<string, string> = {}
): Promise<void> {
    if (!RATE_LIMITS[endpoint]) {
        // Loud, because a typo'd key silently disables the limiter.
        console.warn(`[RateLimit] no config for "${endpoint}" — request NOT limited`);
    }
    const result = await checkRateLimit(adminClient, userId, endpoint);
    if (!result.allowed) {
        throw new Response(
            JSON.stringify({ success: false, error: result.error ?? "Rate limit exceeded" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}
