import { createClient } from '@supabase/supabase-js';
import { ENV } from '@gtaxi/core';

// Anon client — uses VITE_ prefixed env vars for web, EXPO_PUBLIC_ for mobile.
// Reads from import.meta.env first (Vite build), falls back to ENV from @gtaxi/core.
const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || ENV.SUPABASE_URL;
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || ENV.SUPABASE_ANON_KEY;

// HMR-safe singleton: survives Vite hot-reload without creating duplicate clients
const getSupabase = () => {
  if (import.meta.hot?.data?.supabase) return import.meta.hot.data.supabase;
  const client = createClient(supabaseUrl || '', supabaseAnonKey || '');
  if (import.meta.hot) import.meta.hot.data.supabase = client;
  return client;
};

// Anon client — used only for auth (getSession, signIn, signOut) and Realtime subscriptions.
// All data queries go through edge functions using the user's JWT.
export const supabase = getSupabase();

// Base URL for all admin edge function calls. Stripping trailing slash for robustness.
export const FUNCTIONS_URL = `${(supabaseUrl || '').replace(/\/$/, '')}/functions/v1`;

// Helper: Invoke an admin edge function with the user's JWT automatically handled by the client.
export async function adminFetch(
    functionName: string,
    body?: Record<string, unknown>
): Promise<any> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No active session. Please log in.');

    const { data, error } = await supabase.functions.invoke(functionName, {
        body: body || {},
        headers: {
            'Authorization': `Bearer ${session.access_token}`
        }
    });

    if (error) {
        console.error(`Edge Function Error [${functionName}]:`, error);
        throw new Error(error.message || 'Request to edge function failed');
    }

    return data;
}
