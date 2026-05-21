const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

export function haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
): number {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
}

export function bearingDeg(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
): number {
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x =
        Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function isWithinRadius(
    plat: number,
    plng: number,
    clat: number,
    clng: number,
    radiusMeters: number,
): boolean {
    return haversineMeters(plat, plng, clat, clng) <= radiusMeters;
}

export function checkGeofenceZone(
    userLat: number,
    userLng: number,
    targetLat: number,
    targetLng: number,
    hardRadiusMeters: number = 150,
    softRadiusMeters: number = 50,
): { withinHard: boolean; withinSoft: boolean; driftMeters: number } {
    const driftMeters = haversineMeters(userLat, userLng, targetLat, targetLng);
    return {
        withinHard: driftMeters <= hardRadiusMeters,
        withinSoft: driftMeters <= softRadiusMeters,
        driftMeters: Math.round(driftMeters * 100) / 100,
    };
}
