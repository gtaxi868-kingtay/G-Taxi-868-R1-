// supabase/functions/g_execute_action/index.ts
// G's hands — deterministic execution of APPROVED proposals plus the 5-minute
// sweep (executes anything approved from a phone push, delivers due rider
// reminders). The LLM never runs here: action_type → reviewed handler code.
//
// Handler policy v1 (honest by design):
//  - Draft/advisory types (draft_post, support_reply_draft, content_calendar,
//    recommendation): "executing" means acknowledging — the human posts/sends
//    manually in phase 1. Marked executed with manual:true.
//  - grid_candidate has a real handler below (G Co-Host lodging intake) —
//    approving it actually creates the lodging_nodes row, flagged
//    requires_verification until ops confirms the owner/property is real.
//  - Types with no handler yet are marked FAILED with a clear note telling the
//    owner to do it in the dashboard — never silently pretended done.
//
// Auth: x-cron-secret (PLATFORM_CRON_SECRET) or admin JWT. verify_jwt=false.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { secretMatches } from "../_shared/constantTime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function sendExpoPush(token: string | null, title: string, body: string) {
    if (!token || !token.startsWith("ExponentPushToken[")) return;
    try {
        await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: token, title, body, sound: "default" }),
        });
    } catch (_) { /* non-fatal */ }
}

// deno-lint-ignore no-explicit-any
type Svc = any;
// deno-lint-ignore no-explicit-any
type Proposal = any;

interface ExecResult {
    ok: boolean;
    result: Record<string, unknown>;
}

// ── Handler registry (reviewed code only) ──────────────────────────────────────

const MANUAL_ACK_TYPES = new Set([
    "draft_post",
    "support_reply_draft",
    "content_calendar",
    "recommendation",
    "unspecified",
    // Filed by check_escape_lane_fare_freshness() every 14 days — no live
    // fare API is wired, so there's nothing to auto-execute. Approving
    // just acknowledges the lanes listed in payload.stale_lanes were
    // re-verified and escape_lane_fare_baseline updated by hand.
    "lane_fare_review",
]);

