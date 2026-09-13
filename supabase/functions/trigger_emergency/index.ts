import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { sendWhatsApp, getDeepLink } from "../_shared/sms.ts";
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

        // ── Escalate to the people who can actually act ───────────────────────
        // Until now this function told the RIDER'S OWN emergency contact and
        // nobody at G-Taxi — while promising below that "a safety specialist
        // will review it shortly". handle_sos closes that: a CRITICAL
        // system_alerts row (which is also what G reads through its
        // get_open_alerts tool), a safety point on the map, and a warning to
        // online drivers near the incident.
        //
        // Identity is already verified above (the caller must be this ride's
        // rider or driver), which is why handle_sos is service_role only and
        // does not re-check.
        let escalation: { success?: boolean; drivers_notified?: number } | null = null;
        try {
            const { data: sosResult, error: sosError } = await supabase.rpc("handle_sos", {
                p_ride_id: ride_id,
                p_raised_by: user.id,
                p_raiser_role: ride.rider_id === user.id ? "rider" : "driver",
            });
            if (sosError) {
                console.error("handle_sos failed:", sosError.message);
            } else {
                escalation = sosResult;
                console.log("handle_sos:", JSON.stringify(sosResult));
            }
        } catch (e) {
            // The alert is already durable in emergency_logs. A failure to
            // escalate must never stop the rider's own contact being messaged
            // below — that is the one message they are counting on.
            console.error("handle_sos threw:", String(e));
        }

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
            const waResult = await sendWhatsApp(emergencyPhone, smsMessage);
            console.log(`Emergency alert to ${emergencyName}:`, waResult.success ? "sent via " + waResult.channel : "failed — " + (waResult.error || ""));
        } else {
            console.warn("No emergency contact phone on file for rider");
        }

        if (!emergencyPhone && riderPhone) {
            const msg = `🚨 G-Taxi Emergency Confirmation — Your alert for ride ${ride_id.slice(0, 8)} has been logged. A safety specialist will review it shortly.`;
            await sendWhatsApp(riderPhone, msg);
        }

        return new Response(JSON.stringify({
            success: true,
            message: "Emergency alert dispatched to your safety contacts",
            escalated: escalation?.success === true,
            drivers_notified: escalation?.drivers_notified ?? 0,
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
