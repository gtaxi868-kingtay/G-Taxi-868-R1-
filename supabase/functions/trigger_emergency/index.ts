import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { sendSMS } from "../_shared/sms.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { ride_id } = await req.json();

        if (!ride_id) {
            return new Response(JSON.stringify({ error: "Missing ride_id" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { data: ride, error: rideError } = await supabase
            .from("rides")
            .select("rider_id, driver_id")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            throw new Error(`Ride not found: ${rideError?.message}`);
        }

        if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { data: fullRide } = await supabase
            .from("rides")
            .select("*, rider:rider_id(*), driver:driver_id(*)")
            .eq("id", ride_id)
            .single();

        const lat = fullRide?.driver?.lat;
        const lng = fullRide?.driver?.lng;
        const mapsLink = lat != null && lng != null
            ? `https://maps.google.com/?q=${lat},${lng}`
            : null;

        // Notify the emergency contact of whoever pressed SOS.
        // Riders store contacts on profiles; drivers on the drivers table.
        const isRider = ride.rider_id === user.id;
        let contactName: string | null = null;
        let contactPhone: string | null = null;
        let triggeredByName: string | null = null;

        if (isRider) {
            const { data: profile } = await supabase
                .from("profiles")
                .select("full_name, emergency_contact_name, emergency_contact_phone")
                .eq("id", user.id)
                .single();
            contactName = profile?.emergency_contact_name ?? null;
            contactPhone = profile?.emergency_contact_phone ?? null;
            triggeredByName = profile?.full_name ?? "A G-Taxi rider";
        } else {
            const { data: driver } = await supabase
                .from("drivers")
                .select("name, emergency_contact_name, emergency_contact_phone")
                .eq("id", user.id)
                .single();
            contactName = driver?.emergency_contact_name ?? null;
            contactPhone = driver?.emergency_contact_phone ?? null;
            triggeredByName = driver?.name ?? "A G-Taxi driver";
        }

        let smsResult: { success: boolean; error?: string } = { success: false, error: "No emergency contact on file" };
        if (contactPhone) {
            const vehicle = fullRide?.driver?.plate_number
                ? ` Vehicle: ${fullRide.driver.vehicle_model ?? ""} ${fullRide.driver.plate_number}.`
                : "";
            const message =
                `EMERGENCY ALERT from G-Taxi: ${triggeredByName} pressed the SOS button during a ride.` +
                `${vehicle}` +
                (mapsLink ? ` Last known location: ${mapsLink}` : "") +
                ` If you cannot reach them, call 999.`;
            smsResult = await sendSMS(contactPhone, message);
        }

        await supabase.from("emergency_logs").insert({
            ride_id,
            rider_id: ride.rider_id,
            driver_id: ride.driver_id,
            status: smsResult.success ? "contact_notified" : "triggered",
            metadata: {
                timestamp: new Date().toISOString(),
                triggered_by: user.id,
                rider_name: fullRide?.rider?.full_name,
                driver_name: fullRide?.driver?.name,
                location: { lat, lng },
                emergency_contact_name: contactName,
                emergency_contact_notified: smsResult.success,
                sms_error: smsResult.success ? null : smsResult.error ?? null,
            }
        });

        console.log(`EMERGENCY TRIGGERED for Ride ${ride_id} — contact notified: ${smsResult.success}`);

        return new Response(JSON.stringify({
            success: true,
            contact_notified: smsResult.success,
            message: smsResult.success
                ? "Your emergency contact has been notified by SMS"
                : "Emergency logged. No emergency contact could be notified — add one in Settings.",
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        if (err instanceof Response) return err;
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
