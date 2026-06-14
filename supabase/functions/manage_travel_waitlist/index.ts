import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_DESTINATION_CODES = new Set([
  'TAB', 'BGI', 'GND', 'ANU', 'SKB', 'SLU', 'SXM', 'HAV',
]);
const MAX_WAITLIST_ENTRIES = 8;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const authHeader = req.headers.get('Authorization');
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { add = [], remove = [] } = body as { add: string[]; remove: string[] };

  // Validate destination codes
  const invalidAdd = add.filter((c: string) => !VALID_DESTINATION_CODES.has(c));
  const invalidRemove = remove.filter((c: string) => !VALID_DESTINATION_CODES.has(c));
  if (invalidAdd.length || invalidRemove.length) {
    return new Response(JSON.stringify({ error: 'Invalid destination codes', invalid: [...invalidAdd, ...invalidRemove] }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: count current entries
  const { count } = await supabase
    .from('travel_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const currentCount = count ?? 0;
  const netAdded = add.length - remove.length;
  if (currentCount + netAdded > MAX_WAITLIST_ENTRIES) {
    return new Response(JSON.stringify({ error: `Maximum ${MAX_WAITLIST_ENTRIES} destinations allowed on waitlist` }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const errors: string[] = [];

  // Add entries (upsert to handle duplicates gracefully)
  if (add.length > 0) {
    const { error: addErr } = await supabase
      .from('travel_waitlist')
      .upsert(
        add.map((code: string) => ({
          user_id: user.id,
          destination_code: code,
        })),
        { onConflict: 'user_id,destination_code' }
      );
    if (addErr) errors.push(`Add failed: ${addErr.message}`);
  }

  // Remove entries — enforce user_id so user can only remove their own rows
  if (remove.length > 0) {
    const { error: removeErr } = await supabase
      .from('travel_waitlist')
      .delete()
      .eq('user_id', user.id)
      .in('destination_code', remove);
    if (removeErr) errors.push(`Remove failed: ${removeErr.message}`);
  }

  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: errors.join('; ') }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Return updated waitlist
  const { data: updated } = await supabase
    .from('travel_waitlist')
    .select('destination_code, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  return new Response(JSON.stringify({
    success: true,
    waitlist: updated ?? [],
    added: add.length,
    removed: remove.length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
