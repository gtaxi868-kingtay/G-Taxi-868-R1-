// Web stub for @react-native-async-storage/async-storage.
// @gtaxi/core's barrel (index.ts) re-exports CrashReporter and outbox, which
// import AsyncStorage at module top level. On native that's the real module;
// in the Vite web apps (admin, merchant) Rollup must still resolve the
// import, and the native package isn't installed for web -- so `vite build`
// failed outright ("Rollup failed to resolve import"), meaning neither web
// app could ever produce a production bundle. Same AsyncStorage surface,
// backed by localStorage, guarded so private-mode / blocked storage
// degrades to a no-op instead of throwing.
function store() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
const AsyncStorage = {
  async getItem(key) { try { return store()?.getItem(key) ?? null; } catch { return null; } },
  async setItem(key, value) { try { store()?.setItem(key, value); } catch { /* storage unavailable */ } },
  async removeItem(key) { try { store()?.removeItem(key); } catch { /* storage unavailable */ } },
  async multiRemove(keys) { for (const k of keys) await AsyncStorage.removeItem(k); },
  async getAllKeys() { try { const s = store(); return s ? Object.keys(s) : []; } catch { return []; } },
  async clear() { try { store()?.clear(); } catch { /* storage unavailable */ } },
};
export default AsyncStorage;
