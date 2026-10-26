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

export function planPickup(ride: WaitingRide, flight: FlightStatus): PickupPlan {
    if (flight.cancelled) return { action: "flag", reason: "cancelled" };
    if (flight.diverted) return { action: "flag", reason: "diverted" };
    const next = pickupTimeFor(flight);
    if (!next) return { action: "keep" };
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

export async function refreshFlightPickups(supabase: any): Promise<Record<string, unknown>> {
    const now = Date.now();
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

    let moved = 0, flagged = 0, checked = 0;
    const errors: string[] = [];
    for (const [key, group] of groups) {
        const [flightNumber, flightDate, airport] = key.split("|");
        const res = await fetchFlightStatus(flightNumber, flightDate, airport);
        if (!res.configured) return { success: true, configured: false, waiting_rides: rides?.length ?? 0 };
        if (!res.flight) { errors.push(`${flightNumber}: ${res.error || "not found"}`); continue; }
        checked++;
        await cacheFlight(supabase, res.flight);

        for (const ride of group) {
            const plan = planPickup(ride, res.flight);
            const meta: Record<string, any> = {
                ...(ride.metadata || {}),
                flight_status: res.flight.status,
                flight_eta: res.flight.actual_in || res.flight.estimated_in || res.flight.scheduled_in,
                flight_gate: res.flight.gate,
                flight_checked_at: new Date().toISOString(),
            };
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
    return { success: true, configured: true, waiting_rides: rides?.length ?? 0, flights_checked: checked, moved, flagged, errors };
}
