import { getRedis } from "./redis-client";
import { config } from "./config";

interface GeofenceZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

let cachedZones: GeofenceZone[] = [];

export async function loadGeofenceZones(): Promise<GeofenceZone[]> {
  const redis = getRedis();
  const cacheKey = "geofence:zones";

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      cachedZones = JSON.parse(cached);
      return cachedZones;
    }
  } catch {
    // miss
  }

  cachedZones = [
    { id: "default", name: "Default", lat: 10.6918, lng: -61.2225, radiusMeters: 50000 },
  ];

  try {
    await redis.setex(cacheKey, config.geofenceCacheTtlSeconds, JSON.stringify(cachedZones));
  } catch {
    // non-fatal
  }

  return cachedZones;
}

export function isInZone(
  lat: number,
  lng: number,
  zone: GeofenceZone
): boolean {
  const R = 6371000;
  const dLat = ((lat - zone.lat) * Math.PI) / 180;
  const dLng = ((lng - zone.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((zone.lat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= zone.radiusMeters;
}

export function findClosestZone(
  lat: number,
  lng: number
): GeofenceZone | null {
  let closest: GeofenceZone | null = null;
  let closestDist = Infinity;

  for (const zone of cachedZones) {
    const R = 6371000;
    const dLat = ((lat - zone.lat) * Math.PI) / 180;
    const dLng = ((lng - zone.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((zone.lat * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (dist < closestDist) {
      closestDist = dist;
      closest = zone;
    }
  }

  return closest;
}
