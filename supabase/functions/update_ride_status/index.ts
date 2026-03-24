// Supabase Edge Function: update_ride_status
// Enforces GPS truth constraints for ride state transitions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { ride_id, status, driver_lat, driver_lng, pin } = await req.json();

    if (!ride_id || !status) {
      return new Response(
        JSON.stringify({ success: false, error: "ride_id and status required", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (status !== 'arrived' && status !== 'in_progress') {
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

    // Only the assigned driver can update the status
    if (ride.driver_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Not authorized. Only the assigned driver can update status.", data: null }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      if (ride.ride_pin !== pin) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid PIN. Please ask the rider for their 4-digit code.", data: null }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ATOMIC RECORD UPDATE
    // Determine the valid previous state
    const validPreviousStates = status === 'arrived' ? ['assigned'] : ['arrived'];

    const { error: updateError, count } = await supabaseAdmin
      .from("rides")
      .update({
        status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ride_id)
      .in("status", validPreviousStates); // ATOMIC GUARD

    if (updateError || count === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update ride: invalid current state", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: { ride_id, status },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Update ride status error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error: " + error.message, data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
