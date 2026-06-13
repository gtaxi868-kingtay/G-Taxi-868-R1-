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

  if (action === 'create') {
    const {
      property_id, merchant_id,
      tier_1_rooms = 150, tier_1_equity_pct = 5.00,
      tier_2_rooms = 400, tier_2_equity_pct = 10.00,
      capital_deployed_cents = 0, legal_document_url, notes,
    } = body;

    if (!property_id || !merchant_id) {
      return new Response(JSON.stringify({ error: 'property_id and merchant_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let capital_reserve_entry_id: string | null = null;
    if (capital_deployed_cents > 0) {
      const { data: reserveRow, error: reserveErr } = await supabase
        .from('capital_reserve_ledger')
        .insert({
          source: 'equity_deployment',
          amount_cents: capital_deployed_cents,
          status: 'deployed',
          notes: `Equity contract for property ${property_id}`,
        })
        .select('id')
        .single();
      if (reserveErr) {
        return new Response(JSON.stringify({ error: reserveErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      capital_reserve_entry_id = reserveRow.id;
    }

    const { data: contract, error: contractErr } = await supabase
      .from('equity_contracts')
      .insert({
        property_id, merchant_id,
        status: 'proposed',
        tier_1_rooms, tier_1_equity_pct,
        tier_2_rooms, tier_2_equity_pct,
        capital_deployed_cents,
        capital_reserve_entry_id,
        legal_document_url,
        notes,
      })
      .select()
      .single();

    if (contractErr) {
      return new Response(JSON.stringify({ error: contractErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: merchantData } = await supabase
      .from('merchants')
      .select('created_by')
      .eq('id', merchant_id)
      .single();
    if (merchantData?.created_by) {
      await supabase.from('push_queue').insert({
        user_id: merchantData.created_by,
        title: 'Equity Proposal Received',
        body: `G-Taxi has proposed an equity partnership for your property. Review the terms.`,
        data: { type: 'equity_proposal', contract_id: contract.id },
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ contract }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'update_status') {
    const { contract_id, status } = body;
    const validStatuses = ['proposed', 'countered', 'signed', 'active', 'vested', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const updates: any = { status, updated_at: new Date().toISOString() };
    if (status === 'signed') updates.signed_at = new Date().toISOString();

    const { data: contract, error } = await supabase
      .from('equity_contracts')
      .update(updates)
      .eq('id', contract_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ contract }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'record_nights') {
    const { contract_id, nights_delivered } = body;
    if (!contract_id || !nights_delivered) {
      return new Response(JSON.stringify({ error: 'contract_id and nights_delivered required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('equity_contracts')
      .select('*')
      .eq('id', contract_id)
      .single();
    if (fetchErr || !existing) {
      return new Response(JSON.stringify({ error: 'Contract not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newTotal = existing.current_room_nights_delivered + nights_delivered;
    let newEquityPct = existing.current_equity_pct;
    let milestone: string | null = null;

    if (newTotal >= existing.tier_2_rooms && existing.current_equity_pct < existing.tier_1_equity_pct + existing.tier_2_equity_pct) {
      newEquityPct = existing.tier_1_equity_pct + existing.tier_2_equity_pct;
      milestone = `Tier 2 reached: ${newEquityPct}% equity vested`;
    } else if (newTotal >= existing.tier_1_rooms && existing.current_equity_pct < existing.tier_1_equity_pct) {
      newEquityPct = existing.tier_1_equity_pct;
      milestone = `Tier 1 reached: ${newEquityPct}% equity vested`;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('equity_contracts')
      .update({
        current_room_nights_delivered: newTotal,
        current_equity_pct: newEquityPct,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contract_id)
      .select()
      .single();

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (milestone) {
      const { data: merchantData } = await supabase
        .from('merchants')
        .select('created_by')
        .eq('id', existing.merchant_id)
        .single();
      if (merchantData?.created_by) {
        await supabase.from('push_queue').insert({
          user_id: merchantData.created_by,
          title: 'Equity Milestone Reached!',
          body: milestone,
          data: { type: 'equity_milestone', contract_id },
        }).catch(() => {});
      }
    }

    return new Response(JSON.stringify({ contract: updated, milestone }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'delete') {
    const { contract_id } = body;
    await supabase.from('equity_contracts').delete().eq('id', contract_id);
    return new Response(JSON.stringify({ deleted: contract_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
