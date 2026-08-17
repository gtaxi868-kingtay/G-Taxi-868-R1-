// supabase/functions/_shared/verticalGate.ts
// Real server-side enforcement for the progression + admin-gate system.
// Mirrors the same decision get_rider_progress uses to decide what a rider
// SEES (rider_progression.unlocked_verticals earned, vertical_settings
// admin-controlled availability) but applies it at the point of the actual
// money-moving action, not just at home-screen display time.

const VERTICAL_ALIASES: Record<string, string> = {
  rides: 'ride_hailing',
  ride_hailing: 'ride_hailing',
  grocery: 'grocery',
  food: 'grocery',
  laundry: 'laundry',
  laundry_nfc: 'laundry',
  tap: 'laundry',
  merchant_delivery: 'merchant_delivery',
  g_escape: 'caribbean_travel',
  caribbean_travel: 'caribbean_travel',
  carnival: 'carnival',
  fete: 'carnival',
  events: 'events',
  b2b_logistics: 'b2b_logistics',
};

function rolloutBucket(riderId: string, vertical: string): number {
  const s = `${riderId}:${vertical}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 100;
}

export interface VerticalAccessResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Call BEFORE any money-moving action gated by progression (grocery
 * checkout, escape booking, NFC pay). Checks the emergency kill-switch
 * FIRST — it always wins over is_enabled/rollout, matching
 * get_rider_progress's gate. Rejects with a specific reason so the caller
 * can surface a real message instead of a generic 403.
 */
export async function checkVerticalAccess(
  supabaseAdmin: any,
  riderId: string,
  vertical: string,
): Promise<VerticalAccessResult> {
  const label = vertical.replace(/_/g, ' ');

  const { data: prog } = await supabaseAdmin
    .from('rider_progression')
    .select('unlocked_verticals')
    .eq('rider_id', riderId)
    .maybeSingle();

  const earned: string[] = prog?.unlocked_verticals ?? ['rides'];
  if (!earned.includes(vertical)) {
    return { allowed: false, reason: `You haven't unlocked ${label} yet. Keep riding to unlock it.` };
  }

  const settingsKey = VERTICAL_ALIASES[vertical];
  if (!settingsKey) return { allowed: true }; // not governed by vertical_settings

  const { data: row } = await supabaseAdmin
    .from('vertical_settings')
    .select('is_enabled, rollout_percentage, emergency_disabled')
    .eq('vertical_name', settingsKey)
    .maybeSingle();

  if (!row) return { allowed: true }; // no row = not governed yet

  if (row.emergency_disabled) {
    return { allowed: false, reason: `${label} is temporarily unavailable — please try again shortly.` };
  }
  if (!row.is_enabled) {
    return { allowed: false, reason: `${label} is not currently available.` };
  }

  const pct = row.rollout_percentage ?? 100;
  if (pct <= 0) {
    return { allowed: false, reason: `${label} is not currently available to your account.` };
  }
  if (pct < 100 && rolloutBucket(riderId, settingsKey) >= pct) {
    return { allowed: false, reason: `${label} is rolling out gradually and isn't available to your account yet.` };
  }

  return { allowed: true };
}
