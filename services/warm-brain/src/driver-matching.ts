import { getRedis } from "./redis-client";

export interface NearbyDriver {
  id: string;
  distanceMeters: number;
  heading?: number;
}

export async function findNearbyDrivers(
  lat: number,
  lng: number,
  radiusMeters: number = 5000,
  limit: number = 20
): Promise<NearbyDriver[]> {
  const redis = getRedis();

  try {
    const results = await redis.georadius(
      "active_drivers",
      lng,
      lat,
      radiusMeters,
      "m",
      "WITHDIST",
      "ASC",
      "COUNT",
      limit
    );

    return results.map((r: any) => {
      const driverId = r[0] as string;
      const dist = parseFloat(r[1] as string);
      return { id: driverId, distanceMeters: Math.round(dist) };
    });
  } catch (err) {
    console.error("[DriverMatching] GEORADIUS failed:", err);
    return [];
  }
}

export async function markDriverOnline(
  driverId: string,
  lat: number,
  lng: number
): Promise<void> {
  const redis = getRedis();

  try {
    await redis.geoadd("active_drivers", lng, lat, driverId);
    await redis.setex(`driver_online:${driverId}`, 120, "1");
  } catch (err) {
    console.error("[DriverMatching] markOnline failed:", err);
  }
}

export async function markDriverOffline(driverId: string): Promise<void> {
  const redis = getRedis();

  try {
    await redis.zrem("active_drivers", driverId);
    await redis.del(`driver_online:${driverId}`);
  } catch {
    // non-fatal
  }
}

export async function isDriverOnline(driverId: string): Promise<boolean> {
  const redis = getRedis();

  try {
    const val = await redis.get(`driver_online:${driverId}`);
    return val === "1";
  } catch {
    return false;
  }
}
