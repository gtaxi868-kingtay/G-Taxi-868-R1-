import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// One-call endpoint for the HomeScreen: progression level, unlock status,
// next-level carrot, and contextual suggestion.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const LEVEL_LABELS: Record<number, string> = {
  1: 'New Rider',
  2: 'Regular',
  3: 'Loyal',
  4: 'Elite',
  5: 'G-Member',
};

// ── TWO GATES, BOTH MUST PASS ────────────────────────────────────────
// A vertical shows for a rider only when:
//   1. the RIDER earned it  — rider_progression.unlocked_verticals,
//      driven by progression_config (e.g. 15 rides -> grocery), and
//   2. the ADMIN allows it  — vertical_settings.is_enabled + rollout.
//
// Gate 2 was never wired. PlatformControl wrote vertical_settings and
// the rider app subscribed to it over realtime, but nothing ever READ
// it — so an admin switching a vertical off changed nothing on any
// phone. caribbean_travel/carnival/events are all is_enabled=false
// today while riders who earned them would still have seen them.
//
// Filtering happens HERE, server-side, so it is one source of truth and
// a client cannot opt out of it.

// progression vertical name -> vertical_settings.vertical_name
const VERTICAL_ALIASES: Record<string, string> = {
  rides: 'ride_hailing',
  ride_hailing: 'ride_hailing',
  grocery: 'grocery',
  laundry: 'laundry',
  laundry_nfc: 'laundry',
  merchant_delivery: 'merchant_delivery',
  g_escape: 'caribbean_travel',
  caribbean_travel: 'caribbean_travel',
  carnival: 'carnival',
  fete: 'carnival',
  events: 'events',
  b2b_logistics: 'b2b_logistics',
  // gwallet_bonus and kiosk have no vertical_settings row — they are a
  // wallet perk and a system_feature_flag respectively, so they are not
  // governed here and pass through untouched.
};

/**
 * Deterministic 0-99 bucket for staged rollouts. Stable for a given
 * (rider, vertical) so a rider never flickers in and out of a vertical
 * between refreshes — the thing that makes percentage rollouts feel
 * broken to real users.
 */
