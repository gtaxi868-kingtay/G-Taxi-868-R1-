// Supabase Edge Function: handle_voice
// Processes natural language voice commands to extract intent and target locations
// UPGRADED TO USE LIVE GEMINI 1.5 FLASH

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { text, rider_id } = await req.json();

    if (!text || !rider_id) throw new Error("Text and rider_id required");

    // 1. Fetch Rider's Saved Places
    const { data: places } = await supabaseAdmin
      .from('saved_places')
      .select('label, address, latitude, longitude')
      .eq('user_id', rider_id);

    const placesContext = (places || []).map(p => `${p.label}: ${p.address}`).join(", ");

    // 1.5 Fetch Merchant Service History (Proactive AI Component Phase 8)
    const { data: serviceHistory } = await supabaseAdmin
      .from('user_service_history')
      .select('merchant_id, merchants(name, address, lat, lng)')
      .eq('user_id', rider_id)
      .order('last_visit_at', { ascending: false })
      .limit(3);

    const merchantsContext = (serviceHistory || []).map((h: any) => h.merchants?.name ? `${h.merchants.name} (Address: ${h.merchants.address})` : '').filter(Boolean).join(", ");
    const availableMerchants = (serviceHistory || []).map((h: any) => h.merchants).filter(Boolean);

    // 2. Call Gemini for Intent Extraction
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
      User Command: "${text}"
      User Saved Places: [${placesContext}]
      User Frequently Visited Merchants/Services: [${merchantsContext}]
      
      Extract the user's intent. 
      Options: 
      - "book_ride": User wants to go somewhere.
      - "add_stop": User wants to add a stop.
      - "check_wallet": User asks about balance.
      - "book_service": User asks to visit a merchant (e.g. haircut, food) based on frequency.
      - "chat": General question.

      If "book_ride" or "book_service", find the best match in Saved Places or Merchants by name/label/address.
      If "book_service", your reply MUST proactively suggest: "Setting a course for [Name]. Should I request their next available appointment slot?"

      Return ONLY a JSON object:
      {
        "intent": "book_ride" | "add_stop" | "check_wallet" | "book_service" | "chat",
        "destination": { "label": "Text", "address": "Text", "lat": 0, "lng": 0 } | null,
        "reply": "Short premium response (e.g. 'Setting course for home, Junior is 4 mins away.')"
      }
      Respond in plain JSON only.
    `;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const geminiData = await response.json();
    let aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    aiText = aiText.replace(/```json|```/g, "").trim();
    
    const aiResult = JSON.parse(aiText);

    // 3. If intent is book_ride or book_service, enrich with coordinates from DB if possible
    if ((aiResult.intent === 'book_ride' || aiResult.intent === 'book_service') && aiResult.destination?.label) {
        // Check saved places first
        let mat = (places || []).find(p => p.label.toLowerCase() === aiResult.destination.label.toLowerCase());
        if (mat) {
            aiResult.destination.lat = mat.latitude;
            aiResult.destination.lng = mat.longitude;
            aiResult.destination.address = mat.address;
        } else {
            // Check merchants
            let merch = availableMerchants.find(m => m.name.toLowerCase().includes(aiResult.destination.label.toLowerCase()) || aiResult.destination.label.toLowerCase().includes(m.name.toLowerCase()));
            if (merch) {
                aiResult.destination.lat = merch.lat;
                aiResult.destination.lng = merch.lng;
                aiResult.destination.address = merch.address;
                // If it successfully matched a merchant, auto-upgrade intent to book_service so frontend handles it
                aiResult.intent = 'book_service'; 
            }
        }
    }

    return new Response(
      JSON.stringify({ success: true, ...aiResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Voice AI Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
