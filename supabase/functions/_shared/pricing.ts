export const PRICING = {
    BASE_FARE_CENTS: 1600,
    PER_KM_CENTS: 175,
    PER_MIN_CENTS: 95,
    MIN_FARE_CENTS: 2200,
    STOP_BASE_GROCERY_CENTS: 3500,
    STOP_BASE_PHARMACY_CENTS: 2500,
    STOP_BASE_OTHER_CENTS: 1500,
    STOP_WAIT_FEE_PER_MIN_CENTS: 150, // TT$1.50/min Edge Out charge at merchant pin stops
};

// Static fallback only — the live source of truth is the vehicle_classes table
// (admin-controlled, includes heavy classes: truck / hiab / wrecker).
export const VEHICLE_MULTIPLIERS: Record<string, number> = {
    "Standard": 1.0,
    "XL": 1.5,
    "Premium": 2.0,
};

export interface VehicleClassRow {
    key: string;
    label: string;
    multiplier_x100: number;
    min_fare_cents: number | null;
    is_active: boolean;
}

// Reads the admin-controlled class row. Uses the service-role client so
// inactive rows are visible (callers must reject them explicitly — that is
// how "not launched yet" classes stay unbookable). Returns null on any
// error or unknown key so callers fall back to the static table.
export async function fetchVehicleClass(
    adminClient: { from: (t: string) => any },
    vehicleType: string,
): Promise<VehicleClassRow | null> {
    try {
        const key = String(vehicleType || "standard").trim().toLowerCase();
        const { data } = await adminClient
            .from("vehicle_classes")
            .select("key, label, multiplier_x100, min_fare_cents, is_active")
            .eq("key", key)
            .maybeSingle();
        return (data as VehicleClassRow) ?? null;
    } catch {
        return null;
    }
}

// Case-insensitive lookup into the static fallback table ('standard' and
// 'Standard' must resolve identically — case mismatch here once broke
// driver matching platform-wide).
export function staticMultiplier(vehicleType: string): number {
    const vt = String(vehicleType || "").trim().toLowerCase();
    for (const [k, v] of Object.entries(VEHICLE_MULTIPLIERS)) {
        if (k.toLowerCase() === vt) return v;
    }
    return 1.0;
}

export function calculateStopsFee(stops: Array<{ stop_type?: string; estimated_wait_minutes?: number }> = []): number {
    return stops.reduce((total, stop) => {
        let stopBase = PRICING.STOP_BASE_OTHER_CENTS;
        if (stop.stop_type === "grocery") stopBase = PRICING.STOP_BASE_GROCERY_CENTS;
        if (stop.stop_type === "pharmacy") stopBase = PRICING.STOP_BASE_PHARMACY_CENTS;

        const waitFee = Math.round((stop.estimated_wait_minutes || 0) * PRICING.PER_MIN_CENTS);
        return total + stopBase + waitFee;
    }, 0);
}

export function calculateFare(
    distanceMeters: number,
    durationSeconds: number,
    vehicleType: string = "Standard",
    surgeMultiplier: number = 1.0,
    stopsFeeCents: number = 0,
    multiplierOverride?: number
): number {
    const distanceKm = distanceMeters / 1000;
    const durationMin = durationSeconds / 60;
    const multiplier = multiplierOverride ?? staticMultiplier(vehicleType);

    let fareCents = PRICING.BASE_FARE_CENTS +
        Math.round(distanceKm * PRICING.PER_KM_CENTS) +
        Math.round(durationMin * PRICING.PER_MIN_CENTS);

    fareCents = Math.round((fareCents + stopsFeeCents) * multiplier * surgeMultiplier);
    return Math.max(fareCents, PRICING.MIN_FARE_CENTS);
}