function rolloutBucket(riderId: string, vertical: string): number {
  const s = `${riderId}:${vertical}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 100;
}

interface VerticalSetting {
  vertical_name: string;
  is_enabled: boolean;
  rollout_percentage: number | null;
}

function isAllowedByAdmin(
  progressionName: string,
  settings: Map<string, VerticalSetting>,
  riderId: string,
): boolean {
  const key = VERTICAL_ALIASES[progressionName];
  if (!key) return true;               // not governed by vertical_settings
  const row = settings.get(key);
  if (!row) return true;               // no row = not governed yet
  if (!row.is_enabled) return false;   // admin switched it off

  const pct = row.rollout_percentage ?? 100;
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return rolloutBucket(riderId, key) < pct;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader ?? '' } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '')
  );
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Progression row
  const { data: prog } = await supabaseAdmin
    .from('rider_progression')
    .select('*')
    .eq('rider_id', user.id)
    .maybeSingle();

  const level = prog?.level ?? 1;
  const earnedVerticals: string[] = prog?.unlocked_verticals ?? ['rides'];

  // ── Gate 2: what the admin currently allows ────────────────────────
  const { data: verticalRows } = await supabaseAdmin
    .from('vertical_settings')
    .select('vertical_name, is_enabled, rollout_percentage');

  const settings = new Map<string, VerticalSetting>(
    (verticalRows ?? []).map((v: VerticalSetting) => [v.vertical_name, v]),
  );

  // Fail SAFE, not open: if vertical_settings can't be read we keep the
  // rider's earned list rather than blanking their home screen. An admin
  // toggle failing to apply is a lesser harm than every vertical
  // vanishing because one query hiccuped.
  const settingsAvailable = Array.isArray(verticalRows) && verticalRows.length > 0;

  const unlockedVerticals = settingsAvailable
    ? earnedVerticals.filter((v) => isAllowedByAdmin(v, settings, user.id))
    : earnedVerticals;

  // Earned but currently switched off by the admin. Surfaced so the UI
  // can say "temporarily unavailable" instead of silently losing a
  // vertical the rider knows they unlocked.
  const withheldByAdmin = settingsAvailable
    ? earnedVerticals.filter((v) => !isAllowedByAdmin(v, settings, user.id))
    : [];

  // Whole-platform view, so clients can gate things that are not part of
  // the progression list at all (carnival, events, b2b).
  const platformEnabled: Record<string, boolean> = {};
  for (const [name, row] of settings) {
    platformEnabled[name] = row.is_enabled === true;
  }

  // Next level config for the carrot
  const { data: nextCfg } = await supabaseAdmin
    .from('progression_config')
    .select('*')
    .gt('level', level)
    .order('level', { ascending: true })
    .limit(1)
    .maybeSingle();

  let nextUnlockProgress = 0;
  let nextUnlockRequired = 0;
  let nextUnlockLabel: string | null = null;

  if (nextCfg) {
    nextUnlockLabel = nextCfg.unlock_vertical;
    nextUnlockRequired = nextCfg.threshold_value;
    if (nextCfg.threshold_type === 'rides')          nextUnlockProgress = prog?.total_rides ?? 0;
    else if (nextCfg.threshold_type === 'grocery_orders') nextUnlockProgress = prog?.total_grocery_orders ?? 0;
    else if (nextCfg.threshold_type === 'laundry_orders') nextUnlockProgress = prog?.total_laundry_orders ?? 0;
    else if (nextCfg.threshold_type === 'wallet_funded')  nextUnlockProgress = prog?.wallet_ever_funded ? 1 : 0;
    else if (nextCfg.threshold_type === 'escape_booked')  nextUnlockProgress = prog?.escape_ever_booked ? 1 : 0;
  }

  // Contextual suggestion from DB function
  const hour = new Date().getUTCHours();
  const { data: suggestion } = await supabaseAdmin
    .rpc('get_home_suggestion', { p_rider_id: user.id, p_hour_of_day: hour })
    .maybeSingle()
    .then((__r) => __r, () => ({ data: null }));

  // Ensure row exists for future calls
  if (!prog) {
    await supabaseAdmin
      .from('rider_progression')
      .insert({ rider_id: user.id })
      .then((__r) => __r, () => {});
  }

  return json({
    success: true,
    data: {
      level,
      level_label: LEVEL_LABELS[level] ?? 'Rider',
      // Effective list: earned AND currently allowed by the admin.
      unlocked_verticals: unlockedVerticals,
      // Earned but switched off right now — for an honest
      // "temporarily unavailable" instead of a silent disappearance.
      withheld_by_admin: withheldByAdmin,
      // Every vertical's admin switch, for gating things outside the
      // progression list (carnival, events, b2b_logistics).
      platform_enabled: platformEnabled,
      // What the rider actually earned, before the admin gate.
      earned_verticals: earnedVerticals,
      total_rides: prog?.total_rides ?? 0,
      total_grocery_orders: prog?.total_grocery_orders ?? 0,
      total_laundry_orders: prog?.total_laundry_orders ?? 0,
      wallet_ever_funded: prog?.wallet_ever_funded ?? false,
      escape_ever_booked: prog?.escape_ever_booked ?? false,
      // Don't dangle a carrot the admin has switched off. Still shown,
      // but flagged, so the UI can avoid promising "3 more rides and
      // Caribbean Escapes is yours" when it is currently disabled
      // platform-wide.
      next_unlock: nextCfg
        ? {
            level: nextCfg.level,
            vertical: nextCfg.unlock_vertical,
            progress: nextUnlockProgress,
            required: nextUnlockRequired,
            label: nextUnlockLabel,
            available_on_platform: settingsAvailable
              ? isAllowedByAdmin(nextCfg.unlock_vertical, settings, user.id)
              : true,
          }
        : null,
      suggestion: suggestion ?? {
        vertical: 'rides',
        cta_text: 'Where to?',
        cta_deep_link: 'gtaxi://ride',
        reason_code: 'default',
        confidence: 0.4,
      },
    },
  });
});
