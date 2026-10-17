import { PRICING } from "./pricing.ts";

// Grocery delivery fee, priced like a regular Standard ride from the store
// to the delivery point (founder decision, 2026-10-16): base + per-km +
// per-minute from live pricing_config, never below the minimum fare.
// No surge and no vehicle multiplier. Distance/time come from Mapbox
// driving directions; if Mapbox is unavailable, the same fallback
// estimate_fare uses (straight line x 1.3, ~30 km/h).

export interface DeliveryQuote {
    fee_cents: number;
    distance_meters: number;
    duration_seconds: number;
    source: "mapbox" | "estimate";
}

async function routeMetrics(
    fromLat: number, fromLng: number, toLat: number, toLng: number,
): Promise<{ distanceMeters: number; durationSeconds: number; source: "mapbox" | "estimate" }> {
    const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") || Deno.env.get("MAPBOX_PUBLIC_TOKEN");
    if (token) {
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?access_token=${token}`;
            const ac = new AbortController();
            const timeout = setTimeout(() => ac.abort(), 10000);
            const response = await fetch(url, { signal: ac.signal });
            clearTimeout(timeout);
            const data = await response.json();
            if (data.routes && data.routes.length > 0) {
                return {
                    distanceMeters: Math.round(data.routes[0].distance),
                    durationSeconds: Math.round(data.routes[0].duration),
                    source: "mapbox",
                };
            }
        } catch {
            // fall through to the estimate
        }
    }

    const R = 6371000;
    const dLat = (toLat - fromLat) * Math.PI / 180;
    const dLng = (toLng - fromLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const distanceMeters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3);
    return { distanceMeters, durationSeconds: Math.round(distanceMeters / 8.33), source: "estimate" };
}

export async function quoteDeliveryFee(
    adminClient: { from: (t: string) => any },
    store: { lat: number; lng: number },
    dropoff: { lat: number; lng: number },
): Promise<DeliveryQuote> {
    const { data: rows } = await adminClient
        .from("pricing_config")
        .select("key, value_cents")
        .in("key", ["BASE_FARE_CENTS", "PER_KM_CENTS", "PER_MIN_CENTS", "MIN_FARE_CENTS"])
        .then((res: any) => res, () => ({ data: null }));

    const cfg: Record<string, number> = {};
    for (const row of (rows ?? []) as Array<{ key: string; value_cents: number }>) cfg[row.key] = row.value_cents;

    const base = cfg["BASE_FARE_CENTS"] ?? PRICING.BASE_FARE_CENTS;
    const perKm = cfg["PER_KM_CENTS"] ?? PRICING.PER_KM_CENTS;
    const perMin = cfg["PER_MIN_CENTS"] ?? PRICING.PER_MIN_CENTS;
    const minFare = cfg["MIN_FARE_CENTS"] ?? PRICING.MIN_FARE_CENTS;

    const route = await routeMetrics(store.lat, store.lng, dropoff.lat, dropoff.lng);
    const raw = base +
        Math.round((route.distanceMeters / 1000) * perKm) +
        Math.round((route.durationSeconds / 60) * perMin);

    return {
        fee_cents: Math.max(raw, minFare),
        distance_meters: route.distanceMeters,
        duration_seconds: route.durationSeconds,
        source: route.source,
    };
}
