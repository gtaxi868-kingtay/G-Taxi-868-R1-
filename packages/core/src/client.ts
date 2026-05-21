import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env';

export type RuntimePlatform = 'web' | 'native';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Returns the correct storage adapter for the given runtime platform.
 * - 'native': uses @react-native-async-storage/async-storage
 * - 'web':    uses window.localStorage
 */
function getStorage(platform: RuntimePlatform): any {
    if (platform === 'native') {
        try {
            if (typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative') {
                const AsyncStorageModule = require('@react-native-async-storage/async-storage');
                const storage = AsyncStorageModule.default || AsyncStorageModule;
                if (storage && typeof storage.getItem === 'function') {
                    return storage;
                }
            }
        } catch {
            // Fall through to memory storage
        }

        const memoryStorage: Record<string, string> = {};
        return {
            getItem: (key: string) => Promise.resolve(memoryStorage[key] || null),
            setItem: (key: string, value: string) => {
                memoryStorage[key] = value;
                return Promise.resolve();
            },
            removeItem: (key: string) => {
                delete memoryStorage[key];
                return Promise.resolve();
            },
        };
    }

    const win = (typeof globalThis !== 'undefined' ? (globalThis as any) : null);
    if (win?.localStorage) {
        return {
            getItem: (key: string) => Promise.resolve(win.localStorage.getItem(key)),
            setItem: (key: string, value: string) => {
                win.localStorage.setItem(key, value);
                return Promise.resolve();
            },
            removeItem: (key: string) => {
                win.localStorage.removeItem(key);
                return Promise.resolve();
            },
        };
    }

    const memoryStorage: Record<string, string> = {};
    return {
        getItem: (key: string) => Promise.resolve(memoryStorage[key] || null),
        setItem: (key: string, value: string) => {
            memoryStorage[key] = value;
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            delete memoryStorage[key];
            return Promise.resolve();
        },
    };
}

/**
 * Single unified Supabase client factory.
 *
 * Usage:
 *   const { supabase, getSupabase } = initializeSupabaseClient('native');
 *   const { supabase, getSupabase } = initializeSupabaseClient('web');
 */
export function initializeSupabaseClient(platform: RuntimePlatform): {
    supabase: SupabaseClient;
    getSupabase: () => SupabaseClient;
} {
    if (supabaseInstance) {
        return { supabase: supabaseInstance, getSupabase: () => supabaseInstance! };
    }

    const url = ENV.SUPABASE_URL;
    const anonKey = ENV.SUPABASE_ANON_KEY;
    const storage = getStorage(platform);

    supabaseInstance = createClient(url, anonKey, {
        auth: {
            storage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: platform === 'web',
        },
    });

    return { supabase: supabaseInstance, getSupabase: () => supabaseInstance! };
}
