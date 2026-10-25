// "Your usual next trip": the place this rider most often rides to at this
// time of day, offered as a one-tap chip on Home (founder: the app should feel
// like it knows you). Hidden when there is no real habit yet; never guessed.
export type PastRide = {
    created_at: string;
    status: string;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
    dropoff_address: string | null;
};

export type UsualTrip = { address: string; lat: number; lng: number; count: number };

const DONE = new Set(['completed', 'payment_confirmed', 'closed']);
const MIN_TRIPS = 2;          // one trip is not a habit
const WINDOW_HOURS = 2;       // "this time of day" = within 2 h either side
const CELL = 0.0015;          // ~150 m: drop-offs this close are the same place

function hourDistance(a: number, b: number): number {
    const d = Math.abs(a - b) % 24;
    return Math.min(d, 24 - d);
}

export function usualTrip(rides: PastRide[], now: Date = new Date()): UsualTrip | null {
    const hour = now.getHours() + now.getMinutes() / 60;
    const groups = new Map<string, { lat: number; lng: number; address: string; count: number; last: number }>();

    for (const r of rides || []) {
        if (!DONE.has(r.status)) continue;
        if (!Number.isFinite(r.dropoff_lat as number) || !Number.isFinite(r.dropoff_lng as number)) continue;
        const t = new Date(r.created_at);
        if (Number.isNaN(t.getTime())) continue;
        if (hourDistance(t.getHours() + t.getMinutes() / 60, hour) > WINDOW_HOURS) continue;

        const lat = r.dropoff_lat as number, lng = r.dropoff_lng as number;
        const key = `${Math.round(lat / CELL)}:${Math.round(lng / CELL)}`;
        const g = groups.get(key);
        if (g) {
            g.count += 1;
            // Name the place after the most recent trip there.
            if (t.getTime() > g.last) { g.last = t.getTime(); g.address = r.dropoff_address || g.address; g.lat = lat; g.lng = lng; }
        } else {
            groups.set(key, { lat, lng, address: r.dropoff_address || 'Your usual spot', count: 1, last: t.getTime() });
        }
    }

    let best: { lat: number; lng: number; address: string; count: number; last: number } | null = null;
    for (const g of groups.values()) {
        if (g.count < MIN_TRIPS) continue;
        if (!best || g.count > best.count || (g.count === best.count && g.last > best.last)) best = g;
    }
    return best ? { address: best.address, lat: best.lat, lng: best.lng, count: best.count } : null;
}
