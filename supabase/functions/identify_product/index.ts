// Supabase Edge Function: identify_product
// Recognizes products from images and returns detail + localized store promos
// NOW UPGRADED TO USE LIVE GEMINI 1.5 FLASH

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiFetch } from "../_shared/networkUtility.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
// gemini-1.5-flash was retired by Google, so every photo failed. Same model
// default as _shared/llm.ts; override with the GEMINI_MODEL secret.
const GEMINI_VISION_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Sign-in required (this called the paid Gemini API for anyone on the
    // internet, outside the AI budget), plus a per-user rate limit.
    const authHeader = req.headers.get("Authorization") ?? "";
    const gate = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user: caller } } = await gate.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!caller) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const limit = await checkRateLimit(gate, caller.id, "identify_product");
    if (!limit.allowed) {
      return new Response(JSON.stringify({ success: false, error: limit.error || "Too many photos, try again later." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { image, merchant_id } = await req.json();
    if (!image) throw new Error("Image data (base64) required");

    // Clean base64 string if it contains prefix
    const base64Data = image.split(',')[1] || image;

    // --- REAL GEMINI VISION CALL ---
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await aiFetch(geminiUrl, {
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
    
    let aiResult: any = {};
    try { aiResult = JSON.parse(aiText); } catch { aiResult = {}; }

    // Never invent a product: if the AI could not name it AND give a price,
    // say so (the app shows "Not Recognized") instead of the old
    // "Unknown Product, TT$10.00" placeholder. The price is an AI estimate,
    // not a store price, and is labelled as such in the app.
    const priceCents = Number(aiResult.price_cents);
    if (!aiResult.name || !Number.isFinite(priceCents) || priceCents <= 0) {
      return new Response(
        JSON.stringify({ success: true, product: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        product: {
          name: aiResult.name,
          price_cents: Math.round(priceCents),
          price_is_estimate: true,
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
