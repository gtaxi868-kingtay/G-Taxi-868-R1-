import { callG, hasRealPlace, reasonFor } from '../askG';

const mockGetSession = jest.fn();
const mockRefresh = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@gtaxi/core', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession(), refreshSession: () => mockRefresh() },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
  },
}));

const later = () => Math.floor(Date.now() / 1000) + 3600;
const fresh = { data: { session: { expires_at: later() } } };
const http = (status: number, body: unknown = {}) => ({ context: { status, clone: () => ({ json: async () => body }) } });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(fresh);
  mockRefresh.mockResolvedValue({ data: { session: {} }, error: null });
});

describe('callG', () => {
  it('returns the answer', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'Hi' }, error: null });
    expect(await callG('g_rider_concierge', {})).toEqual({ data: { reply: 'Hi' }, problem: null });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes a session that is about to expire before calling', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { expires_at: 1 } } });
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await callG('handle_voice', {});
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries once when the server refuses the sign-in', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: http(401) }).mockResolvedValueOnce({ data: { ok: 1 }, error: null });
    expect(await callG('handle_voice', {})).toEqual({ data: { ok: 1 }, problem: null });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('stops after one retry and gives a reason', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: http(401) });
    const r = await callG('handle_voice', {});
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(r.problem).toMatch(/sign in again/);
  });

  it('says so when it could not hear the rider', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: http(422, { code: 'no_speech' }) });
    expect((await callG('handle_voice', {})).problem).toMatch(/didn't catch that/);
  });

  it('never throws when offline', async () => {
    mockInvoke.mockRejectedValue(new Error('network'));
    expect((await callG('handle_voice', {})).problem).toMatch(/No connection/);
  });
});

describe('reasons and places', () => {
  it('has a plain reason for each failure', () => {
    expect(reasonFor(429, null)).toMatch(/catching up/);
    expect(reasonFor(null, null)).toMatch(/No connection/);
    expect(reasonFor(500, null)).toMatch(/type where/);
  });

  it('refuses a place with no real position', () => {
    expect(hasRealPlace({ lat: 10.6, lng: -61.5 })).toBe(true);
    expect(hasRealPlace({ lat: 0, lng: 0 })).toBe(false);
    expect(hasRealPlace({ lat: 'x', lng: 1 })).toBe(false);
    expect(hasRealPlace(null)).toBe(false);
  });
});
