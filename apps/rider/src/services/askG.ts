import { supabase } from '@gtaxi/core';

// Every AI call from the rider app goes through here, so a stale session never
// turns into a dead end and the rider always gets a real reason.

export type GResult<T> = { data: T | null; problem: string | null };

const SIGNED_OUT = 'Please sign in again so G can help you.';
const BUSY = 'G is catching up. Try again in a moment.';
const OFFLINE = 'No connection right now. Check your signal and try again.';
const NO_SPEECH = "I didn't catch that. Try again, a little closer to the mic.";
const DEFAULT = "G couldn't do that right now. You can still type where you're going.";

// The function client quietly falls back to the public key when no session is
// ready, which the server then refuses. Make sure a real token goes out.
async function freshSession(force = false): Promise<boolean> {
    if (!force) {
        const { data } = await supabase.auth.getSession();
        const expiresAt = data.session?.expires_at ?? 0;
        if (data.session && expiresAt * 1000 > Date.now() + 30_000) return true;
    }
    const { data, error } = await supabase.auth.refreshSession();
    return !error && !!data.session;
}

async function readStatus(error: any): Promise<{ status: number | null; code: string | null }> {
    const res = error?.context;
    if (!res || typeof res.status !== 'number') return { status: null, code: null };
    try {
        const body = await res.clone().json();
        return { status: res.status, code: body?.code ?? null };
    } catch {
        return { status: res.status, code: null };
    }
}

export function reasonFor(status: number | null, code: string | null): string {
    if (code === 'no_speech') return NO_SPEECH;
    if (status === 401 || status === 403) return SIGNED_OUT;
    if (status === 429) return BUSY;
    if (status === null) return OFFLINE;
    return DEFAULT;
}

export async function callG<T = any>(name: string, body: unknown): Promise<GResult<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            if (!(await freshSession(attempt > 0))) return { data: null, problem: SIGNED_OUT };
            const { data, error } = await supabase.functions.invoke(name, { body: body as any });
            if (!error) return { data: data as T, problem: null };
            const { status, code } = await readStatus(error);
            if (status === 401 && attempt === 0) continue;
            return { data: null, problem: reasonFor(status, code) };
        } catch {
            return { data: null, problem: OFFLINE };
        }
    }
    return { data: null, problem: SIGNED_OUT };
}

export function hasRealPlace(d: { lat?: unknown; lng?: unknown } | null | undefined): boolean {
    const lat = Number(d?.lat), lng = Number(d?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}
