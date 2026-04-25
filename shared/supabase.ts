// @ts-nocheck
// Shared file uses DOM APIs (window, localStorage) - disabled for React Native compatibility
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env';

let supabaseInstance: SupabaseClient | null = null;

// Platform-specific storage for Supabase session
// Web uses localStorage, mobile uses AsyncStorage
const getStorage = () => {
    // Check for web localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
        return {
            getItem: (key: string) => Promise.resolve(window.localStorage.getItem(key)),
            setItem: (key: string, value: string) => {
                window.localStorage.setItem(key, value);
                return Promise.resolve();
            },
            removeItem: (key: string) => {
                window.localStorage.removeItem(key);
                return Promise.resolve();
            },
        };
    }
    
    // For React Native, try to get AsyncStorage
    // Use a safe dynamic import pattern that won't crash on load
    try {
        // Check if we're in React Native environment
        if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
            // Dynamic require that won't execute during bundling
            const AsyncStorageModule = require('@react-native-async-storage/async-storage');
            // Handle both default export and named export patterns
            const storage = AsyncStorageModule.default || AsyncStorageModule;
            if (storage && typeof storage.getItem === 'function') {
                return storage;
            }
        }
    } catch (e) {
        // AsyncStorage not available or not in React Native
        console.log('[Supabase] AsyncStorage not available, using memory storage');
    }
    
    // Fallback: memory storage (sessions won't persist across app restarts)
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
};

// Lazy initialization - only create client when first accessed
export const getSupabase = (): SupabaseClient => {
    if (!supabaseInstance) {
        const storage = getStorage();
        
        // Check for URL detection safely
        let detectSessionInUrl = false;
        try {
            detectSessionInUrl = typeof window !== 'undefined' && !!window.location;
        } catch {
            detectSessionInUrl = false;
        }
        
        supabaseInstance = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
            auth: {
                storage: storage,
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: detectSessionInUrl,
            },
        });
    }
    return supabaseInstance;
};

// Backward compatibility - export as supabase
export const supabase = new Proxy({} as SupabaseClient, {
    get: (target, prop) => {
        const client = getSupabase();
        return (client as any)[prop];
    },
});
