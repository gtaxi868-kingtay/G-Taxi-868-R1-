import { getRedis } from "./redis-client";
import { supabase, WalletRow } from "./supabase-client";
import { config } from "./config";

export async function getWalletBalance(userId: string): Promise<number> {
  const redis = getRedis();
  const cacheKey = `wallet:${userId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseInt(cached, 10);
    }
  } catch {
    // Redis miss, fall through to Supabase
  }

  const { data, error } = await supabase
    .from("wallets")
    .select("balance_cents")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return 0;
  }

  const balance = data.balance_cents ?? 0;

  try {
    await redis.setex(cacheKey, config.walletCacheTtlSeconds, balance.toString());
  } catch {
    // cache write is non-fatal
  }

  return balance;
}

export async function bustWalletCache(userId: string): Promise<void> {
  try {
    await getRedis().del(`wallet:${userId}`);
  } catch {
    // non-fatal
  }
}
