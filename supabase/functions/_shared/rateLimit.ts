import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
