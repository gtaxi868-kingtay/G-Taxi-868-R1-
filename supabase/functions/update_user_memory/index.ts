// Update user memory after ride completion
// Stores ride patterns for AI personalization

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, ride_id, direction, hour, day_of_week, payment_method, had_stop } = await req.json();

    if (!user_id || !ride_id) {
      return new Response(
        JSON.stringify({ error: 'user_id and ride_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create memory text summary
    const memoryText = `Rider traveled ${direction || 'unknown direction'} at ${hour}:00 on day ${day_of_week}. ${had_stop ? 'Made a stop.' : 'Direct trip.'} Paid ${payment_method || 'unknown'}.`;

    // Simple embedding using hash of text (production would use Gemini embeddings)
    const encoder = new TextEncoder();
    const data = encoder.encode(memoryText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const embedding = hashArray.slice(0, 768).map(b => b / 255); // Normalize to 768 dims

    // Insert into user_memories
    const { error } = await supabaseAdmin
      .from('user_memories')
      .insert({
        user_id,
        memory_text: memoryText,
        embedding,
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
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
