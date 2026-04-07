const UPSTASH_REDIS_REST_URL = Deno.env.get("UPSTASH_REDIS_REST_URL")!;
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!;

export async function redisCommand(command: string[]) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
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
 */
export async function updateRedisLocation(driverId: string, lat: number, lng: number, heading: number = 0) {
    const member = JSON.stringify({ id: driverId, h: heading });
    
    // 1. Add to the geohash index for nearby searches
    // Syntax: GEOADD key longitude latitude member
    await redisCommand(["GEOADD", "active_drivers", lng.toString(), lat.toString(), driverId]);
    
    // 2. Set an expiration key for the driver so they disappear if inactive for 60s
    // Syntax: SETEX key seconds value
    await redisCommand(["SETEX", `driver_online:${driverId}`, "60", "1"]);
}
