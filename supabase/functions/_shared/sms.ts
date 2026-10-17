import { secureFetch } from "./networkUtility.ts";

const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_API_VERSION = "v18.0";

export interface SendMessageResult {
  success: boolean;
  channel: 'whatsapp_api' | 'whatsapp_deeplink' | 'noop';
  messageId?: string;
  error?: string;
  deepLink?: string;
}

export interface WhatsAppTextMessage {
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface WhatsAppTemplateMessage {
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: 'body' | 'header' | 'footer';
      parameters: Array<{ type: 'text'; text: string }>;
    }>;
  };
}

export type WhatsAppMessage = WhatsAppTextMessage | WhatsAppTemplateMessage;

const BUSINESS_PHONE = '18687031000';

function buildDeepLink(phone: string, text: string): string {
  const clean = phone.startsWith('+') ? phone.slice(1) : phone.replace(/\D/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

async function callWhatsAppAPI(payload: WhatsAppMessage & { to: string }): Promise<SendMessageResult> {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    return { success: false, channel: 'noop', error: 'WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set' };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  // Separate the recipient from the message body: the raw `to` must be
  // normalized to E.164 digits, and must NOT be re-spread from `...message`
  // (which would overwrite the normalized value).
  const { to: rawTo, ...message } = payload;
  const normalizedTo = rawTo.startsWith('+') ? rawTo.slice(1) : rawTo.replace(/\D/g, '');

  try {
    const response = await secureFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        ...message,
      }),
      timeoutMs: 10000,
    });

    const data = await response.json();
    if (response.ok && data.messages?.[0]?.id) {
      return { success: true, channel: 'whatsapp_api', messageId: data.messages[0].id };
    }

    const errorMsg = data.error?.message || data.error?.error_user_title || JSON.stringify(data);
    console.error(`[WhatsApp API] Error: ${errorMsg}`);
    return { success: false, channel: 'whatsapp_api', error: errorMsg };
  } catch (err) {
    console.error(`[WhatsApp API] Network error:`, err);
    return { success: false, channel: 'whatsapp_api', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  lang: string = 'en',
): Promise<SendMessageResult> {
  const msg: WhatsAppTemplateMessage = {
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
    },
  };

  if (bodyParams.length > 0) {
    msg.template.components = [{
      type: 'body',
      parameters: bodyParams.map(p => ({ type: 'text' as const, text: p })),
    }];
  }

  return callWhatsAppAPI({ ...msg, to });
}

export async function sendTextMessage(to: string, body: string, previewUrl = false): Promise<SendMessageResult> {
  const msg: WhatsAppTextMessage = {
    type: 'text',
    text: { body, preview_url: previewUrl },
  };
  return callWhatsAppAPI({ ...msg, to });
}

export function getDeepLink(phone: string, text: string): string {
  return buildDeepLink(phone, text);
}

export function getBusinessDeepLink(text: string): string {
  return buildDeepLink(BUSINESS_PHONE, text);
}

export async function sendWhatsApp(
  to: string,
  message: string,
  options?: {
    templateName?: string;
    templateParams?: string[];
    previewUrl?: boolean;
  },
): Promise<SendMessageResult> {
  if (options?.templateName) {
    return sendTemplate(to, options.templateName, options.templateParams);
  }
  return sendTextMessage(to, message, options?.previewUrl);
}

export interface WhatsAppHealth {
  configured: boolean;
  valid: boolean;
  display_phone_number?: string;
  verified_name?: string;
  error?: string;
}

/**
 * Proves the WhatsApp credentials actually work, the same way g_briefing's
 * ?probe=<provider> proves an LLM key works rather than trusting a
 * "key is configured" boolean -- that pattern already caught a suspended
 * Gemini key this way once. Does a read-only GET on the phone number's own
 * metadata; sends nothing to any person, so it is safe to call as often as
 * needed without spamming a real WhatsApp user.
 */
export async function checkWhatsAppHealth(): Promise<WhatsAppHealth> {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    return { configured: false, valid: false, error: 'WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set' };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}` +
    `?fields=verified_name,display_phone_number,quality_rating`;

  try {
    const response = await secureFetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      timeoutMs: 10000,
    });
    const data = await response.json();

    if (response.ok && data.display_phone_number) {
      return {
        configured: true, valid: true,
        display_phone_number: data.display_phone_number,
        verified_name: data.verified_name,
      };
    }

    // Same class of gap g_briefing's probe caught for Gemini: a Meta error
    // body can echo back the access token in plaintext, so only the
    // message/type are surfaced, never the raw body.
    const errorMsg = data.error?.message || data.error?.type || `HTTP ${response.status}`;
    return { configured: true, valid: false, error: errorMsg };
  } catch (err) {
    return { configured: true, valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
