// supabase/functions/whatsapp_webhook/index.ts
// Inbound WhatsApp Cloud API webhook for the tap-to-ride flow.
//
//   GET  /  — Meta verification handshake (hub.mode=subscribe).
//   POST /  — inbound messages (X-Hub-Signature-256 verified) and delivery
//             statuses (ignored). Hands parsed messages to the state machine
//             in _shared/whatsapp_flow.ts.
//   POST /events/ride-assigned | /events/ride-completed — unsigned internal
//             events from the rides trigger (pg_net). handleRideEvent re-reads
//             the ride from the DB and only acts on genuine state, so forged
//             calls are harmless.
//
// verify_jwt = false (see supabase/config.toml): Meta cannot mint Supabase
// JWTs. The only secrets trusted here are VERIFY_TOKEN (handshake),
// WHATSAPP_APP_SECRET (HMAC on inbound POSTs), and the DB itself.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { secretMatches } from "../_shared/constantTime.ts";
import {
    adminClient,
    handleInboundMessage,
    handleRideEvent,
    normalizePhone,
    type InboundMessage,
} from "../_shared/whatsapp_flow.ts";

const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function hmacSha256Hex(secret: string, data: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, data);
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseMessages(payload: any): InboundMessage[] {
    const out: InboundMessage[] = [];
    const entries = payload?.entry;
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
            const value = change?.value ?? {};
            for (const m of value?.messages ?? []) {
                const phone = normalizePhone(m.from || "");
                if (!phone || !m.id) continue;
                const base = { phone, messageId: String(m.id) };
                if (m.type === "text" && m.text?.body) {
                    out.push({ ...base, type: "text", text: m.text.body });
                } else if (m.type === "location" && m.location) {
                    out.push({
                        ...base, type: "location",
                        location: {
                            lat: Number(m.location.latitude),
                            lng: Number(m.location.longitude),
                            name: m.location.name || m.location.address,
                        },
                    });
                } else if (m.type === "image" && m.image?.id) {
                    out.push({ ...base, type: "image", imageId: String(m.image.id) });
                } else if (m.type === "button" && m.button?.payload) {
                    out.push({ ...base, type: "button", buttonPayload: String(m.button.payload) });
                } else if (m.type === "interactive" && m.interactive?.button_reply?.id) {
                    // Newer interactive replies can arrive nested; treat like button.
                    out.push({ ...base, type: "button", buttonPayload: String(m.interactive.button_reply.id) });
                } else {
                    out.push({ ...base, type: "unknown" });
                }
            }
        }
    }
    return out;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const url = new URL(req.url);
    const db = adminClient();

    // ── Meta verification handshake ──────────────────────────────────────
    if (req.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        if (mode === "subscribe" && VERIFY_TOKEN && await secretMatches(token, VERIFY_TOKEN)) {
            return new Response(challenge, { status: 200, headers: corsHeaders });
        }
        return new Response("forbidden", { status: 403, headers: corsHeaders });
    }

    if (req.method !== "POST") return json({ ok: false }, 405);

    // ── Internal ride events (unsigned; verified against DB inside) ───────
    if (url.pathname.endsWith("/events/ride-assigned") || url.pathname.endsWith("/events/ride-completed")) {
        try {
            const body = await req.json();
            const event = url.pathname.endsWith("/events/ride-assigned") ? "ride-assigned" : "ride-completed";
            if (body?.ride_id) await handleRideEvent(db, String(body.ride_id), event);
        } catch (e) {
            console.error("[whatsapp_webhook] event handling failed:", e);
        }
        return json({ ok: true });
    }

    // ── Inbound WhatsApp messages: verify HMAC on the RAW body ───────────
    let raw: Uint8Array;
    try {
        raw = new Uint8Array(await req.arrayBuffer());
    } catch {
        return json({ ok: false, error: "bad body" }, 400);
    }
    const sigHeader = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + (APP_SECRET ? await hmacSha256Hex(APP_SECRET, raw) : "unset");
    if (!APP_SECRET || !(await secretMatches(sigHeader, expected))) {
        console.error("[whatsapp_webhook] signature mismatch");
        return new Response("forbidden", { status: 403, headers: corsHeaders });
    }

    let payload: any;
    try {
        payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
        return json({ ok: true }); // ack anyway; nothing to parse
    }

    const messages = parseMessages(payload);
    for (const m of messages) {
        try {
            await handleInboundMessage(db, m);
        } catch (e) {
            console.error("[whatsapp_webhook] message handling failed:", e);
        }
    }
    // Always 200: Meta redelivers on non-2xx, and we dedupe by message id.
    return json({ ok: true, processed: messages.length });
});
