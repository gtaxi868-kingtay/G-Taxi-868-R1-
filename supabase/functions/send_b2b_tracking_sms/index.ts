import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { sendWhatsApp, getDeepLink } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { ride_id, merchant_id, guest_phone, rider_id } = await req.json();

    if (!ride_id || !merchant_id) {
      return new Response(JSON.stringify({ error: "Missing required payload" }), { status: 400, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let targetPhone = guest_phone;
    if (!targetPhone && rider_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("phone_number")
        .eq("id", rider_id)
        .single();
      targetPhone = profile?.phone_number;
    }

    if (!targetPhone) {
      return new Response(JSON.stringify({ message: "No phone number available." }), { status: 200, headers: corsHeaders });
    }

    const { data: merchant } = await supabaseAdmin
      .from("merchants")
      .select("business_name")
      .eq("id", merchant_id)
      .single();

    const merchantName = merchant?.business_name || "a G-Taxi Partner";
    const installLink = `https://gtaxi.app/track/${ride_id}?ref=${merchant_id}`;
    const message = `Your G-Taxi dispatched by ${merchantName} is arriving soon! Track it live and get 15% off your next personal ride: ${installLink}`;

    const result = await sendWhatsApp(targetPhone, message, { previewUrl: true });

    if (!result.success && result.channel === 'noop') {
      const deepLink = getDeepLink(targetPhone, message);
      console.log(`[WhatsApp Deep Link] ${deepLink}`);
      return new Response(JSON.stringify({
        success: true,
        channel: 'deeplink',
        message: 'WhatsApp API not configured — deep link generated',
        deepLink,
      }), { status: 200, headers: corsHeaders });
    }

    console.log(`[B2B Tracking] Sent via ${result.channel}: ${result.messageId || result.deepLink}`);
    return new Response(JSON.stringify({ success: true, channel: result.channel, messageId: result.messageId }), { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error("send_b2b_tracking_sms error:", error);
    await captureException(error, { function: "send_b2b_tracking_sms" });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
