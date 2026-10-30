import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { requireAuth } from "../_shared/auth.ts"
import { chat, BudgetExceededError, RateLimitedError } from "../_shared/llm.ts"


import { getCorsHeaders } from "../_shared/cors.ts";
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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

    // F4: routed through _shared/llm.ts rather than fetching api.groq.com
    // directly -- this call ran on every ride, uncapped and uncounted by
    // g_config.daily_llm_budget_usd. Now it shares the same budget and
    // provider fallback chain as every other AI feature, and a budget/rate
    // limit is treated as the normal "no suggestions this time" case, same
    // pattern as generate_ai_greeting.
    let parsedSuggestions: any[] = []
    try {
      const aiData = await chat(supabaseAdmin, {
        department: "ai_suggest_stops",
        system: "You are the central geographical reasoning engine for TaxiG in Trinidad and Tobago. Analyze transit vectors and output hyper-local stop options bordering the transit line.",
        messages: [
          {
            role: "user",
            content: `Route traces from [${ride.origin_lat}, ${ride.origin_lng}] to [${ride.dest_lat}, ${ride.dest_lng}]. Generate exactly 2 local points of interest in Trinidad adjacent to this route. Return strictly a raw JSON array containing objects with keys: "name", "reason", and "estimated_delay_mins". No markdown tags.`
          }
        ],
        temperature: 0.3
      })

      const rawContent = aiData?.choices?.[0]?.message?.content?.trim()
      if (rawContent) {
        try {
          parsedSuggestions = JSON.parse(rawContent.replace(/```(?:json)?\n?/g, ''))
        } catch {
          console.warn('[AISuggest] Failed to parse LLM response:', rawContent)
        }
      }
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof RateLimitedError) {
        console.log(`[ai_suggest_stops] falling back, no suggestions: ${err.name}`)
      } else {
        console.error('[ai_suggest_stops] LLM gateway failed:', err)
      }
      return new Response(JSON.stringify({ suggestions: [], fallback: true, message: 'AI unavailable' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (parsedSuggestions.length === 0) {
      return new Response(JSON.stringify({ success: true, suggestions: [], fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Verify before surfacing — the names above are pure LLM output,
    // generated from coordinates alone. A suggestion only becomes real
    // if Mapbox geocodes it to an actual POI near this route (the same
    // geocoding path parse_natural_language uses). Unverifiable
    // suggestions are dropped: never stored, never pushed to a rider
    // mid-ride.
    const MAPBOX_TOKEN = Deno.env.get('MAPBOX_ACCESS_TOKEN') ?? ''
    const TT_BBOX = 'bbox=-61.9311,10.0280,-60.5423,10.8421'
    const midLat = (ride.origin_lat + ride.dest_lat) / 2
    const midLng = (ride.origin_lng + ride.dest_lng) / 2

    // Distance in km from a point to the origin→dest segment
    // (equirectangular approximation — fine at T&T scale).
    const distToRouteKm = (lat: number, lng: number): number => {
      const kx = 111.32 * Math.cos((midLat * Math.PI) / 180)
      const ky = 110.57
      const ax = (ride.origin_lng - lng) * kx, ay = (ride.origin_lat - lat) * ky
      const bx = (ride.dest_lng - lng) * kx, by = (ride.dest_lat - lat) * ky
      const dx = bx - ax, dy = by - ay
      const lenSq = dx * dx + dy * dy
      let t = lenSq === 0 ? 0 : -((ax * dx) + (ay * dy)) / lenSq
      t = Math.max(0, Math.min(1, t))
      const px = ax + t * dx, py = ay + t * dy
      return Math.sqrt(px * px + py * py)
    }

    const verifiedSuggestions: any[] = []
    if (MAPBOX_TOKEN) {
      for (const s of parsedSuggestions) {
        if (!s?.name || typeof s.name !== 'string') continue
        try {
          const geoRes = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(s.name)}.json?` +
            `access_token=${MAPBOX_TOKEN}&proximity=${midLng},${midLat}&${TT_BBOX}&types=poi&limit=1`
          )
          const geoData = await geoRes.json()
          const feature = geoData.features?.[0]
          if (!feature?.geometry?.coordinates) continue
          const [lng, lat] = feature.geometry.coordinates
          if (distToRouteKm(lat, lng) > 8) continue
          verifiedSuggestions.push({
            ...s,
            name: feature.text || s.name,
            address: feature.place_name,
            lat, lng,
            verified: true,
          })
        } catch (err) {
          console.warn('[AISuggest] Geocode verification failed for suggestion:', s.name, err)
        }
      }
    }

    if (verifiedSuggestions.length === 0) {
      return new Response(JSON.stringify({ success: true, suggestions: [], fallback: true, message: 'No verified stops near this route' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    await supabaseAdmin
      .from('ride_suggestions')
      .insert({ ride_id, suggestions: verifiedSuggestions })

    await supabaseAdmin.functions.invoke('send_push_notification', {
      body: {
        user_id: ride.rider_id,
        title: "TaxiG Smart Suggestion ✨",
        body: `Passing near ${verifiedSuggestions[0]?.name}? Tap to adjust your path!`,
        // send_push_notification reads `data`, not `payload` — the old
        // key silently dropped the deep-link payload.
        data: { route: "RideSuggestions", datasets: verifiedSuggestions }
      }
    })

    return new Response(JSON.stringify({ success: true, suggestions: verifiedSuggestions }), {
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
