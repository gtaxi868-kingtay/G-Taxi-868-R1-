import { secureFetch } from "./networkUtility.ts";

const WARM_BRAIN_URL = Deno.env.get("WARM_BRAIN_URL") || "";

function isWarmBrainConfigured(): boolean {
  return WARM_BRAIN_URL !== "";
}

export async function getCachedWalletBalance(userId: string): Promise<number | null> {
  if (!isWarmBrainConfigured()) return null;
  try {
    const res = await secureFetch(`${WARM_BRAIN_URL}/wallet/${userId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 3000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.balance_cents ?? null;
  } catch {
    return null;
  }
}

export async function bustWalletCache(userId: string): Promise<void> {
  if (!isWarmBrainConfigured()) return;
  try {
    await secureFetch(`${WARM_BRAIN_URL}/wallet/${userId}/bust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 2000,
    });
  } catch {
    // non-fatal
  }
}

export async function findDriversNearby(
  lat: number,
  lng: number,
  radiusMeters: number = 5000
): Promise<Array<{ id: string; distanceMeters: number }>> {
  if (!isWarmBrainConfigured()) return [];
  try {
    const res = await secureFetch(
      `${WARM_BRAIN_URL}/drivers/nearby?lat=${lat}&lng=${lng}&radius=${radiusMeters}`,
      { method: "GET", headers: { "Content-Type": "application/json" }, timeoutMs: 3000 }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.drivers ?? [];
  } catch {
    return [];
  }
}

export async function sendGpsToWarmBrain(
  driverId: string,
  lat: number,
  lng: number,
  heading: number
): Promise<void> {
  if (!isWarmBrainConfigured()) return;
  try {
    await secureFetch(`${WARM_BRAIN_URL}/gps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, lat, lng, heading }),
      timeoutMs: 2000,
    });
  } catch {
    // non-fatal
  }
}
