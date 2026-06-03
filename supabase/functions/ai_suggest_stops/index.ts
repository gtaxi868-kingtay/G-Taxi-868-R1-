import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { requireAuth } from "../_shared/auth.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)
    const { ride_id } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('id, origin_lat, origin_lng, dest_lat, dest_lng, rider_id')
      .eq('id', ride_id)
      .single()

    if (rideError || !ride) throw new Error('Target ride coordinates missing.')
    if (ride.rider_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: you do not own this ride.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groqPayload = {
      model: "llama-3.1-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are the central geographical reasoning engine for TaxiG in Trinidad and Tobago. Analyze transit vectors and output hyper-local stop options bordering the transit line."
        },
        {
          role: "user",
          content: `Route traces from [${ride.origin_lat}, ${ride.origin_lng}] to [${ride.dest_lat}, ${ride.dest_lng}]. Generate exactly 2 local points of interest in Trinidad adjacent to this route. Return strictly a raw JSON array containing objects with keys: "name", "reason", and "estimated_delay_mins". No markdown tags.`
        }
      ],
      temperature: 0.3
    }

    const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(groqPayload)
    })

    const aiData = await aiResponse.json()
    if (!aiResponse.ok) throw new Error(aiData.error?.message || 'Groq API returned an error status.')

    const rawContent = aiData.choices[0].message.content.trim()
    const parsedSuggestions = JSON.parse(rawContent)

    await supabaseAdmin
      .from('ride_suggestions')
      .insert({ ride_id, suggestions: parsedSuggestions })

    await supabaseAdmin.functions.invoke('send_push_notification', {
      body: {
        user_id: ride.rider_id,
        title: "TaxiG Smart Suggestion ✨",
        body: `Passing near ${parsedSuggestions[0].name}? Tap to adjust your path!`,
        payload: { route: "RideSuggestions", datasets: parsedSuggestions }
      }
    })

    return new Response(JSON.stringify({ success: true, suggestions: parsedSuggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    })
  }
})
