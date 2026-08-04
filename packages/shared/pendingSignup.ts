// Work that must happen at signup but REQUIRES an authenticated session.
//
// When email confirmation is enabled, supabase.auth.signUp returns a user but
// NO session. Anything that depends on auth.uid() therefore cannot run yet:
//
//   * record_consent()      — the consent ledger takes the id from auth.uid()
//   * apply_commander_code() — same, reads auth.uid() internally
//
// Both were previously attempted inline and silently skipped for exactly those
// users, and nothing ever re-tried after verification. A rider who ticked the
// terms box and entered a G-Lead code got neither recorded.
//
// This parks the intent on the device and flushes it the first time a real
// session exists. Storage is injected rather than imported so this file stays
// dependency-free and usable from any app.

export interface PendingSignup {
  consent?: { document: string; version: string; userAgent?: string };
  commanderCode?: string;
  /** Guards against replaying someone else's parked intent if a different
   *  account signs in on the same device. */
  forUserId?: string;
}

/** Minimal shape satisfied by AsyncStorage and expo-secure-store alike. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY = 'gtaxi.pendingSignup.v1';

export async function savePendingSignup(store: KeyValueStore, p: PendingSignup): Promise<void> {
  try {
    await store.setItem(KEY, JSON.stringify(p));
  } catch {
    // Never block signup on a storage failure.
  }
}

export async function clearPendingSignup(store: KeyValueStore): Promise<void> {
  try {
    await store.removeItem(KEY);
  } catch { /* ignore */ }
}

/**
 * Apply anything parked at signup, now that a session exists.
 *
 * Safe to call on every session start: record_consent is idempotent on
 * (user_id, document, version), and the parked intent is cleared once applied.
 * Returns what it managed to do, for logging.
 */
export async function flushPendingSignup(
  // PromiseLike, not Promise: supabase.rpc() returns a PostgrestFilterBuilder,
  // which is a THENABLE with no .catch or .finally. Typing this as Promise
  // rejects the real client. Same distinction that caused the .catch()
  // sweep across 23 files — it shows up in type signatures too.
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  store: KeyValueStore,
  currentUserId: string,
): Promise<{ consentRecorded: boolean; commanderApplied: boolean }> {
  const result = { consentRecorded: false, commanderApplied: false };

  let parked: PendingSignup | null = null;
  try {
    const raw = await store.getItem(KEY);
    if (!raw) return result;
    parked = JSON.parse(raw) as PendingSignup;
  } catch {
    // Corrupt payload is not worth retrying forever.
    await clearPendingSignup(store);
    return result;
  }

  // A different account signing in on this device must not inherit the
  // previous person's parked consent or referral.
  if (parked.forUserId && parked.forUserId !== currentUserId) {
    await clearPendingSignup(store);
    return result;
  }

  if (parked.consent) {
    const { error } = await supabase.rpc('record_consent', {
      p_document: parked.consent.document,
      p_version: parked.consent.version,
      p_user_agent: parked.consent.userAgent ?? null,
    });
    if (!error) result.consentRecorded = true;
  }

  if (parked.commanderCode) {
    const { error } = await supabase.rpc('apply_commander_code', {
      p_code: parked.commanderCode,
    });
    // A bad or expired code should not be retried on every app open.
    if (!error) result.commanderApplied = true;
  }

  // Clear only when the consent (the part that matters legally) landed, or
  // when there was no consent to record. A failed consent write is worth
  // retrying on the next app open.
  if (!parked.consent || result.consentRecorded) {
    await clearPendingSignup(store);
  }

  return result;
}
