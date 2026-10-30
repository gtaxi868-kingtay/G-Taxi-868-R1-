import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { secretMatches } from "../_shared/constantTime.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Dual-path auth.
    // Path 1 — user JWT (apps, admin web): the caller may push to
    //   themselves, or to another user only with the admin role.
    // Path 2 — service-role bearer: every server-side caller
    //   (daily_push_notifications, ai_suggest_stops, travel,
    //   commander_gateway, ...) presents the service-role key.
    //   requireAuth alone rejected that key as "not a user token", so
    //   every one of those internal pushes failed — silently, because
    //   the callers don't check the result. The key is compared in
    //   constant time via secretMatches, fail-closed on unset env.
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const serviceRoleKeys = [
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    ];
    let isServiceRole = false;
    for (const key of serviceRoleKeys) {
      if (key && await secretMatches(bearer, key)) {
        isServiceRole = true;
        break;
      }
    }

    let user: any = null;
    if (!isServiceRole) {
      user = await requireAuth(req);
    }

    const { user_id, title, body, data = {} } = await req.json();

    if (!user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "user_id, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limit (RATE_LIMITS.send_push_notification = 30/60s) — the
    // config existed but was never applied. JWT callers are limited per
    // caller; service-role callers per target user, so a looping
    // internal caller cannot spam one person's phone either.
    if (isServiceRole) {
      await enforceRateLimit(supabaseAdmin, user_id, "send_push_notification", corsHeaders);
    } else {
      await enforceRateLimit(supabaseAdmin, user.id, "send_push_notification", corsHeaders);

      if (user_id !== user.id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

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

    const { sendPushNotification } = await import("../_shared/push.ts");

    await sendPushNotification(pushToken, title, body, data);

    return new Response(
      JSON.stringify({ success: true, user_id, user_type: userType, sent: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[send_push_notification] Error:", err.message);
    if (err instanceof Response) return err;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
