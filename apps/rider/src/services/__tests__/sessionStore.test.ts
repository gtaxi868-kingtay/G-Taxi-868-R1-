import { chunkedStore } from '../../../../../packages/core/src/sessionStore';

function fakeSecureStore(failAfter = Infinity) {
  const data = new Map<string, string>();
  let writes = 0;
  return {
    data,
    getItemAsync: async (k: string) => data.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      if (writes++ >= failAfter) throw new Error('app killed');
      data.set(k, v);
    },
    deleteItemAsync: async (k: string) => { data.delete(k); },
  };
}

const big = 'x'.repeat(5000);

describe('chunkedStore', () => {
  it('keeps a session larger than the SecureStore limit', async () => {
    const s = chunkedStore(fakeSecureStore());
    await s.setItem('k', big);
    expect(await s.getItem('k')).toBe(big);
  });

  it('reads a session saved before this change', async () => {
    const raw = fakeSecureStore();
    raw.data.set('k', 'old');
    const s = chunkedStore(raw);
    expect(await s.getItem('k')).toBe('old');
    await s.setItem('k', 'new');
    expect(await s.getItem('k')).toBe('new');
    expect(raw.data.has('k')).toBe(false);
  });

  it('keeps the old session whole if the app dies mid-save', async () => {
    const raw = fakeSecureStore();
    const s = chunkedStore(raw);
    await s.setItem('k', big);
    const dying = chunkedStore({ ...raw, setItemAsync: async (k: string, v: string) => {
      if (k.endsWith('.1')) throw new Error('app killed');
      raw.data.set(k, v);
    } });
    await expect(dying.setItem('k', 'y'.repeat(5000))).rejects.toThrow();
    expect(await s.getItem('k')).toBe(big);
  });

  it('removes everything on a real sign-out', async () => {
    const raw = fakeSecureStore();
    const s = chunkedStore(raw);
    await s.setItem('k', big);
    await s.removeItem('k');
    expect(await s.getItem('k')).toBeNull();
    expect(raw.data.size).toBe(0);
  });
});
