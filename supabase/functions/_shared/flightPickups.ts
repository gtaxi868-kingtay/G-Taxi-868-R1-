// Keeps flight-anchored airport pickups on time: refreshes each waiting
// flight from FlightAware and moves the pickup when the arrival moves.
// Called by sync_flight_availability in mode "refresh_flight_pickups" (cron,
// every 10 minutes) and reused by the merchant function when a hotel books.
import { fetchFlightStatus, pickupTimeFor, type FlightStatus } from "./flightaware.ts";

// Small changes are noise; only move a pickup by 5+ minutes.
const MOVE_THRESHOLD_MS = 5 * 60_000;

export type WaitingRide = {
    id: string;
    scheduled_for: string | null;
    metadata: Record<string, any> | null;
};

export type PickupPlan =
    | { action: "keep" }
    | { action: "move"; scheduled_for: string }
    | { action: "flag"; reason: "cancelled" | "diverted" };

// Cost guard (AeroAPI bills per query). A flight is only re-fetched when a
// pickup actually depends on it:
//  - pickup more than 6 h away: at most once an hour;
//  - within 6 h: every run (10 minutes);
//  - already landed and fetched after landing: never again.
export function shouldRefresh(
    cached: { fetched_at: string | null; actual_in: string | null } | null,
    earliestPickup: number,
    now = Date.now(),
): boolean {
    if (!cached?.fetched_at) return true;
    const fetched = new Date(cached.fetched_at).getTime();
    if (cached.actual_in && fetched > new Date(cached.actual_in).getTime()) return false;
    if (earliestPickup - now > 6 * 3_600_000) return now - fetched >= 3_600_000;
    return true;
}

// Flight data counts as stale when nothing fresh came back for 30+ minutes
// and the pickup is within the hour: drivers must check before trusting it.
export function isStale(lastChecked: string | null | undefined, pickupAt: string | null, now = Date.now()): boolean {
    if (!pickupAt) return false;
    const pickup = new Date(pickupAt).getTime();
    if (pickup - now > 3_600_000) return false;
    const checked = lastChecked ? new Date(lastChecked).getTime() : 0;
    return now - checked > 30 * 60_000;
}

export function planPickup(ride: WaitingRide, flight: FlightStatus, now = Date.now()): PickupPlan {
    if (flight.cancelled) return { action: "flag", reason: "cancelled" };
    if (flight.diverted) return { action: "flag", reason: "diverted" };
    let next = pickupTimeFor(flight);
    if (!next) return { action: "keep" };
    // Landed so early that the guest is already out: send the car now rather
    // than at a time in the past.
    if (new Date(next).getTime() < now) next = new Date(now).toISOString();
    const current = ride.scheduled_for ? new Date(ride.scheduled_for).getTime() : NaN;
    if (Number.isFinite(current) && Math.abs(new Date(next).getTime() - current) < MOVE_THRESHOLD_MS) return { action: "keep" };
    return { action: "move", scheduled_for: next };
}

export async function cacheFlight(supabase: any, f: FlightStatus): Promise<void> {
    await supabase.from("airline_flights").upsert({
        flight_number: f.ident,
        flight_date: f.flight_date,
        origin: f.origin,
        destination: f.destination,
        status: f.status,
        scheduled_in: f.scheduled_in,
        estimated_in: f.estimated_in,
        actual_in: f.actual_in,
        eta: f.actual_in || f.estimated_in || f.scheduled_in,
        gate: f.gate,
        cancelled: f.cancelled,
        diverted: f.diverted,
        fetched_at: new Date().toISOString(),
    }, { onConflict: "flight_number,flight_date" });
}

export async function refreshFlightPickups(supabase: any, now = Date.now()): Promise<Record<string, unknown>> {
    const { data: rides, error } = await supabase
        .from("rides")
        .select("id, scheduled_for, metadata")
        .eq("status", "scheduled")
        .not("metadata->>flight_number", "is", null)
        .gte("scheduled_for", new Date(now - 2 * 3_600_000).toISOString())
        .lte("scheduled_for", new Date(now + 18 * 3_600_000).toISOString());
    if (error) throw error;

    // One AeroAPI query per flight, however many guests are on it.
    const groups = new Map<string, WaitingRide[]>();
    for (const r of (rides || []) as WaitingRide[]) {
        const m = r.metadata || {};
        const key = `${m.flight_number}|${m.flight_date}|${m.airport}`;
        groups.set(key, [...(groups.get(key) || []), r]);
    }

    let moved = 0, flagged = 0, checked = 0, skipped = 0, stale = 0;
    const errors: string[] = [];
    for (const [key, group] of groups) {
        const [flightNumber, flightDate, airport] = key.split("|");
        const earliest = Math.min(...group.map((r) => new Date(r.scheduled_for || 0).getTime()));
        const { data: cached } = await supabase.from("airline_flights").select("fetched_at, actual_in")
            .eq("flight_number", flightNumber).eq("flight_date", flightDate).maybeSingle();
        if (!shouldRefresh(cached, earliest, now)) { skipped++; continue; }

        const res = await fetchFlightStatus(flightNumber, flightDate, airport);
        if (!res.configured) return { success: true, configured: false, waiting_rides: rides?.length ?? 0 };
        if (!res.flight) {
            errors.push(`${flightNumber}: ${res.error || "not found"}`);
            // No fresh data: flag pickups that are close and haven't been
            // confirmed for 30+ minutes, instead of silently trusting old data.
            for (const ride of group) {
                if (isStale(ride.metadata?.flight_checked_at, ride.scheduled_for, now) && ride.metadata?.flight_problem !== "stale") {
                    await supabase.from("rides").update({ metadata: { ...(ride.metadata || {}), flight_problem: "stale" } })
                        .eq("id", ride.id).eq("status", "scheduled");
                    stale++;
                }
            }
            continue;
        }
        checked++;
        await cacheFlight(supabase, res.flight);

        for (const ride of group) {
            const plan = planPickup(ride, res.flight, now);
            const meta: Record<string, any> = {
                ...(ride.metadata || {}),
                flight_status: res.flight.status,
                flight_eta: res.flight.actual_in || res.flight.estimated_in || res.flight.scheduled_in,
                flight_gate: res.flight.gate,
                flight_checked_at: new Date().toISOString(),
            };
            // Fresh data clears a stale flag (cancelled/diverted stay until the hotel acts).
            if (meta.flight_problem === "stale") delete meta.flight_problem;
            if (plan.action === "move") {
                meta.pickup_moved_from = ride.scheduled_for;
                await supabase.from("rides").update({ scheduled_for: plan.scheduled_for, metadata: meta })
                    .eq("id", ride.id).eq("status", "scheduled");
                moved++;
            } else if (plan.action === "flag") {
                // A cancelled or diverted flight is the hotel's call (rebook or
                // cancel), never an automatic cancel: the guest may still come.
                meta.flight_problem = plan.reason;
                await supabase.from("rides").update({ metadata: meta }).eq("id", ride.id).eq("status", "scheduled");
                flagged++;
            } else {
                await supabase.from("rides").update({ metadata: meta }).eq("id", ride.id).eq("status", "scheduled");
            }
        }
    }
    // configured = the FlightAware key exists, not merely "nothing failed".
    return { success: true, configured: !!Deno.env.get("FLIGHTAWARE_AEROAPI_KEY"), waiting_rides: rides?.length ?? 0, flights_checked: checked, flights_skipped_cost_guard: skipped, moved, flagged, stale, errors };
}
