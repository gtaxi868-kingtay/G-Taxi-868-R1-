// Admin-editable contact config (business WhatsApp numbers).
// The values live in system_config (DB) so admin can change them from the
// dashboard without a code change. Reads are cached in-memory for the session
// and always fall back to a hardcoded number so a surface never breaks if the
// lookup fails or the app is offline.

import { supabase } from './native';

const FALLBACK: Record<string, string> = {
  support_whatsapp_number: '18687031000',
  escape_whatsapp_number: '18687031000',
};

const KEYS = ['support_whatsapp_number', 'escape_whatsapp_number'];

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function loadConfig(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data } = await supabase
        .from('system_config')
        .select('key, value')
        .in('key', KEYS);

      const map: Record<string, string> = { ...FALLBACK };
      for (const row of (data as { key: string; value: string }[] | null) || []) {
        if (row?.key && row?.value) map[row.key] = row.value;
      }
      cache = map;
      return map;
    } catch {
      return { ...FALLBACK };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Digits-only business WhatsApp number (E.164, no +) for rider/driver support. */
export async function getSupportWhatsApp(): Promise<string> {
  return (await loadConfig()).support_whatsapp_number || FALLBACK.support_whatsapp_number;
}

/** WhatsApp number for the G-Escape travel concierge. */
export async function getEscapeWhatsApp(): Promise<string> {
  return (await loadConfig()).escape_whatsapp_number || FALLBACK.escape_whatsapp_number;
}

/** Build a wa.me link for a number with optional prefilled text. */
export function waLink(numberDigits: string, text?: string): string {
  const base = `https://wa.me/${numberDigits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Resolve the support number and return a ready-to-open wa.me link. */
export async function supportWhatsAppLink(text?: string): Promise<string> {
  return waLink(await getSupportWhatsApp(), text);
}

/** Resolve the G-Escape number and return a ready-to-open wa.me link. */
export async function escapeWhatsAppLink(text?: string): Promise<string> {
  return waLink(await getEscapeWhatsApp(), text);
}

/** Fire-and-forget warm-up so the first real tap resolves instantly. */
export function primeContactConfig(): void {
  void loadConfig();
}
