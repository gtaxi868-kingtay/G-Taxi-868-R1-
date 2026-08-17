import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { aiFetch } from "../_shared/networkUtility.ts";
import { chat, BudgetExceededError, RateLimitedError } from "../_shared/llm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // a 30s voice command is a few hundred KB at most

// Transcribes a recorded clip via Groq's hosted Whisper endpoint directly
// (Whisper is not a chat-completions model, so it doesn't go through the
// _shared/llm.ts gateway -- that gateway is for the budget-metered chat call
// below). Reuses GROQ_API_KEY, already configured -- no new secret required.
async function transcribeAudio(audioFile: File): Promise<string> {
  const groqForm = new FormData();
  groqForm.append("file", audioFile, audioFile.name || "voice.m4a");
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("response_format", "json");

  const groqRes = await aiFetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: groqForm,
  });

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    console.error("Groq transcription error:", errText);
    throw new Error("Transcription failed");
  }

  const groqData = await groqRes.json();
  return (groqData.text || "").trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: "GROQ_API_KEY not configured" }), { status: 503, headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const rateCheck = await checkRateLimit(supabaseAdmin, user.id, "handle_voice");
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ success: false, error: rateCheck.error }), { status: 429, headers: corsHeaders });
    }

    // Two shapes are accepted:
    //   - application/json { text, rider_id } -- the original, still-supported
    //     path (typed voice-command modal).
    //   - multipart/form-data { audio, rider_id } -- a real recorded clip from
    //     the mic, previously nowhere in this app: the rider app's "AI Voice
    //     Command" modal was a mislabeled text input with no actual voice
    //     recognition. Transcribed here via Whisper before falling into the
    //     exact same intent-parsing path below, so nothing downstream changes.
    const contentType = req.headers.get("content-type") || "";
    let text: string;
    let rider_id: string;

    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const audioFile = form.get("audio");
      rider_id = String(form.get("rider_id") || "");
      if (!(audioFile instanceof File)) throw new Error("Missing 'audio' file field");
      if (audioFile.size > MAX_AUDIO_BYTES) throw new Error("Audio clip too large");
      text = await transcribeAudio(audioFile);
      if (!text) throw new Error("Could not understand the recording");
    } else {
      const body = await req.json();
      text = body.text;
      rider_id = body.rider_id;
    }

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

    let groqData: any;
    try {
      groqData = await chat(supabaseAdmin, {
        department: "handle_voice",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 500,
        temperature: 0.7,
      });
    } catch (err) {
      // Budget/rate-limit are expected, normal outcomes (CLAUDE.md AI spend
      // rules) -- degrade to a deterministic reply instead of a broken
      // screen. The user still gets their transcript back so the typed-text
      // fallback in the app can pick it up.
      if (err instanceof BudgetExceededError || err instanceof RateLimitedError) {
        return new Response(
          JSON.stringify({
            success: true,
            transcript: text,
            intent: "chat",
            destination: null,
            reply: "I heard you, but I'm at capacity right now — please try again in a moment.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw err;
    }

    let aiText = groqData.choices?.[0]?.message?.content;
    if (!aiText) {
      console.error("Groq intent-parse call returned no content:", JSON.stringify(groqData));
      throw new Error("AI intent parsing failed");
    }
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
      JSON.stringify({ success: true, transcript: text, ...aiResult }),
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
