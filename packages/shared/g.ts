// The one way any app talks to G. Refreshes a stale session, retries once when
// the server refuses the sign-in, and always comes back with a plain reason.
type Client = {
    auth: {
        getSession: () => Promise<{ data: { session: { expires_at?: number } | null } }>;
        refreshSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
    };
    functions: { invoke: (name: string, options: { body: any }) => Promise<{ data: any; error: any }> };
};

const SIGNED_OUT = 'Please sign in again so G can help you.';
const BUSY = 'G is catching up. Try again in a moment.';
const OFFLINE = 'No connection right now. Check your signal and try again.';
const NO_SPEECH = "I didn't catch that. Try again, a little closer to the mic.";
const DEFAULT = "G couldn't do that right now. Try again in a moment.";

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

export async function callG<T = any>(supabase: Client, name: string, body: unknown): Promise<{ data: T | null; problem: string | null }> {
    const fresh = async (force: boolean) => {
        if (!force) {
            const { data } = await supabase.auth.getSession();
            if (data.session && (data.session.expires_at ?? 0) * 1000 > Date.now() + 30_000) return true;
        }
        const { data, error } = await supabase.auth.refreshSession();
        return !error && !!data.session;
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            if (!(await fresh(attempt > 0))) return { data: null, problem: SIGNED_OUT };
            const { data, error } = await supabase.functions.invoke(name, { body });
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

// Voice goes up, words come back, and G answers. One brain for every app.
export async function askG(supabase: Client, input: { text?: string; audioUri?: string }, context: Record<string, unknown>) {
    let text = input.text ?? '';
    if (input.audioUri) {
        const form = new FormData();
        form.append('audio', { uri: input.audioUri, name: 'voice.m4a', type: 'audio/m4a' } as any);
        form.append('transcribe_only', '1');
        const heard = await callG(supabase, 'handle_voice', form);
        if (heard.problem) return { problem: heard.problem };
        text = heard.data?.transcript ?? '';
        if (!text) return { problem: NO_SPEECH };
    }
    const { data, problem } = await callG(supabase, 'g_rider_concierge', { message: text, ...context });
    if (problem) return { heard: text, problem };
    if (data?.error) return { heard: text, problem: data.offline ? 'G is resting right now. Try again soon.' : DEFAULT };
    return { heard: text, reply: data?.reply as string | undefined, actions: data?.actions ?? [] };
}
