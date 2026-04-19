// @ts-nocheck
// Shared file uses DOM APIs (window, localStorage) - disabled for React Native compatibility
import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';

// Platform-specific storage for Supabase session
// Web uses localStorage, mobile uses AsyncStorage
const getStorage = () => {
    const isWeb = typeof window !== 'undefined' && !!window.localStorage;
    
    if (isWeb) {
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
    
    // Mobile: use AsyncStorage via dynamic require to prevent web build crashes
    try {
        return require('@react-native-async-storage/async-storage').default;
    } catch (e) {
        console.warn('AsyncStorage not found, falling back to null storage');
        return undefined;
    }
};

// Supabase client with platform-specific storage for session persistence
export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
    auth: {
        storage: getStorage(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: typeof window !== 'undefined' && !!window.location, 
    },
});
