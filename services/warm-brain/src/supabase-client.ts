import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

export type WalletRow = {
  user_id: string;
  balance_cents: number;
};

export type DriverLocationRow = {
  user_id: string;
  lat: number;
  lng: number;
  heading: number;
  updated_at: string;
};
