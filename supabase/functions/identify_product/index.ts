// Supabase Edge Function: identify_product
// Recognizes products from images and returns detail + localized store promos
// NOW UPGRADED TO USE LIVE GEMINI 1.5 FLASH

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
    const { image, merchant_id } = await req.json();
    if (!image) throw new Error("Image data (base64) required");

    // Clean base64 string if it contains prefix
    const base64Data = image.split(',')[1] || image;

    // --- REAL GEMINI VISION CALL ---
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Identify this grocery or laundry item. Return ONLY a JSON object with: 'name', 'price_cents' (estimate based on item Type), 'category' (Grocery/Laundry), 'description', and 'promo_msg' (a clever 1-sentence marketing message mentioning G-TAXI). Respond in plain JSON without markdown formatting." },
            { 
              inline_data: { 
                mime_type: "image/jpeg", 
                data: base64Data 
              } 
            }
          ]
        }]
      })
    });

    const geminiData = await response.json();
    let aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    // Clean potential markdown from AI response
    aiText = aiText.replace(/```json|```/g, "").trim();
    
    const aiResult = JSON.parse(aiText);

    return new Response(
      JSON.stringify({
        success: true,
        product: {
          name: aiResult.name || "Unknown Product",
          price_cents: aiResult.price_cents || 1000,
          category: aiResult.category || "General",
          description: aiResult.description || "Identified via G-TAXI Vision AI",
          promo_msg: aiResult.promo_msg || "Fresh and fast with G-TAXI!",
          discount_ride_percent: 10
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Vision AI Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
