// supabase/functions/_shared/redis.ts
// Lazy-initializing Upstash Redis client — NO module-level env var reads.
// Prevents crashes when Redis env vars are unset (non-fatal degrade).

let _restUrl: string | null = null;
let _restToken: string | null = null;

function ensureRedisConfig(): void {
    if (_restUrl !== null) return; // already attempted
    _restUrl = Deno.env.get("UPSTASH_REDIS_REST_URL") || "";
    _restToken = Deno.env.get("UPSTASH_REDIS_REST_TOKEN") || "";
}

function isRedisConfigured(): boolean {
    ensureRedisConfig();
    return _restUrl !== "" && _restToken !== "";
}

export async function redisCommand(command: string[]) {
    if (!isRedisConfigured()) {
        console.warn("[Redis] Upstash env vars not configured — command skipped.");
        return null;
    }

    const response = await fetch(`${_restUrl}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${_restToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Upstash Redis Error: ${error}`);
    }

    return await response.json();
}

/**
 * Update driver location in Redis using GEOADD.
 * Also sets a TTL for the driver's online presence.
 * Gracefully no-ops if Redis is not configured.
 */
export async function updateRedisLocation(driverId: string, lat: number, lng: number, heading: number = 0) {
    if (!isRedisConfigured()) {
        console.warn("[Redis] Skipping location update — Redis not configured.");
        return;
    }

    const member = JSON.stringify({ id: driverId, h: heading });

    // 1. Add to the geohash index for nearby searches
    await redisCommand(["GEOADD", "active_drivers", lng.toString(), lat.toString(), driverId]);

    // 2. Set an expiration key for the driver so they disappear if inactive for 60s
    await redisCommand(["SETEX", `driver_online:${driverId}`, "60", "1"]);
}

/**
 * Check if Redis is available (for callers that want to gate behavior).
 */
export function isRedisReady(): boolean {
    return isRedisConfigured();
}
