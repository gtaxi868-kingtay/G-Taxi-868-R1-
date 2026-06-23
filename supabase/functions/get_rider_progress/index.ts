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
  const unlockedVerticals: string[] = prog?.unlocked_verticals ?? ['rides'];

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
    .catch(() => ({ data: null }));

  // Ensure row exists for future calls
  if (!prog) {
    await supabaseAdmin
      .from('rider_progression')
      .insert({ rider_id: user.id })
      .catch(() => {});
  }

  return json({
    success: true,
    data: {
      level,
      level_label: LEVEL_LABELS[level] ?? 'Rider',
      unlocked_verticals: unlockedVerticals,
      total_rides: prog?.total_rides ?? 0,
      total_grocery_orders: prog?.total_grocery_orders ?? 0,
      total_laundry_orders: prog?.total_laundry_orders ?? 0,
      wallet_ever_funded: prog?.wallet_ever_funded ?? false,
      escape_ever_booked: prog?.escape_ever_booked ?? false,
      next_unlock: nextCfg
        ? {
            level: nextCfg.level,
            vertical: nextCfg.unlock_vertical,
            progress: nextUnlockProgress,
            required: nextUnlockRequired,
            label: nextUnlockLabel,
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
