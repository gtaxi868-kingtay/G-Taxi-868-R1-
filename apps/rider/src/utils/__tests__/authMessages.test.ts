import { authErrorMessage } from '../authMessages';

// The exact shape from the founder's screenshot (2026-10-28): a 500 whose
// message is the whole raw Response.
const RAW_500 = JSON.stringify({ type: 'default', status: 500, ok: false, statusText: '', headers: { map: { 'x-sb-error-code': 'unexpected_failure', 'set-cookie': '__cf_bm=SECRET' } }, url: 'https://x.supabase.co/auth/v1/token?grant_type=password' });

describe('authErrorMessage', () => {
  it('never shows the raw server reply', () => {
    const msg = authErrorMessage({ message: RAW_500, status: 500 });
    expect(msg).toMatch(/Something went wrong on our side/);
    expect(msg).not.toMatch(/headers|cookie|supabase/);
  });
  it('finds the status even when only the raw text has it', () => {
    expect(authErrorMessage({ message: RAW_500 })).toMatch(/on our side/);
  });
  it('points a wrong password to the reset', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials', status: 400 })).toMatch(/Forgot password/);
  });
  it('explains the common cases plainly', () => {
    expect(authErrorMessage({ message: 'User already registered' }, 'signup')).toMatch(/already has an account/);
    expect(authErrorMessage({ message: 'Network request failed' })).toMatch(/No connection/);
    expect(authErrorMessage({ message: 'Email rate limit exceeded', status: 429 })).toMatch(/Too many tries/);
    expect(authErrorMessage({ message: 'Password should be at least 6 characters.' }, 'signup')).toMatch(/longer password/);
  });
  it('falls back to a calm sentence for anything unreadable', () => {
    expect(authErrorMessage(null, 'signup')).toMatch(/Sign-up didn't go through/);
    expect(authErrorMessage({ message: '{"weird":true}' })).toMatch(/Sign-in didn't go through/);
  });
  it('keeps short, readable server messages as they are', () => {
    expect(authErrorMessage({ message: 'Signups not allowed for this instance' })).toBe('Signups not allowed for this instance');
  });
});