const HANDLERS: Record<string, (supabase: Svc, p: Proposal) => Promise<ExecResult>> = {
    // Approving a merchant promo flips it live so g_rank_merchants starts
    // boosting it ("Featured" placement). merchant_promotions is the existing
    // ads table: is_active boolean + start_date/end_date window.
    async activate_merchant_promo(supabase, p) {
        const promoId = p.payload?.promotion_id;
        if (!promoId) return { ok: false, result: { error: "payload.promotion_id missing" } };
        const { error } = await supabase.from("merchant_promotions")
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq("id", promoId);
        return error
            ? { ok: false, result: { error: error.message } }
            : { ok: true, result: { activated: promoId } };
    },

    // G proposes approving a driver's G Garage vehicle-sourcing request
    // (e.g. "this driver's stats + earnings support it"); admin approval
    // here runs the EXACT same admin_decide_garage_request() RPC the
    // manual admin GGarage screen uses — one source of truth for what
    // "approved" means, whether G or a human clicked it, matching the
    // reasoning behind escape_confirm_group below.
    async approve_garage_request(supabase, p) {
        const requestId = p.payload?.request_id;
        if (!requestId) return { ok: false, result: { error: "payload.request_id missing" } };
        if (!p.decided_by) return { ok: false, result: { error: "proposal has no decided_by admin id" } };
        const { data, error } = await supabase.rpc("admin_decide_garage_request", {
            p_request_id: requestId,
            p_decision: "approved",
            p_admin_id: p.decided_by,
            p_reason: p.reasoning ?? null,
        });
        if (error) return { ok: false, result: { error: error.message } };
        return { ok: true, result: { request: data } };
    },

    // Admin's "send" for a G-Escape group that hit its tipping point.
    // Runs the exact same confirmation logic (itinerary legs, financial
    // ledger, rider + hotel notifications) as the auto-release safety net
    // in escape_sweep_tipping_points — one source of truth for what
    // "confirmed" means, whether a human or the deadline triggered it.
    async escape_confirm_group(supabase, p) {
        const blockId = p.payload?.flight_block_id;
        if (!blockId) return { ok: false, result: { error: "payload.flight_block_id missing" } };
        const { data, error } = await supabase.rpc("execute_escape_group_confirmation", {
            p_flight_block_id: blockId,
        });
        if (error) return { ok: false, result: { error: error.message } };
        if (data?.success === false) return { ok: false, result: data };
        return { ok: true, result: data };
    },

    // Approving a lane-demand case drafts the flight block in DRAFT status —
    // invisible to riders (storefront filters to POOLING/CONFIRMED) — so ops
    // can attach the real airline cost and dates before flipping it live.
    // Placeholder departure = 15th of the demanded month; cost 0 forces ops
    // to price it before it can meaningfully go to POOLING. Opening a lane
    // stays a human negotiation — this only stages the paperwork.
    async escape_open_lane(supabase, p) {
        const pl = p.payload ?? {};
        if (!pl.destination_code || !pl.travel_month) {
            return { ok: false, result: { error: "payload.destination_code / travel_month missing" } };
        }
        const month = new Date(pl.travel_month);
        const departure = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 15, 14, 0, 0));
        const { data, error } = await supabase.from("flight_blocks").insert({
            origin_code: pl.origin_code ?? "POS",
            destination_code: pl.destination_code,
            destination_name: pl.destination_name ?? pl.destination_code,
            departure_time: departure.toISOString(),
            flight_cost_per_seat_cents: 0,
            status: "DRAFT",
            notes: `Drafted from lane demand (${pl.lane_key ?? "?"}): ${pl.riders ?? "?"} riders want ${pl.seats_wanted ?? "?"} seats. Set real flight cost, dates and capacity, then flip status to POOLING to open bookings.`,
        }).select("id").single();
        if (error) return { ok: false, result: { error: error.message } };
        return { ok: true, result: { drafted_flight_block_id: data.id, status: "DRAFT" } };
    },

    // G Co-Host: commander/admin-sourced lodging candidate. Approving creates
    // the real lodging_nodes row — requires_verification stays true so ops
    // knows this came from an unvetted submission, not a direct admin entry.
    // merchant_id is intentionally nullable: most small Caribbean rentals
    // don't have a merchant account yet, and this isn't the place to invent one.
    async grid_candidate(supabase, p) {
        const pl = p.payload ?? {};
        if (!pl.name || !pl.destination_code || !pl.location_zone || !pl.base_price_per_night_cents) {
            return { ok: false, result: { error: "payload missing required fields (name, destination_code, location_zone, base_price_per_night_cents)" } };
        }
        const { data, error } = await supabase.from("lodging_nodes").insert({
            name: pl.name,
            merchant_id: pl.merchant_id ?? null,
            destination_code: pl.destination_code,
            location_zone: pl.location_zone,
            nights: pl.nights ?? 2,
            base_price_per_night_cents: pl.base_price_per_night_cents,
            max_guests: pl.max_guests ?? 6,
            min_guests: pl.min_guests ?? 1,
            is_active: true,
            requires_verification: true,
            owner_name: pl.owner_name ?? null,
            owner_phone: pl.owner_phone ?? null,
            owner_whatsapp: pl.owner_whatsapp ?? null,
            owner_email: pl.owner_email ?? null,
            description: pl.notes ?? null,
        }).select("id").single();
        if (error) return { ok: false, result: { error: error.message } };
        return { ok: true, result: { lodging_node_id: data.id, requires_verification: true } };
    },
};

async function executeProposal(supabase: Svc, p: Proposal): Promise<ExecResult> {
    if (MANUAL_ACK_TYPES.has(p.action_type)) {
        return {
            ok: true,
            result: { manual: true, note: "Approved — action is manual in phase 1 (post/send it yourself; the draft is in payload)." },
        };
    }
    const handler = HANDLERS[p.action_type];
    if (!handler) {
        return {
            ok: false,
            result: { error: `No automated handler for '${p.action_type}' yet — carry it out in the admin dashboard.` },
        };
    }
    try {
        return await handler(supabase, p);
    } catch (err) {
        return { ok: false, result: { error: err instanceof Error ? err.message : String(err) } };
    }
}

