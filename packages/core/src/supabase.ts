import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
    url: string;
    anonKey: string;
}

/**
 * Platform-agnostic Supabase Client Factory
 * 
 * @param config - URL and Anon Key
 * @param storage - Platform specific storage (localStorage or AsyncStorage)
 */
export function createSupabaseClient(
    config: SupabaseConfig,
    storage: any
): SupabaseClient {
    return createClient(config.url, config.anonKey, {
        auth: {
            storage: storage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: typeof window !== 'undefined' && !!window.location,
        },
    });
}
