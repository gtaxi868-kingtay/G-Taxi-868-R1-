import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ENV } from '../config/env';

// Platform-specific storage for Supabase session
// Web uses localStorage, mobile uses AsyncStorage
const getStorage = () => {
    if (Platform.OS === 'web') {
        // Web: use localStorage wrapper
        return {
            getItem: (key: string) => {
                const value = localStorage.getItem(key);
                return Promise.resolve(value);
            },
            setItem: (key: string, value: string) => {
                localStorage.setItem(key, value);
                return Promise.resolve();
            },
            removeItem: (key: string) => {
                localStorage.removeItem(key);
                return Promise.resolve();
            },
        };
    }
    // Mobile: use AsyncStorage
    return AsyncStorage;
};

// Supabase client with platform-specific storage for session persistence
export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
    auth: {
        storage: getStorage(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web', // Enable for web OAuth
    },
});
