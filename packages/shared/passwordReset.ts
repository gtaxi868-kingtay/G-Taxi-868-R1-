// Password reset by emailed 6-digit code, shared by the driver and shop apps
// (2026-10-28). The founder hit "invalid credentials" with no way back in;
// only the rider app had a reset, and it depended on a link opening the app
// straight from the email (custom app links are not clickable in every mail
// app). A code works in any mail app: the person reads it and types it.
//
// Needs the Supabase "Reset Password" email template to include
// {{ .Token }} (the 6-digit code), and a real email sender (custom SMTP):
// Supabase's built-in sender only delivers to the project's own team.

type AuthClient = {
    auth: {
        resetPasswordForEmail: (email: string, opts?: { redirectTo?: string }) => Promise<{ error: { message: string; status?: number } | null }>;
        verifyOtp: (p: { email: string; token: string; type: 'recovery' }) => Promise<{ data: unknown; error: { message: string; status?: number } | null }>;
        updateUser: (p: { password: string }) => Promise<{ error: { message: string } | null }>;
    };
};

export type ResetResult = { ok: boolean; message: string };

export function normaliseEmail(raw: string): string {
    return String(raw || '').trim().toLowerCase();
}

export function looksLikeEmail(raw: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(raw));
}

export const MIN_PASSWORD = 8;

// Turn auth server wording into one plain sentence.
export function friendlyResetError(message: string): string {
    const m = message || '';
    if (/security purposes|only request this after|rate limit|too many/i.test(m)) {
        return 'A code was sent a moment ago. Wait a minute, then ask for a new one.';
    }
    if (/expired|invalid|not found|otp/i.test(m)) {
        return 'That code is wrong or has expired. Check the latest email, or ask for a new code.';
    }
    if (/same.*password|different from the old/i.test(m)) {
        return 'Choose a password you have not used on this account before.';
    }
    if (/weak|at least|characters|password should/i.test(m)) {
        return `Use at least ${MIN_PASSWORD} characters.`;
    }
    if (/network|fetch|timeout|timed out/i.test(m)) {
        return 'No connection. Check your signal and try again.';
    }
    return m || 'Something went wrong. Try again.';
}

// Step 1. Always answers the same way whether or not the email has an
// account, so the screen cannot be used to check who is signed up.
export async function requestPasswordReset(client: AuthClient, rawEmail: string, redirectTo?: string): Promise<ResetResult> {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, message: 'Enter the email you signed up with.' };
    try {
        const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
        if (error && /security purposes|only request this after|rate limit|too many/i.test(error.message)) {
            return { ok: false, message: friendlyResetError(error.message) };
        }
        if (error && /network|fetch|timeout/i.test(error.message)) {
            return { ok: false, message: friendlyResetError(error.message) };
        }
        return { ok: true, message: `If ${email} has an account, a 6-digit code is on its way. Check your inbox and spam folder.` };
    } catch (e: any) {
        return { ok: false, message: friendlyResetError(e?.message ?? '') };
    }
}

// Step 2. The code signs the person in for this one purpose; then the new
// password is saved and they are fully signed in.
export async function completePasswordReset(client: AuthClient, rawEmail: string, rawCode: string, password: string, confirm: string): Promise<ResetResult> {
    const email = normaliseEmail(rawEmail);
    const code = String(rawCode || '').replace(/\D/g, '');
    if (code.length < 6) return { ok: false, message: 'Enter the 6-digit code from the email.' };
    if (password.length < MIN_PASSWORD) return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` };
    if (password !== confirm) return { ok: false, message: 'The two passwords are different.' };
    try {
        const v = await client.auth.verifyOtp({ email, token: code, type: 'recovery' });
        if (v.error) return { ok: false, message: friendlyResetError(v.error.message) };
        const u = await client.auth.updateUser({ password });
        if (u.error) return { ok: false, message: friendlyResetError(u.error.message) };
        return { ok: true, message: 'Password changed. You are signed in.' };
    } catch (e: any) {
        return { ok: false, message: friendlyResetError(e?.message ?? '') };
    }
}

// Sign-in failures, in words that point to the way out.
export function friendlySignInError(message: string): { title: string; body: string; offerReset: boolean } {
    const m = message || '';
    if (/invalid login credentials|invalid.*password/i.test(m)) {
        return { title: 'Wrong email or password', body: 'Check them and try again, or reset your password.', offerReset: true };
    }
    if (/email not confirmed/i.test(m)) {
        return { title: 'Email not confirmed', body: 'Open the confirmation email we sent, then sign in.', offerReset: false };
    }
    if (/network|fetch|timeout/i.test(m)) {
        return { title: 'No connection', body: 'Check your signal and try again.', offerReset: false };
    }
    if (/too many|rate limit/i.test(m)) {
        return { title: 'Too many tries', body: 'Wait a minute, then try again, or reset your password.', offerReset: true };
    }
    return { title: 'Could not sign in', body: m || 'Try again.', offerReset: false };
}
