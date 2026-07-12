// supabase/functions/resolve_touchpoint/index.ts
// PUBLIC, no-auth touchpoint resolver for the cold-start arrival page.
//
// A stranger taps an NFC puck / scans a QR with no app and no account. The
// arrival web page calls this to turn a raw tag/node id into a real, human-
// readable pickup ("Puck 2 — San Grande" + coords) so the WhatsApp ride
// request actually says WHERE to come. Read-only; returns ONLY a public tap
// point's location (name + coords + address) — never any personal data.
//
// verify_jwt = false on purpose: the whole point is the caller has no session.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // Accept id from query (?tag= / ?node=) or JSON body.
    const url = new URL(req.url);
    let tag = url.searchParams.get("tag") ?? "";
    let node = url.searchParams.get("node") ?? "";
    if (!tag && !node && req.method === "POST") {
        try { const b = await req.json(); tag = String(b.tag ?? ""); node = String(b.node ?? ""); } catch { /* empty */ }
    }
    if (!tag && !node) return json({ found: false, reason: "no tag or node supplied" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve to a kiosk node either by its physical tag_uid or its node id.
    // Only active/provisioned pucks are eligible as a public pickup.
    let q = supabase
        .from("kiosk_nodes")
        .select("id, location_name, pickup_address, lat, lng, is_active, provision_status, merchant_id")
        .limit(1);
    q = node ? q.eq("id", node) : q.eq("tag_uid", tag);

    const { data, error } = await q.maybeSingle();
    if (error) return json({ found: false, reason: "lookup failed" }, 200);
    if (!data || data.is_active === false) {
        return json({ found: false, reason: "touchpoint not active yet" }, 200);
    }

    // Best-effort tap telemetry (never blocks the response).
    supabase.from("kiosk_nodes").update({ last_heartbeat: new Date().toISOString() })
        .eq("id", data.id).then(null, () => null);

    return json({
        found: true,
        pickup: {
            name: data.location_name ?? "G-Taxi touchpoint",
            address: data.pickup_address ?? null,
            lat: data.lat ?? null,
            lng: data.lng ?? null,
        },
        is_merchant: !!data.merchant_id,
    });
});
