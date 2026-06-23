import { initializeSupabaseClient } from './client';
import { ENV } from './env';

// On native/Expo, EXPO_PUBLIC_* env is always injected, so the Supabase client is
// created eagerly here (unchanged behaviour). On web builds (e.g. the admin dashboard)
// these vars are NOT injected into @gtaxi/core, so eager init would call createClient('')
// and throw "supabaseUrl is required" — crashing the whole app before it can render.
// Web apps bring their own Supabase client, so we skip eager init when env is absent.
const _native = ENV.SUPABASE_URL ? initializeSupabaseClient('native') : null;

export const supabase = _native?.supabase as ReturnType<typeof initializeSupabaseClient>['supabase'];
export const getSupabase: ReturnType<typeof initializeSupabaseClient>['getSupabase'] =
    _native?.getSupabase ?? (() => initializeSupabaseClient('native').getSupabase());
