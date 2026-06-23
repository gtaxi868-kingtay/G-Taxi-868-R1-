import dotenv from "dotenv";
dotenv.config();

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || "https://ffbbuafgeypvkpcuvdnv.supabase.co",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  port: parseInt(process.env.PORT || "3001", 10),

  walletCacheTtlSeconds: 300,
  driverLocationTtlSeconds: 120,
  geofenceCacheTtlSeconds: 600,
};
