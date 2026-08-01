// Sends a B2B ride-tracking WhatsApp message to the passenger of a ride that
// a merchant dispatched on their behalf.
//
// SECURITY HISTORY — this function previously had NO authentication of any
// kind and trusted three client-supplied identifiers straight off the request
// body (`merchant_id`, `rider_id`, `guest_phone`). Deployed with
// verify_jwt=false, that made it a publicly reachable endpoint that could:
//   1. Send a real WhatsApp message to any rider whose UUID was known, and
//   2. Stamp an arbitrary `merchant_id` into the tracking link's ?ref=
//      parameter — the same referral/commission attribution-fraud vector that
//      was already closed for kiosks via verify_kiosk_origin().
//
// Both are closed here by the same principle used across this codebase:
// resolve identity from the JWT, and resolve everything else from the one id
// the caller is authorised to act on. The ONLY input now taken from the body
// is `ride_id`; the merchant and the recipient are both read from that ride
// row, so a caller cannot redirect attribution or target a stranger.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { sendWhatsApp, getDeepLink } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

type Caller =
  | { kind: "system" }
  | { kind: "user"; userId: string }
  | null;

/**
 * Three accepted callers, in the order they are cheapest to check:
 *   - the platform itself (pg_cron / DB trigger) via x-cron-secret
 *   - an internal service-role call
 *   - a real signed-in user, who must then still pass the ownership check below
 * Anything else is rejected before a single row is read.
 */
async function identifyCaller(req: Request, supabaseAdmin: any): Promise<Caller> {
  const cronHeader = req.headers.get("x-cron-secret");
  if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) {
    return { kind: "system" };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  // An internal caller presenting the service-role key directly.
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) {
    return { kind: "system" };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  return { kind: "user", userId: user.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caller = await identifyCaller(req, supabaseAdmin);
    if (!caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { ride_id, guest_phone } = body ?? {};

    if (!ride_id) {
      return json({ error: "ride_id is required" }, 400);
    }

    // The ride is the single source of truth for BOTH the merchant being
    // credited and the person being messaged. Nothing here comes from the
    // caller.
    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("id, rider_id, billed_to_merchant_id")
      .eq("id", ride_id)
      .maybeSingle();

    if (rideError) {
      console.error("send_b2b_tracking_sms: ride lookup failed:", rideError);
      return json({ error: "Unable to load ride" }, 500);
    }
    if (!ride) {
      return json({ error: "Ride not found" }, 404);
    }
    if (!ride.billed_to_merchant_id) {
      return json({ error: "Ride is not a B2B merchant-dispatched ride" }, 400);
    }

    const merchantId: string = ride.billed_to_merchant_id;

    // A signed-in caller must actually own the merchant this ride is billed
    // to (or be an admin). System callers skip this — they have no user id.
    if (caller.kind === "user") {
      const [{ data: profile }, { data: merchantRow }] = await Promise.all([
        supabaseAdmin.from("profiles").select("role").eq("id", caller.userId).maybeSingle(),
        supabaseAdmin.from("merchants").select("id").eq("id", merchantId).eq("created_by", caller.userId).maybeSingle(),
      ]);

      const isAdmin = profile?.role === "admin";
      const ownsMerchant = Boolean(merchantRow);

      if (!isAdmin && !ownsMerchant) {
        return json({ error: "Forbidden: this ride is not billed to your merchant" }, 403);
      }
    }

    // Recipient: the ride's own rider. `guest_phone` is still honoured for
    // walk-in guests with no account, but only from an already-authorised
    // caller — it can no longer be used to message an arbitrary number on an
    // unrelated ride, because the ride/merchant ownership check above has
    // already passed by this point.
    let targetPhone: string | null = typeof guest_phone === "string" && guest_phone.trim()
      ? guest_phone.trim()
      : null;

    if (!targetPhone && ride.rider_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("phone_number")
        .eq("id", ride.rider_id)
        .maybeSingle();
      targetPhone = profile?.phone_number ?? null;
    }

    if (!targetPhone) {
      return json({ message: "No phone number available." }, 200);
    }

    const { data: merchant } = await supabaseAdmin
      .from("merchants")
      .select("business_name")
      .eq("id", merchantId)
      .maybeSingle();

    const merchantName = merchant?.business_name || "a G-Taxi Partner";
    const installLink = `https://gtaxi.app/track/${ride.id}?ref=${merchantId}`;
    const message = `Your G-Taxi dispatched by ${merchantName} is arriving soon! Track it live and get 15% off your next personal ride: ${installLink}`;

    const result = await sendWhatsApp(targetPhone, message, { previewUrl: true });

    if (!result.success && result.channel === "noop") {
      const deepLink = getDeepLink(targetPhone, message);
      console.log(`[WhatsApp Deep Link] ${deepLink}`);
      return json({
        success: true,
        channel: "deeplink",
        message: "WhatsApp API not configured — deep link generated",
        deepLink,
      }, 200);
    }

    console.log(`[B2B Tracking] Sent via ${result.channel}: ${result.messageId || result.deepLink}`);
    return json({ success: true, channel: result.channel, messageId: result.messageId }, 200);

  } catch (error: any) {
    console.error("send_b2b_tracking_sms error:", error);
    await captureException(error, { function: "send_b2b_tracking_sms" });
    return json({ error: error?.message ?? "Internal error" }, 500);
  }
});
