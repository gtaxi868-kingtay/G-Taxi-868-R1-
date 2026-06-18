import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "AC_placeholder";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "token_placeholder";
const TWILIO_FROM_NUMBER = "+1234567890"; // Using standard Twilio number as placeholder

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

    // Get phone number
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
      return new Response(JSON.stringify({ message: "No phone number available for SMS." }), { status: 200, headers: corsHeaders });
    }

    // Get merchant business name
    const { data: merchant } = await supabaseAdmin
      .from("merchants")
      .select("business_name")
      .eq("id", merchant_id)
      .single();

    const merchantName = merchant?.business_name || "a G-Taxi Partner";
    
    // Create tracking / install link
    // In production, use Branch.io or Expo deep linking with referral parameters
    const installLink = `https://gtaxi.app/track/${ride_id}?ref=${merchant_id}`;
    const smsMessage = `Your G-Taxi dispatched by ${merchantName} is arriving soon! Track it live and get 15% off your next personal ride: ${installLink}`;

    // Send SMS via Twilio API
    const authString = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append("To", targetPhone);
    formData.append("From", TWILIO_FROM_NUMBER);
    formData.append("Body", smsMessage);

    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
    });

    if (!twilioRes.ok) {
      // Don't crash if it's the placeholder key
      if (TWILIO_ACCOUNT_SID === "AC_placeholder") {
        console.log(`[DUMMY MODE] Would have sent SMS: ${smsMessage}`);
      } else {
        const errorText = await twilioRes.text();
        throw new Error(`Twilio Error: ${errorText}`);
      }
    } else {
        const result = await twilioRes.json();
        console.log(`Sent Twilio SMS SID: ${result.sid}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error("send_b2b_tracking_sms error:", error);
    await captureException(error, { function: "send_b2b_tracking_sms" });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
