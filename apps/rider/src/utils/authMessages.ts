// Plain-English sign-in / sign-up / reset errors for the rider app.
//
// Why (2026-10-28): when the auth server failed, the rider app printed the
// whole raw server reply on the sign-in screen -- a wall of JSON with
// headers and cookies (founder's screenshot). supabase-js puts the raw
// Response into `message` for unexpected server errors. A rider must only
// ever see a short sentence that says what to do next.

type AnyErr = { message?: unknown; status?: unknown; code?: unknown; name?: unknown } | null | undefined;

function statusOf(err: AnyErr): number | null {
    const s = Number((err as any)?.status);
    if (Number.isFinite(s) && s > 0) return s;
    const m = String((err as any)?.message ?? '');
    const found = /"status"\s*:\s*(\d{3})/.exec(m);
    return found ? Number(found[1]) : null;
}

export function authErrorMessage(err: AnyErr, context: 'signin' | 'signup' | 'reset' = 'signin'): string {
    const raw = String((err as any)?.message ?? '');
    const status = statusOf(err);
    const looksRaw = raw.trim().startsWith('{') || raw.includes('"headers"') || raw.length > 160;

    if (/invalid login credentials/i.test(raw)) return 'Wrong email or password. Check them, or tap "Forgot password?" to reset.';
    if (/email not confirmed/i.test(raw)) return 'Confirm your email first. Open the email we sent, then sign in.';
    if (/already registered|already been registered|user already exists/i.test(raw)) {
        return 'That email already has an account. Sign in instead, or reset the password.';
    }
    if (/already registered as a (rider|driver)/i.test(raw)) return 'That phone number is already on another account.';
    if (/password should be|at least \d+ characters|weak password/i.test(raw)) return 'Use a longer password (at least 8 characters).';
    if (/rate limit|too many|security purposes/i.test(raw) || status === 429) return 'Too many tries. Wait a minute, then try again.';
    if (/network request failed|failed to fetch|timeout|timed out|network/i.test(raw)) return 'No connection. Check your signal and try again.';
    if (/invalid.*email|unable to validate email/i.test(raw)) return 'That email address doesn\'t look right. Check it and try again.';
    if ((status && status >= 500) || /unexpected_failure|internal server error/i.test(raw)) {
        return 'Something went wrong on our side. Try again in a moment. If it keeps happening, message G868 support.';
    }
    if (looksRaw || !raw) {
        return context === 'signup' ? 'Sign-up didn\'t go through. Try again in a moment.'
            : context === 'reset' ? 'Could not send the reset email. Try again in a moment.'
            : 'Sign-in didn\'t go through. Try again in a moment.';
    }
    return raw;
}
