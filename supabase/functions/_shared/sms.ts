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
        to: phone.startsWith('+') ? phone.slice(1) : phone.replace(/\D/g, ''),
        ...payload,
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
    return { success: false, channel: 'whatsapp_api', error: err.message };
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
