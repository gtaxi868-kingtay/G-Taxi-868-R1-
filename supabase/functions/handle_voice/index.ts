import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { aiFetch } from "../_shared/networkUtility.ts";
import { GROQ_CHAT_MODEL, isGptOss } from "../_shared/ai_model.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: "GROQ_API_KEY not configured" }), { status: 503, headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { text, rider_id } = await req.json();

    if (!text || !rider_id) throw new Error("Text and rider_id required");
    if (rider_id !== user.id) throw new Error("Forbidden");

    const { data: places } = await supabaseAdmin
      .from('saved_places')
      .select('label, address, latitude, longitude')
      .eq('user_id', rider_id);

    const placesContext = (places || []).map(p => `${p.label}: ${p.address}`).join(", ");

    const { data: serviceHistory } = await supabaseAdmin
      .from('user_service_history')
      .select('merchant_id, merchants(name, address, lat, lng)')
      .eq('user_id', rider_id)
      .order('last_visit_at', { ascending: false })
      .limit(3);

    const merchantsContext = (serviceHistory || []).map((h: any) => h.merchants?.name ? `${h.merchants.name} (Address: ${h.merchants.address})` : '').filter(Boolean).join(", ");
    const availableMerchants = (serviceHistory || []).map((h: any) => h.merchants).filter(Boolean);

    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
    
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

    // GPT-OSS spends completion tokens on hidden reasoning before the visible
    // answer, so a tight max_tokens returns empty content with a 200. Budget
    // raised and reasoning_effort turned down, matching the gateway's floor —
    // see _shared/llm.ts for the measured case (254 of 256 tokens on reasoning).
    const useLowReasoning = isGptOss(GROQ_CHAT_MODEL);
    const groqBody: Record<string, unknown> = {
      model: GROQ_CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.7
    };
    if (useLowReasoning) groqBody.reasoning_effort = "low";

    const response = await aiFetch(groqUrl, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(groqBody)
    });

    const groqData = await response.json();
    let aiText = groqData.choices?.[0]?.message?.content || "{}";
    aiText = aiText.replace(/```json|```/g, "").trim();
    
    const aiResult = JSON.parse(aiText);

    if ((aiResult.intent === 'book_ride' || aiResult.intent === 'book_service') && aiResult.destination?.label) {
        let mat = (places || []).find(p => p.label.toLowerCase() === aiResult.destination.label.toLowerCase());
        if (mat) {
            aiResult.destination.lat = mat.latitude;
            aiResult.destination.lng = mat.longitude;
            aiResult.destination.address = mat.address;
        } else {
            let merch = availableMerchants.find(m => m.name.toLowerCase().includes(aiResult.destination.label.toLowerCase()) || aiResult.destination.label.toLowerCase().includes(m.name.toLowerCase()));
            if (merch) {
                aiResult.destination.lat = merch.lat;
                aiResult.destination.lng = merch.lng;
                aiResult.destination.address = merch.address;
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
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
