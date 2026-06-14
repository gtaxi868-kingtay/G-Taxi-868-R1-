import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { action } = body;

  if (action === 'list') {
    const { data, error } = await supabase
      .from('pricing_zones')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ zones: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (action === 'create' || action === 'update') {
    const {
      id, name, center_lat, center_lng, radius_meters = 2000,
      multiplier, expires_at, is_active = true, reason,
    } = body;

    if (!center_lat || !center_lng || !multiplier) {
      return new Response(JSON.stringify({ error: 'center_lat, center_lng, multiplier required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (multiplier < 1.0 || multiplier > 5.0) {
      return new Response(JSON.stringify({ error: 'multiplier must be between 1.0 and 5.0' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = {
      name: name ?? `Surge ${new Date().toLocaleTimeString()}`,
      center_lat,
      center_lng,
      radius_meters,
      multiplier,
      expires_at: expires_at ?? null,
      is_active,
      reason: reason ?? null,
      created_by: user.id,
    };

    let result;
    if (action === 'update' && id) {
      const { data, error } = await supabase
        .from('pricing_zones')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      result = data;
    } else {
      const { data, error } = await supabase
        .from('pricing_zones')
        .insert(payload)
        .select()
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      result = data;
    }

    return new Response(JSON.stringify({ zone: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (action === 'deactivate') {
    const { id } = body;
    const { data, error } = await supabase
      .from('pricing_zones')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ zone: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (action === 'delete') {
    const { id } = body;
    await supabase.from('pricing_zones').delete().eq('id', id);
    return new Response(JSON.stringify({ deleted: id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
