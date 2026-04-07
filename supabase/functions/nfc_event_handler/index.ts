// Supabase Edge Function: nfc_event_handler
// The Intelligence behind the G-Taxi Unified Handshake.
// Interprets Stationary Kiosk Taps & Personal Key Actions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tag_uid, profile_id, lat, lng } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Resolve the Kiosk Node
    const { data: kiosk } = await supabase
      .from('kiosk_nodes')
      .select('*, merchant:merchant_id(*)')
      .eq('tag_uid', tag_uid)
      .eq('is_active', true)
      .single();

    if (!kiosk) {
       // If not a stationary kiosk, check if it's a personal tag for restore/ID logic
       return new Response(JSON.stringify({ 
         type: 'PERSONAL_TAG', 
         message: "Personal Identity Tag detected. No Kiosk context found." 
       }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Fetch Nearby Logistics Partners (Simple choice: Grocery/Laundry)
    const { data: partners } = await supabase
      .from('merchants')
      .select('id, name, category')
      .in('category', ['grocery', 'laundry'])
      .limit(5);

    // 3. Get personalized AI greeting via Gemini
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', profile_id).single();
    
    const prompt = `
      User: ${profile?.full_name || 'Guest'}
      Location: ${kiosk.location_name} (a G-Taxi Kiosk at ${kiosk.merchant?.name || 'a major hub'})
      Partners: ${partners?.map(p => `${p.name} (${p.category})`).join(', ') || 'None found'}
      
      TASK: Write a 10-word greeting that welcomes them to the hub and mentions that they can add grocery or laundry to their ride with "ONE TAP".
      Example: "Welcome to Piarco! Add Grocery or Laundry to your ride in ONE TAP."
    `;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 60 }
      })
    });

    const geminiData = await geminiRes.json();
    const welcomeMessage = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || `Welcome to ${kiosk.location_name}.`;

    // 4. Return the Unified Handshake Payload
    return new Response(JSON.stringify({
      type: 'KIOSK_HANDSHAKE',
      welcomeMessage,
      kioskId: kiosk.id,
      locationName: kiosk.location_name,
      pickupCoords: { lat: kiosk.lat, lng: kiosk.lng },
      availableServices: partners?.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        icon: p.category === 'grocery' ? 'cart' : 'shirt'
      })) || []
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
