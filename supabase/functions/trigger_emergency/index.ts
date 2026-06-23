import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { sendSMS } from "../_shared/sms.ts";
import { sendPushNotification } from "../_shared/push.ts";

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
            .select("*, rider:rider_id(id, full_name, phone, emergency_contact_name, emergency_contact_phone), driver:driver_id(id, name, phone, lat, lng)")
            .eq("id", ride_id)
            .single();

        await supabase.from("emergency_logs").insert({
            ride_id,
            rider_id: ride.rider_id,
            driver_id: ride.driver_id,
            status: "triggered",
            metadata: {
                timestamp: new Date().toISOString(),
                rider_name: fullRide?.rider?.full_name,
                driver_name: fullRide?.driver?.name,
                driver_phone: fullRide?.driver?.phone,
                location: { lat: fullRide?.driver?.lat, lng: fullRide?.driver?.lng },
            },
        });

        console.log(`🚨 EMERGENCY TRIGGERED for Ride ${ride_id}`);

        const riderName = fullRide?.rider?.full_name || "A rider";
        const driverName = fullRide?.driver?.name || "your driver";
        const driverPhone = fullRide?.driver?.phone || "N/A";
        const riderPhone = fullRide?.rider?.phone;
        const emergencyName = fullRide?.rider?.emergency_contact_name;
        const emergencyPhone = fullRide?.rider?.emergency_contact_phone;

        // ── Send push notification to the rider who triggered it ──
        const { data: riderProfile } = await supabase
            .from("profiles")
            .select("push_token")
            .eq("id", ride.rider_id)
            .single();

        if (riderProfile?.push_token) {
            await sendPushNotification(
                riderProfile.push_token,
                "🚨 Emergency Alert Sent",
                `Your emergency contact${emergencyName ? ` (${emergencyName})` : ""} has been notified. Help is on the way.`,
                { type: "emergency_acknowledged", ride_id }
            );
        }

        // ── Send SMS to emergency contact if one is saved ──
        if (emergencyPhone) {
            const smsMessage = `🚨 EMERGENCY — ${riderName} triggered an alert during their ride with ${driverName} (${driverPhone}). Location: ${fullRide?.driver?.lat},${fullRide?.driver?.lng}`;
            const smsResult = await sendSMS(emergencyPhone, smsMessage);
            console.log(`SMS to emergency contact (${emergencyName}):`, smsResult.success ? "sent" : "failed");
        } else {
            console.warn("No emergency contact phone on file for rider");
        }

        // ── Fallback: send SMS to rider's own phone if no emergency contact ──
        if (!emergencyPhone && riderPhone) {
            const smsMessage = `🚨 G-Taxi Emergency Confirmation — Your alert for ride ${ride_id.slice(0, 8)} has been logged. A safety specialist will review it shortly. Reply HELP or call 911 if immediate danger.`;
            await sendSMS(riderPhone, smsMessage);
        }

        return new Response(JSON.stringify({
            success: true,
            message: "Emergency alert dispatched to your safety contacts",
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
