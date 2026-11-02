import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env';
import { chunkedStore } from './sessionStore';

export type RuntimePlatform = 'web' | 'native';

let supabaseInstance: SupabaseClient | null = null;
let savedSessionReader: (() => Promise<any | null>) | null = null;

/**
 * Returns the correct storage adapter for the given runtime platform.
 * - 'native': uses @react-native-async-storage/async-storage
 * - 'web':    uses window.localStorage
 */
function getStorage(platform: RuntimePlatform): any {
    if (platform === 'native') {
        try {
            const { Platform } = require('react-native');
            if (Platform.OS !== 'web') {
                const SecureStore = require('expo-secure-store');
                const store = SecureStore.default || SecureStore;
                if (store && typeof store.getItemAsync === 'function') return chunkedStore(store);
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

    const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
    savedSessionReader = async () => {
        try {
            const raw = await storage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed?.user ? parsed : null;
        } catch {
            return null;
        }
    };

    supabaseInstance = createClient(url, anonKey, {
        auth: {
            storageKey,
            storage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: platform === 'web',
        },
    });

    if (platform === 'native') {
        // Timers stop in the background, so pick token refresh back up on return.
        try {
            const { AppState } = require('react-native');
            const client = supabaseInstance;
            AppState.addEventListener('change', (next: string) => {
                if (next === 'active') client.auth.startAutoRefresh();
                else client.auth.stopAutoRefresh();
            });
        } catch { /* no AppState here */ }
    }

    return { supabase: supabaseInstance, getSupabase: () => supabaseInstance! };
}

// The session saved on this phone, even when it has expired or there is no signal.
// A person stays in the app on this; only a real sign-out takes them to login.
export async function readSavedSession(): Promise<any | null> {
    return savedSessionReader ? savedSessionReader() : null;
}
