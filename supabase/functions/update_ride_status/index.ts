// Supabase Edge Function: update_ride_status
// Enforces GPS truth constraints for ride state transitions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { sendWhatsApp } from "../_shared/sms.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Haversine Distance Helper ---
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization", data: null }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token", data: null }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    const { ride_id, status, driver_lat, driver_lng, pin, entertainment_status, route_geometry } = await req.json();

    if (!ride_id) {
      return new Response(
        JSON.stringify({ success: false, error: "ride_id required", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isMetadataOnly = !status && (entertainment_status !== undefined || route_geometry !== undefined);

    if (status && status !== 'arrived' && status !== 'in_progress') {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid status for this function. Use complete_ride for completion.", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", ride_id)
      .single();

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ success: false, error: "Ride not found", data: null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only the assigned driver can update the ride.
    // rides.driver_id holds drivers.id (set by accept_ride/match_driver), which
    // is not the auth uid for most drivers — resolve via drivers.user_id.
    if (ride.driver_id !== userId) {
      const { data: driverRecord } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!driverRecord || ride.driver_id !== driverRecord.id) {
        return new Response(
          JSON.stringify({ success: false, error: "Not authorized. Only the assigned driver can update this ride.", data: null }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!isMetadataOnly) {
      // --- GPS TRUTH ENFORCEMENT ---
      if (status === 'arrived') {
        if (!driver_lat || !driver_lng) {
          return new Response(
            JSON.stringify({ success: false, error: "GPS coordinates required to mark arrived", data: null }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const distMeters = getDistanceMeters(
          driver_lat, driver_lng,
          ride.pickup_lat, ride.pickup_lng
        );

        // Cannot tap "Arrived" if more than 120m away from pickup
        if (distMeters > 120) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Too far from pickup. You are ${Math.round(distMeters)}m away (max 120m).`,
              data: { distance: distMeters }
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // --- PIN VERIFICATION ---
      if (status === 'in_progress') {
        if (!pin) {
          return new Response(
            JSON.stringify({ success: false, error: "Rider PIN required to start trip", data: null }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // --- GPS TRUTH ON PIN LOCK ---
        // The PIN must be entered at the pickup point, not relayed remotely.
        if (!driver_lat || !driver_lng) {
          return new Response(
            JSON.stringify({ success: false, error: "GPS coordinates required to start trip", data: null }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const pinDistMeters = getDistanceMeters(
          driver_lat, driver_lng,
          ride.pickup_lat, ride.pickup_lng
        );

        if (pinDistMeters > 120) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Too far from pickup to start trip. You are ${Math.round(pinDistMeters)}m away (max 120m).`,
              data: { distance: pinDistMeters }
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (ride.ride_pin !== pin) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid PIN. Please ask the rider for their 4-digit code.", data: null }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // --- MERCHANT TRUST LAYER: PHOTO ENFORCEMENT ---
        if (ride.order_id) {
            const { data: log, error: logError } = await supabaseAdmin
                .from('merchant_intake_logs')
                .select('photo_urls')
                .eq('order_id', ride.order_id)
                .maybeSingle();

            if (!log || !log.photo_urls || log.photo_urls.length === 0) {
                return new Response(
                    JSON.stringify({ success: false, error: "PHOTO_REQUIRED: Merchant photo proof required before pickup.", data: null }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }
      }
    }

    // ATOMIC RECORD UPDATE
    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      updatePayload.status = status;
    }

    if (entertainment_status !== undefined) {
      updatePayload.entertainment_status = entertainment_status;
    }

    if (route_geometry !== undefined) {
      updatePayload.route_geometry = route_geometry;
    }

    if (status === 'arrived') {
      updatePayload.arrived_at = new Date().toISOString();
    }

    if (status === 'in_progress' || status === 'arrived') {
      // --- METER SWITCH LOGIC (No Double-Charge) ---
      // If the car is stationary at a stop, we suppress travel fees and only charge the Wait Clock.
      if (ride.arrived_at) {
        const arrivalTime = new Date(ride.arrived_at).getTime();
        const now = new Date().getTime();
        const waitMinutes = (now - arrivalTime) / (1000 * 60);

        if (waitMinutes > 0) {
            updatePayload.wait_fee_cents = Math.floor(waitMinutes * 100);
            updatePayload.is_stationary = true;
        }
      }
    }

    // Determine the valid previous state (only for status transitions)
    let query = supabaseAdmin
      .from("rides")
      .update(updatePayload)
      .eq("id", ride_id);

    if (status) {
      const validPreviousStates = status === 'arrived' ? ['assigned'] : ['arrived'];
      query = query.in("status", validPreviousStates);
    }

    const { error: updateError, count } = await query;

    // ── Out-of-app notification to Rider on Arrival ──────────────────────
    // Push AND WhatsApp/SMS so the rider gets "driver arrived" even if their
    // app is closed or their data connection dropped during the wait. The
    // WhatsApp send noops gracefully until the Cloud API creds are set.
    if (status === 'arrived' && ride.rider_id) {
        const { data: riderProfile } = await supabaseAdmin
            .from('profiles')
            .select('push_token, phone_number')
            .eq('id', ride.rider_id)
            .single();

        if (riderProfile?.push_token) {
            sendPushNotification(
                riderProfile.push_token,
                '🚖 Driver Arrived',
                'Your driver has arrived at the pickup location. Please meet them there.',
                { type: 'DRIVER_ARRIVED', ride_id: ride.id }
            ).catch(err => console.error("Arrival push failed:", err));
        }

        if (riderProfile?.phone_number) {
            sendWhatsApp(
                riderProfile.phone_number,
                `G-Taxi: your driver has ARRIVED at the pickup location. Please head out to meet them. (Ride ${String(ride.id).slice(0, 8)})`
            ).catch(err => console.error("Arrival WhatsApp/SMS failed (non-fatal):", err));
        }
    }

    if (updateError || (status && count === 0)) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update ride: invalid current state", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: { ride_id, status: status || ride.status },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Update ride status error:", error);
    await captureException(error, { function: "update_ride_status" });
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error: " + error.message, data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
