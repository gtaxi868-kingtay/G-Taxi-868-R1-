import { getRedis } from "./redis-client";
import { supabase } from "./supabase-client";
import { markDriverOnline } from "./driver-matching";

interface GpsUpdate {
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  timestamp: number;
}

const recentUpdates = new Map<string, number>();

export function ingestGpsUpdate(update: GpsUpdate): boolean {
  const key = `${update.driverId}:${Math.floor(update.timestamp / 1000)}`;
  if (recentUpdates.has(key)) {
    return false;
  }

  recentUpdates.set(key, update.timestamp);
  if (recentUpdates.size > 10000) {
    const oldest = Date.now() - 120000;
    for (const [k, v] of recentUpdates) {
      if (v < oldest) recentUpdates.delete(k);
    }
  }

  return true;
}

export async function persistGpsUpdate(
  driverId: string,
  lat: number,
  lng: number,
  heading: number
): Promise<void> {
  const redis = getRedis();

  try {
    const pipeline = redis.pipeline();
    pipeline.geoadd("active_drivers", lng, lat, driverId);
    pipeline.setex(`driver_online:${driverId}`, 120, "1");
    pipeline.set(`gps:${driverId}`, JSON.stringify({ lat, lng, heading, ts: Date.now() }));
    pipeline.expire(`gps:${driverId}`, 120);
    await pipeline.exec();
  } catch (err) {
    console.error("[GPS] Redis update failed:", err);
  }

  const shouldPersist = Math.random() < 0.2;
  if (!shouldPersist) return;

  try {
    await supabase
      .from("active_drivers")
      .upsert(
        {
          user_id: driverId,
          lat,
          lng,
          heading,
          updated_at: new Date().toISOString(),
          status: "available",
        },
        { onConflict: "user_id" }
      );
  } catch (err) {
    console.error("[GPS] Supabase persist failed:", err);
  }
}
