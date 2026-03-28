// supabase/functions/_shared/sms.ts
// G-TAXI HARDENING: Fix 9 - SMS Fallback
// Provides resilient messaging for drivers in low-data (edge) regions.

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_PHONE_NUMBER");

/**
 * Sends an SMS via Twilio.
 * Fails gracefully - does not throw to avoid blocking the main dispatch flow.
 */
export async function sendSMS(to: string, message: string) {
    if (!TWILIO_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
        console.warn("SMS Fallback: Twilio credentials missing. Skipping SMS.");
        return { success: false, error: "Credentials missing" };
    }

    try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
        const auth = btoa(`${TWILIO_SID}:${TWILIO_AUTH_TOKEN}`);

        const body = new URLSearchParams();
        body.set("To", to);
        body.set("From", TWILIO_FROM);
        body.set("Body", message);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const data = await response.json();
        if (response.ok) {
            console.log(`SMS sent successfully to ${to}`);
            return { success: true, sid: data.sid };
        } else {
            console.error(`Twilio error: ${data.message}`);
            return { success: false, error: data.message };
        }
    } catch (err) {
        console.error("SMS Fallback: Unexpected error:", err);
        return { success: false, error: err.message };
    }
}
