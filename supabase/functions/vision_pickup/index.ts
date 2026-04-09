// supabase/functions/vision_pickup/index.ts
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
    const { image, lat, lng } = await req.json();

    if (!image) throw new Error("Image (base64) is required");

    // 1. Initialize Gemini with Vision
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `
      You are the G-TAXI AI Navigation Dispatcher for Trinidad and Tobago. 
      The user has sent a photo and their current estimated GPS is (${lat}, ${lng}).
      
      TASK:
      1. Identify the specific landmark, building, or street corner in the photo. 
      2. Use the GPS as a hint (e.g. if near POS, check for The Savannah, NAPA, or Hyatt).
      3. Be specific (e.g. "The Breakfast Shed" instead of "a restaurant").
      
      Return ONLY a JSON object:
      {
        "success": true,
        "landmark_name": "Name of the place",
        "address": "Nearest street address or descriptive location",
        "refined_lat": 0, // Predicted latitude (use GPS hint if close)
        "refined_lng": 0, // Predicted longitude (use GPS hint if close)
        "explanation": "Briefly explain what you see (e.g. 'I see the Brian Lara Promenade clock tower.')"
      }
      If you cannot identify the location, return success: false.
    `;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: image // Assuming base64
              }
            }
          ]
        }]
      })
    });

    const geminiData = await response.json();
    let aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    aiText = aiText.replace(/```json|```/g, "").trim();
    
    const result = JSON.parse(aiText);

    // If coordinates are missing from AI, use the hints provided
    if (result.success && (!result.refined_lat || result.refined_lat === 0)) {
        result.refined_lat = lat;
        result.refined_lng = lng;
    }

    return new Response(
      JSON.stringify(result),
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
