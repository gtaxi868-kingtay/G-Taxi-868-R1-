import { requestPasswordReset, completePasswordReset, friendlySignInError, friendlyResetError } from '@g868/shared/passwordReset';

function client(over: Partial<Record<'reset' | 'verify' | 'update', any>> = {}) {
  const calls: any[] = [];
  return {
    calls,
    auth: {
      resetPasswordForEmail: async (email: string) => { calls.push(['reset', email]); return over.reset ?? { error: null }; },
      verifyOtp: async (p: any) => { calls.push(['verify', p]); return over.verify ?? { data: {}, error: null }; },
      updateUser: async (p: any) => { calls.push(['update', p]); return over.update ?? { error: null }; },
    },
  };
}

describe('password reset by code', () => {
  it('sends the code to a cleaned-up email and never reveals whether it has an account', async () => {
    const c = client();
    const r = await requestPasswordReset(c as any, '  Driver@Example.com ');
    expect(c.calls[0]).toEqual(['reset', 'driver@example.com']);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/If driver@example.com has an account/);
    // A server "not found" style error still gets the same neutral answer.
    const c2 = client({ reset: { error: { message: 'User not found' } } });
    expect((await requestPasswordReset(c2 as any, 'x@y.com')).ok).toBe(true);
  });

  it('refuses a bad email and explains rate limits plainly', async () => {
    expect((await requestPasswordReset(client() as any, 'nope')).ok).toBe(false);
    const c = client({ reset: { error: { message: 'For security purposes, you can only request this after 45 seconds.' } } });
    const r = await requestPasswordReset(c as any, 'a@b.com');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Wait a minute/);
  });

  it('checks the code, then saves the new password', async () => {
    const c = client();
    const r = await completePasswordReset(c as any, 'A@B.com', '12 34 56', 'longenough1', 'longenough1');
    expect(r.ok).toBe(true);
    expect(c.calls[0]).toEqual(['verify', { email: 'a@b.com', token: '123456', type: 'recovery' }]);
    expect(c.calls[1]).toEqual(['update', { password: 'longenough1' }]);
  });

  it('stops before calling the server on short codes, short or mismatched passwords', async () => {
    const c = client();
    expect((await completePasswordReset(c as any, 'a@b.com', '123', 'longenough1', 'longenough1')).message).toMatch(/6-digit/);
    expect((await completePasswordReset(c as any, 'a@b.com', '123456', 'short', 'short')).message).toMatch(/8 characters/);
    expect((await completePasswordReset(c as any, 'a@b.com', '123456', 'longenough1', 'longenough2')).message).toMatch(/different/);
    expect(c.calls).toHaveLength(0);
  });

  it('explains a wrong or expired code', async () => {
    const c = client({ verify: { data: null, error: { message: 'Token has expired or is invalid' } } });
    const r = await completePasswordReset(c as any, 'a@b.com', '123456', 'longenough1', 'longenough1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/wrong or has expired/);
    expect(friendlyResetError('New password should be different from the old password.')).toMatch(/not used/);
  });

  it('turns a wrong password into an offer to reset', () => {
    expect(friendlySignInError('Invalid login credentials')).toMatchObject({ title: 'Wrong email or password', offerReset: true });
    expect(friendlySignInError('Network request failed').offerReset).toBe(false);
  });
});
