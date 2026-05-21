import { SupabaseClient } from '@supabase/supabase-js';
import { ENV, createSupabaseClient } from '@gtaxi/core';

let supabaseInstance: SupabaseClient | null = null;

const getWebStorage = () => {
    const ls = typeof globalThis !== 'undefined' && (globalThis as any)?.localStorage;
    if (ls) {
        return {
            getItem: (key: string) => Promise.resolve(ls.getItem(key)),
            setItem: (key: string, value: string) => {
                ls.setItem(key, value);
                return Promise.resolve();
            },
            removeItem: (key: string) => {
                ls.removeItem(key);
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
};

export const getSupabase = (): SupabaseClient => {
    if (!supabaseInstance) {
        const storage = getWebStorage();
        supabaseInstance = createSupabaseClient({
            url: ENV.SUPABASE_URL,
            anonKey: ENV.SUPABASE_ANON_KEY
        }, storage);
    }
    return supabaseInstance;
};

export const supabase = new Proxy({} as SupabaseClient, {
    get: (target, prop) => {
        const client = getSupabase();
        return (client as any)[prop];
    },
});