async function settleProposal(supabase: Svc, p: Proposal): Promise<ExecResult> {
    const res = await executeProposal(supabase, p);
    await supabase.from("g_proposed_actions").update({
        status: res.ok ? "executed" : "failed",
        execution_result: res.result,
    }).eq("id", p.id);
    await supabase.from("agent_decision_log").insert({
        run_id: crypto.randomUUID(),
        department: p.department,
        decision_type: res.ok ? "proposal_executed" : "proposal_failed",
        reasoning: p.title,
        tool_used: p.action_type,
        payload: { proposal_id: p.id, ...res.result },
        outcome: res.ok ? "executed" : "failed",
    }).then(null, () => null);
    return res;
}

// ── Rider reminder delivery (part of the sweep) ────────────────────────────────

async function deliverDueReminders(supabase: Svc): Promise<number> {
    const { data: due } = await supabase.from("g_rider_reminders")
        .select("id, rider_id, message, recurrence, due_at")
        .is("delivered_at", null)
        .lte("due_at", new Date().toISOString())
        .limit(50);
    if (!due?.length) return 0;

    let delivered = 0;
    for (const r of due) {
        const { data: profile } = await supabase.from("profiles")
            .select("push_token").eq("id", r.rider_id).maybeSingle();
        await sendExpoPush(profile?.push_token ?? null, "G reminder", r.message);
        await supabase.from("g_rider_reminders")
            .update({ delivered_at: new Date().toISOString() }).eq("id", r.id);
        delivered++;
        // Recurrence: schedule the next occurrence as a fresh row.
        if (r.recurrence === "daily" || r.recurrence === "weekly") {
            const next = new Date(r.due_at);
            next.setUTCDate(next.getUTCDate() + (r.recurrence === "daily" ? 1 : 7));
            await supabase.from("g_rider_reminders").insert({
                rider_id: r.rider_id,
                message: r.message,
                due_at: next.toISOString(),
                recurrence: r.recurrence,
            }).then(null, () => null);
        }
    }
    return delivered;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

async function isAuthorized(req: Request, supabase: Svc): Promise<boolean> {
    // M4: constant-time compare (see _shared/constantTime.ts)
    const cronHeader = req.headers.get("x-cron-secret");
    if (await secretMatches(cronHeader, PLATFORM_CRON_SECRET)) return true;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return false;
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return false;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

// ── Main ───────────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAuthorized(req, supabase))) return json({ error: "Unauthorized" }, 401);

    // Kill switch: maintenance mode pauses execution (proposals stay queued).
    const { data: maint } = await supabase.from("system_config")
        .select("value").eq("key", "maintenance_mode").maybeSingle();
    if (maint?.value === "true") return json({ success: false, killed: "maintenance_mode" });

    let body: { proposal_id?: string; sweep?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body */ }

    try {
        // Single-proposal mode (dashboard calls this right after approval).
        if (body.proposal_id) {
            const { data: p, error } = await supabase.from("g_proposed_actions")
                .select("*").eq("id", body.proposal_id).eq("status", "approved").maybeSingle();
            if (error || !p) return json({ error: "proposal not found or not approved" }, 404);
            const res = await settleProposal(supabase, p);
            return json({ success: res.ok, result: res.result });
        }

        // Sweep mode (pg_cron every 5 min): approved-but-unexecuted proposals
        // + due rider reminders.
        const { data: approved } = await supabase.from("g_proposed_actions")
            .select("*").eq("status", "approved").limit(20);
        const executed: Array<{ id: string; ok: boolean }> = [];
        for (const p of approved ?? []) {
            const res = await settleProposal(supabase, p);
            executed.push({ id: p.id, ok: res.ok });
        }
        const remindersDelivered = await deliverDueReminders(supabase);

        return json({ success: true, proposals_executed: executed, reminders_delivered: remindersDelivered });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[g_execute_action]", msg);
        return json({ error: msg }, 500);
    }
});
