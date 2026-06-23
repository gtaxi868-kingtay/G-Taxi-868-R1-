export const PRICING = {
    BASE_FARE_CENTS: 1600,
    PER_KM_CENTS: 175,
    PER_MIN_CENTS: 95,
    MIN_FARE_CENTS: 2200,
    STOP_BASE_GROCERY_CENTS: 3500,
    STOP_BASE_PHARMACY_CENTS: 2500,
    STOP_BASE_OTHER_CENTS: 1500,
    STOP_WAIT_FEE_PER_MIN_CENTS: 150,
};

export const VEHICLE_MULTIPLIERS: Record<string, number> = {
    "Standard": 1.0,
    "XL": 1.5,
    "Premium": 2.0,
};

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
    stopsFeeCents: number = 0
): number {
    const distanceKm = distanceMeters / 1000;
    const durationMin = durationSeconds / 60;
    const multiplier = VEHICLE_MULTIPLIERS[vehicleType] || 1.0;

    let fareCents = PRICING.BASE_FARE_CENTS +
        Math.round(distanceKm * PRICING.PER_KM_CENTS) +
        Math.round(durationMin * PRICING.PER_MIN_CENTS);

    fareCents = Math.round((fareCents + stopsFeeCents) * multiplier * surgeMultiplier);
    return Math.max(fareCents, PRICING.MIN_FARE_CENTS);
}
