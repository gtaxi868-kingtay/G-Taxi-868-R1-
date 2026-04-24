// Supabase Edge Function: send_push_notification
// Receives a notification request, fetches the user's push token, and sends via Expo/FCM.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, title, body, data = {} } = await req.json();

    if (!user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "user_id, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Try rider profile first, then driver
    let pushToken: string | null = null;
    let userType = "unknown";

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("push_token")
      .eq("id", user_id)
      .maybeSingle();

    if (profile?.push_token) {
      pushToken = profile.push_token;
      userType = "rider";
    } else {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("push_token")
        .eq("user_id", user_id)
        .maybeSingle();

      if (driver?.push_token) {
        pushToken = driver.push_token;
        userType = "driver";
      }
    }

    if (!pushToken) {
      return new Response(
        JSON.stringify({ error: "No push token found for user", user_id }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Import shared push helper
    const { sendPushNotification } = await import("../_shared/push.ts");

    await sendPushNotification(pushToken, title, body, data);

    return new Response(
      JSON.stringify({ success: true, user_id, user_type: userType, sent: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[send_push_notification] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
