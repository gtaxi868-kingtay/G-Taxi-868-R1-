import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
}

// Rate limit configs per endpoint
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
    create_ride: { maxRequests: 5, windowSeconds: 60 },  // 5 rides per minute
    estimate_fare: { maxRequests: 30, windowSeconds: 60 },  // 30 estimates per minute
    match_driver: { maxRequests: 10, windowSeconds: 60 },  // 10 dispatches per minute
    accept_ride: { maxRequests: 10, windowSeconds: 60 },  // 10 accepts per minute
    cancel_ride: { maxRequests: 5, windowSeconds: 300 },  // 5 cancels per 5 minutes
    complete_ride: { maxRequests: 5, windowSeconds: 60 },  // 5 completions per minute
    create_payment_intent: { maxRequests: 5, windowSeconds: 60 },  // 5 payment attempts per minute
    update_driver_location: { maxRequests: 60, windowSeconds: 60 },  // 1 per second max
    geocode: { maxRequests: 20, windowSeconds: 60 },  // 20 geocodes per minute
};

export async function checkRateLimit(
    adminClient: SupabaseClient,
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
        // If rate limit check fails, log and allow (fail open — don't block legit users)
        console.error("[RateLimit] check failed:", error.message);
        return { allowed: true };
    }

    if (!data) {
        return {
            allowed: false,
            error: `Rate limit exceeded for ${endpoint}. Please wait before retrying.`
        };
    }

    return { allowed: true };
}
