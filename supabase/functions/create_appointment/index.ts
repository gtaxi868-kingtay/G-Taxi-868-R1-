import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      merchant_id,
      service_id,
      scheduled_at,
      pickup_address,
      pickup_lat,
      pickup_lng,
      ride_requested = true,
    } = await req.json();

    if (!merchant_id || !service_id || !scheduled_at) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: merchant_id, service_id, scheduled_at" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: service } = await supabaseAdmin
      .from("merchant_services")
      .select("name, duration_minutes")
      .eq("id", service_id)
      .single();

    if (!service) {
      return new Response(
        JSON.stringify({ success: false, error: "Service not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: appointment, error: insertError } = await supabaseAdmin
      .from("merchant_appointments")
      .insert({
        rider_id: user.id,
        merchant_id,
        service_id,
        scheduled_at,
        ride_requested,
        pickup_address: pickup_address || null,
        pickup_lat: pickup_lat || null,
        pickup_lng: pickup_lng || null,
        merchant_consent_status: "pending",
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create appointment:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create appointment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: merchant } = await supabaseAdmin
      .from("merchants")
      .select("name, created_by")
      .eq("id", merchant_id)
      .single();

    if (merchant?.created_by) {
      const { data: merchantProfile } = await supabaseAdmin
        .from("profiles")
        .select("push_token, full_name")
        .eq("id", merchant.created_by)
        .single();

      if (merchantProfile?.push_token) {
        const { data: riderProfile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();

        const timeStr = new Date(scheduled_at).toLocaleTimeString("en-TT", {
          hour: "2-digit",
          minute: "2-digit",
        });

        sendPushNotification(
          merchantProfile.push_token,
          `New Booking: ${riderProfile?.full_name || "A rider"}`,
          `${service.name} at ${timeStr} — ${merchant?.name || "your shop"}`,
          {
            type: "APPOINTMENT_CREATED",
            appointment_id: appointment.id,
            merchant_id,
          }
        ).catch((err: unknown) => console.error("Merchant push failed:", err));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: { appointment_id: appointment.id },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create_appointment error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});