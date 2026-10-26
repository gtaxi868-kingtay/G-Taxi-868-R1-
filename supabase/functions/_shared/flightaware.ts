// Live flight status from FlightAware AeroAPI v4, for airport pickups that
// follow the real arrival time (founder chose AeroAPI, 2026-10-26).
//
// Secret: FLIGHTAWARE_AEROAPI_KEY (set in Supabase by the founder; never in
// code). Without it every lookup returns { configured: false } and callers
// fall back to the time the hotel typed in, so nothing breaks.
//
// AeroAPI is billed per query, so callers cache in airline_flights and only
// refresh flights that have a pickup waiting.
import { secureFetch } from "./networkUtility.ts";

const AEROAPI = "https://aeroapi.flightaware.com/aeroapi";

// The two kerbs G868 serves. Pickups are pre-booked at the Ground
// Transportation Center (where hotel shuttles legally wait), never the kerb.
export const AIRPORTS: Record<string, { name: string; lat: number; lng: number; pickupNote: string }> = {
    POS: { name: "Piarco International Airport", lat: 10.5954, lng: -61.3372, pickupNote: "Ground Transportation Center, Piarco" },
    TAB: { name: "ANR Robinson International Airport", lat: 11.1497, lng: -60.8322, pickupNote: "Arrivals hall exit, ANR Robinson" },
};

export type FlightStatus = {
    ident: string;               // e.g. BW484
    flight_date: string;         // local arrival date, YYYY-MM-DD
    origin: string | null;       // IATA
    destination: string | null;  // IATA
    status: string;              // FlightAware's own words, e.g. "En Route / On Time"
    cancelled: boolean;
    diverted: boolean;
    scheduled_in: string | null;
    estimated_in: string | null;
    actual_in: string | null;
    gate: string | null;
};

// Flight numbers are typed by people: "bw 484", "BW-0484" -> "BW484".
export function normaliseFlightNumber(raw: string): string | null {
    const s = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
    const m = /^([A-Z0-9]{2}|[A-Z]{3})0*(\d{1,4})[A-Z]?$/.exec(s);
    if (!m || !/[A-Z]/.test(m[1])) return null;
    return `${m[1]}${m[2]}`;
}

// The best time we have for when the plane is on the ground.
export function arrivalTime(f: Pick<FlightStatus, "actual_in" | "estimated_in" | "scheduled_in">): string | null {
    return f.actual_in || f.estimated_in || f.scheduled_in || null;
}

// Time from wheels-down to the guest walking out: immigration and bags for
// international arrivals; the Trinidad-Tobago air bridge is domestic.
export function exitBufferMinutes(origin: string | null, destination: string | null): number {
    const domestic = new Set(["POS", "TAB"]);
    return origin && destination && domestic.has(origin) && domestic.has(destination) ? 15 : 45;
}

export function pickupTimeFor(f: FlightStatus): string | null {
    const t = arrivalTime(f);
    if (!t) return null;
    return new Date(new Date(t).getTime() + exitBufferMinutes(f.origin, f.destination) * 60_000).toISOString();
}

// Choose the flight from AeroAPI's list that lands at `airport` on `date`
// (Trinidad time, UTC-4, no daylight saving).
export function pickFlight(raw: any, date: string, airport?: string): FlightStatus | null {
    const flights: any[] = Array.isArray(raw?.flights) ? raw.flights : [];
    const localDate = (iso: string) => new Date(new Date(iso).getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
    // Codeshares: one physical flight can come back under several flight
    // numbers. Keep each FlightAware flight id once, preferring the operating
    // carrier's own entry (ident_iata equals the operator's flight number).
    const seen = new Map<string, any>();
    for (const f of flights) {
        const key = String(f.fa_flight_id || `${f.ident_iata || f.ident}|${f.scheduled_in}`);
        const prev = seen.get(key);
        const isOperator = f.operator_iata && String(f.ident_iata || "").startsWith(f.operator_iata);
        if (!prev || (isOperator && !(prev.operator_iata && String(prev.ident_iata || "").startsWith(prev.operator_iata)))) seen.set(key, f);
    }
    const rows = [...seen.values()]
        .map((f) => ({
            ident: String(f.ident_iata || f.ident || ""),
            origin: f.origin?.code_iata ?? null,
            destination: f.destination?.code_iata ?? null,
            status: String(f.status || "Unknown"),
            cancelled: !!f.cancelled,
            diverted: !!f.diverted,
            scheduled_in: f.scheduled_in ?? null,
            estimated_in: f.estimated_in ?? null,
            actual_in: f.actual_in ?? null,
            gate: f.gate_destination ?? null,
        }))
        .filter((f) => f.scheduled_in && localDate(f.scheduled_in) === date)
        .filter((f) => !airport || f.destination === airport);
    const f = rows[0];
    return f ? { ...f, flight_date: date } : null;
}

export async function fetchFlightStatus(
    flightNumber: string,
    date: string,
    airport?: string,
): Promise<{ configured: false } | { configured: true; flight: FlightStatus | null; error?: string }> {
    const key = Deno.env.get("FLIGHTAWARE_AEROAPI_KEY");
    if (!key) return { configured: false };
    const ident = normaliseFlightNumber(flightNumber);
    if (!ident || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { configured: true, flight: null, error: "Check the flight number and date." };

    // Bound the search to that local day (+/- a day for late-night flights).
    const day = new Date(`${date}T00:00:00-04:00`).getTime();
    const start = new Date(day - 24 * 3_600_000).toISOString();
    const end = new Date(day + 48 * 3_600_000).toISOString();
    const url = `${AEROAPI}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
        const res = await secureFetch(url, { headers: { "x-apikey": key, Accept: "application/json" } });
        if (res.status === 401 || res.status === 403) return { configured: true, flight: null, error: "FlightAware refused the key." };
        if (res.status === 404) return { configured: true, flight: null, error: "FlightAware has no flight with that number." };
        if (!res.ok) return { configured: true, flight: null, error: `FlightAware error ${res.status}.` };
        return { configured: true, flight: pickFlight(await res.json(), date, airport) };
    } catch (e) {
        console.error("fetchFlightStatus failed:", e);
        return { configured: true, flight: null, error: "Could not reach FlightAware." };
    }
}
