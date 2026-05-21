// Supabase Edge Function: whatsapp_webhook
// Handles incoming WhatsApp messages for Trip Rescue, ride status queries, and general assistance.
// NLP logic extracts intent from user messages.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_SECRET_KEY = Deno.env.get("GATEWAY_SECRET_KEY");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WhatsAppMessage {
    from: string;
    text?: string;
    media_url?: string;
}

interface UserInfo {
    profile_id: string;
    full_name: string;
    phone: string;
}

// Simple NLP intent detection
function detectIntent(text: string): { intent: string; confidence: number } {
    const lower = text.toLowerCase().trim();

    // Trip rescue / failed ride
    const rescuePatterns = [
        /(ride|trip|driver).*(fail|stuck|not.*(show|arrive|pick)|disappear|cancel|wrong)/i,
        /(help|rescue|emergency|stuck|stranded).*(ride|trip|driver|pickup)/i,
        /driver.*(left|gone|not.*(here|arrive|found)|ghost)/i,
        /(cancel|end).*(ride|trip)/i,
    ];

    for (const pattern of rescuePatterns) {
        if (pattern.test(lower)) {
            return { intent: 'trip_rescue', confidence: 0.85 };
        }
    }

    // Status check
    if (/(where|status|eta|track).*(ride|trip|driver)/i.test(lower) ||
        /(my ride|my trip|my driver).*(status|eta|where|location)/i.test(lower)) {
        return { intent: 'status_check', confidence: 0.8 };
    }

    // Booking request
    if (/(book|order|need|want).*(ride|taxi|car|pickup)/i.test(lower) ||
        /(take me|pick me|get me).*(to|from)/i.test(lower)) {
        return { intent: 'book_ride', confidence: 0.7 };
    }

    // General help
    if (/(help|hello|hi|hey|menu|option)/i.test(lower)) {
        return { intent: 'help', confidence: 0.9 };
    }

    return { intent: 'unknown', confidence: 0.3 };
}

async function lookupUserByPhone(adminClient: any, phone: string): Promise<UserInfo | null> {
    const { data } = await adminClient
        .from('profiles')
        .select('id, full_name, phone_number')
        .eq('phone_number', phone)
        .maybeSingle();

    if (data) {
        return {
            profile_id: data.id,
            full_name: data.full_name || 'Unknown',
            phone: data.phone_number || phone,
        };
    }
    return null;
}

async function findActiveRide(adminClient: any, profileId: string) {
    const activeStatuses = ['searching', 'assigned', 'arrived', 'in_progress'];
    const { data } = await adminClient
        .from('rides')
        .select('*, driver:driver_id(full_name, phone_number)')
        .eq('rider_id', profileId)
        .in('status', activeStatuses)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data;
}

async function handleTripRescue(adminClient: any, user: UserInfo, message: WhatsAppMessage): Promise<string> {
    const activeRide = await findActiveRide(adminClient, user.profile_id);

    if (activeRide) {
        // Log rescue event
        await adminClient.from('nfc_event_logs').insert({
            event_type: 'TRIP_RESCUE',
            tag_uid: 'WHATSAPP',
            profile_id: user.profile_id,
            location_context: {
                ride_id: activeRide.id,
                status: activeRide.status,
                message: message.text || '',
                from_whatsapp: true,
                reported_at: new Date().toISOString(),
            },
        });

        const driverName = activeRide.driver?.full_name || 'Unknown';
        const driverPhone = activeRide.driver?.phone_number || 'N/A';

        return `🚨 *Trip Rescue Alert Triggered*\n\nWe see your ride (${activeRide.status}) is active.\nDriver: ${driverName}\nContact: ${driverPhone}\n\nOur command center has been notified. A support agent will contact you shortly. Reply STATUS to check your ride status.`;
    }

    await adminClient.from('nfc_event_logs').insert({
        event_type: 'TRIP_RESCUE',
        tag_uid: 'WHATSAPP',
        profile_id: user.profile_id,
        location_context: {
            message: message.text || '',
            no_active_ride: true,
            from_whatsapp: true,
            reported_at: new Date().toISOString(),
        },
    });

    return `🚨 *Rescue Request Received*\n\nWe could not find an active ride under your number. Our team has been alerted and will assist you shortly.\n\nTo book a new ride, reply with your pickup location and destination.`;
}

async function handleStatusCheck(adminClient: any, user: UserInfo): Promise<string> {
    const activeRide = await findActiveRide(adminClient, user.profile_id);

    if (!activeRide) {
        return `You have no active ride at this time. To book a ride, reply with your pickup address and destination.`;
    }

    const driverName = activeRide.driver?.full_name || 'Searching...';
    const driverPhone = activeRide.driver?.phone_number || 'N/A';

    return `*Ride Status:* ${activeRide.status.toUpperCase()}
*Driver:* ${driverName}
*Driver Phone:* ${driverPhone}
*Pickup:* ${activeRide.pickup_address || 'Set'}
*Dropoff:* ${activeRide.dropoff_address || 'Set'}

Reply RESCUE if you need urgent assistance.`;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // Gateway secret handshake — reject any request without the matching key
    const gatewayKey = req.headers.get("X-Gateway-Secret-Key");
    if (!gatewayKey || gatewayKey !== GATEWAY_SECRET_KEY) {
        return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        const rawBody = await req.text();
        const body = JSON.parse(rawBody);

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Extract message info
        const from: string = body.from || body.From || body.waId || body.phone_number || '';
        const messageText: string = body.text || body.Body || body.message || '';
        const mediaUrl: string = body.media_url || body.MediaUrl0 || '';

        if (!from) {
            return new Response(
                JSON.stringify({ error: 'Missing sender identifier' }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Normalize phone number
        const phone = from.replace(/[^0-9]/g, '');
        if (phone.length < 7) {
            return new Response(
                JSON.stringify({ error: 'Invalid phone number' }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Lookup user
        const user = await lookupUserByPhone(adminClient, phone);
        if (!user) {
            return new Response(JSON.stringify({
                gateway: "wa",
                recipient: phone,
                text: `Welcome to G-Taxi! We couldn't find an account linked to this number. Reply with your full name and email to register, or download the G-Taxi app to get started.`,
                metadata: { intent: "unknown_user" },
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // NLP intent detection
        const { intent } = detectIntent(messageText);

        let reply: string;

        switch (intent) {
            case 'trip_rescue':
                reply = await handleTripRescue(adminClient, user, { from, text: messageText, media_url: mediaUrl });
                break;
            case 'status_check':
                reply = await handleStatusCheck(adminClient, user);
                break;
            case 'book_ride':
                reply = `To book a ride, please open the G-Taxi app on your phone. For manual booking, reply with: "PICKUP: [your address] DESTINATION: [your destination]". Our team will assist.`;
                break;
            case 'help':
                reply = `*G-Taxi WhatsApp Commands*\n\n• STATUS — Check your active ride\n• RESCUE — Emergency trip assistance\n• BOOK — Book a new ride\n• HELP — Show this menu\n\nOur support team is available 24/7. Reply anytime.`;
                break;
            default:
                reply = `Thank you for your message. If you need trip assistance, reply RESCUE. To check your ride status, reply STATUS. For help, reply HELP.`;
        }

        return new Response(
            JSON.stringify({
                gateway: "wa",
                recipient: phone,
                text: reply,
                metadata: { intent, user: user.full_name },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        console.error('whatsapp_webhook error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error: ' + error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
