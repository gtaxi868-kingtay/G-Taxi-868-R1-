// Real-time admin push alert — the missing wire between "a proposal was
// filed" and "an admin's phone actually buzzed in time to act on it."
// Called two ways: (1) from SQL via net.http_post + x-cron-secret, the
// same pattern already used by auto_charge_escape_group and friends;
// (2) directly from another edge function's service-role client.
//
// Uses Expo push (sendExpoPush-equivalent) because it needs no
// FIREBASE_SERVICE_ACCOUNT_JSON secret — that one is a documented
// graceful-degrade gap elsewhere in this project; Expo's own push relay
// works with just the token already stored on profiles.push_token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendExpoPush(token: string | null, title: string, body: string, data?: Record<string, unknown>) {
  if (!token || !token.startsWith("ExponentPushToken[")) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default", data: data ?? {} }),
    });
  } catch (_) { /* non-fatal — same as every other push call site in this codebase */ }
}

async function isAuthorized(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get("x-cron-secret");
  if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !user) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorized(req))) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const { title, body, data } = await req.json();
    if (!title || !body) return json({ success: false, error: "title and body required" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: admins } = await supabase
      .from("profiles")
      .select("push_token")
      .eq("role", "admin")
      .not("push_token", "is", null);

    await Promise.allSettled(
      (admins ?? []).map((a: { push_token: string }) => sendExpoPush(a.push_token, title, body, data)),
    );

    return json({ success: true, notified: admins?.length ?? 0 });
  } catch (err: any) {
    console.error("notify_admins error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
});
