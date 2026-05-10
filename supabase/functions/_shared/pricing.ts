export const PRICING = {
    BASE_FARE_CENTS: 1600,
    PER_KM_CENTS: 175,
    PER_MIN_CENTS: 95,
    MIN_FARE_CENTS: 2200,
};

export const VEHICLE_MULTIPLIERS: Record<string, number> = {
    "Standard": 1.0,
    "XL": 1.5,
    "Premium": 2.0,
};

export function calculateStopsFee(stops: Array<{ stop_type?: string; estimated_wait_minutes?: number }> = []): number {
    return stops.reduce((total, stop) => {
        let stopBase = 1500;
        if (stop.stop_type === "grocery") stopBase = 3500;
        if (stop.stop_type === "pharmacy") stopBase = 2500;

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
