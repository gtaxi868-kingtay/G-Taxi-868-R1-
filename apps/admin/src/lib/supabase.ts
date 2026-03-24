import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Anon client — used only for auth (getSession, signIn, signOut) and Realtime subscriptions.
// All data queries go through edge functions using the user's JWT.
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Base URL for all admin edge function calls. Stripping trailing slash for robustness.
export const FUNCTIONS_URL = `${(supabaseUrl || '').replace(/\/$/, '')}/functions/v1`;

// Helper: POST to an admin edge function with the user's JWT.
export async function adminFetch(
    functionName: string,
    body?: Record<string, unknown>
): Promise<any> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No active session');

    const res = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': supabaseAnonKey || '',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(`HTTP_${res.status}: ${json.error || 'Request failed'}`);
    }

    return await res.json();
}
