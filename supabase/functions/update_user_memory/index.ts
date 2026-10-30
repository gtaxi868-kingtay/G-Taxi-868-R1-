import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';
import { embedText } from '../_shared/embeddings.ts';


import { getCorsHeaders } from '../_shared/cors.ts'
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);

    const { user_id, ride_id, direction, hour, day_of_week, payment_method, had_stop } = await req.json();

    if (!user_id || !ride_id) {
      return new Response(
        JSON.stringify({ error: 'user_id and ride_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const memoryText = `Rider traveled ${direction || 'unknown direction'} at ${hour}:00 on day ${day_of_week}. ${had_stop ? 'Made a stop.' : 'Direct trip.'} Paid ${payment_method || 'unknown'}.`;

    // Real embeddings only, via the shared gateway. The old code
    // fabricated an "embedding" from a SHA-256 digest — 32 real values
    // in a vector(768) NOT NULL column — so the insert failed and this
    // function 500'd on EVERY call (see _shared/embeddings.ts: a hash
    // has no semantic geometry; never fabricate a vector).
    // g_memory_write was considered and rejected as the route: it
    // writes the Jarvis memory store (public.g_memory), not this
    // function's rider-pattern table (public.user_memories) — a
    // different table with different consumers.
    const { vector } = await embedText(supabaseAdmin, memoryText, 'update_user_memory');

    if (!vector) {
      // No embedding provider configured/reachable, and
      // user_memories.embedding is NOT NULL — there is no honest row
      // to write. Store nothing and say so plainly. The only caller
      // (rider ActiveRideScreen) invokes this fire-and-forget and
      // ignores the response body, so this signal cannot crash it.
      console.warn('[update_user_memory] Embedding unavailable; memory not stored for ride', ride_id);
      return new Response(
        JSON.stringify({ success: false, stored: false, reason: 'embedding_unavailable', memory: memoryText }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error } = await supabaseAdmin
      .from('user_memories')
      .insert({
        user_id,
        memory_text: memoryText,
        embedding: vector,
        metadata: {
          ride_id,
          direction,
          hour,
          day_of_week,
          payment_method,
          had_stop
        }
      });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, memory: memoryText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    if (err instanceof Response) return err;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
