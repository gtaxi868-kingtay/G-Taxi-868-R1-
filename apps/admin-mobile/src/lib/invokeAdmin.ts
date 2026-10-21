import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

// Calls the `admin` edge function and ALWAYS returns the server's own answer.
//
// supabase-js turns any non-2xx response into a bare FunctionsHttpError whose
// message is just "Edge Function returned a non-2xx status code"; the real
// reason ("This rider already has an active tag...", a database error, ...)
// is only in the response body. Screens that did `if (error) throw error`
// showed admins that generic line and never reached their own handling for
// the 409 cases (first field test, 2026-10-21). Callers check `success`.
export async function invokeAdmin(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await supabase.functions.invoke('admin', { body });
    if (!error) return data ?? { success: false, error: 'The server sent an empty reply.' };

    let payload: any = null;
    try {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') payload = await ctx.json();
    } catch {
        // Body was not JSON; fall through to the transport message.
    }
    if (payload && typeof payload === 'object') {
        return { ...payload, success: false, error: payload.error || payload.message || 'The server refused the request.' };
    }
    return { success: false, error: (error as any)?.message || 'Could not reach the server. Check the internet connection.' };
}
