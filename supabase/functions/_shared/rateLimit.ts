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
};

export async function checkRateLimit(
    adminClient: RpcCapableClient,
    userId: string,
    endpoint: string
): Promise<{ allowed: boolean; error?: string }> {
    const config = RATE_LIMITS[endpoint];
    if (!config) return { allowed: true }; // No config = no limit

    const { data, error } = await adminClient.rpc("check_rate_limit", {
        p_user_id: userId,
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
