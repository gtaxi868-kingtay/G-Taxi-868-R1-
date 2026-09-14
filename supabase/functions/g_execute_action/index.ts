// supabase/functions/g_execute_action/index.ts
// G's hands — deterministic execution of APPROVED proposals plus the 5-minute
// sweep (executes anything approved from a phone push, delivers due rider
// reminders). The LLM never runs here: action_type → reviewed handler code.
//
// Handler policy (honest by design):
//  - Draft/advisory types (draft_post, support_reply_draft, content_calendar,
//    recommendation): "executing" means acknowledging — the human posts/sends
//    manually. Marked executed with manual:true.
//  - 9 real handlers below actually do the thing: activate_merchant_promo,
//    approve_garage_request, escape_confirm_group, escape_open_lane,
//    grid_candidate, grant_transition_bonus, reactivate_cron_job,
//    set_g_config_key, unlock_territory_vertical.
//  - g_action_types (see 20260908000000_g_action_type_registry.sql) is the
//    single source of truth for which action_type is which — this file's
//    HANDLERS is cross-checked against it on every invocation
//    (executeProposal), and a mismatch refuses the drifted type with a
//    G_HANDLER_DRIFT alert instead of silently no-opping or crashing.
//  - Types with no handler yet are marked FAILED with a clear note telling the
//    owner to do it in the dashboard — never silently pretended done.
//  - Every settled proposal writes an 'outcome' memory (g_memory) regardless
//    of success/failure — this is what lets a future department run know
//    what happened to something it proposed, instead of re-proposing blind.
//
// Auth: x-cron-secret (PLATFORM_CRON_SECRET) or admin JWT. verify_jwt=false.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { validateActionPayloadShape } from "../_shared/actionPayloadSchema.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";



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

// ── Handler registry (reviewed code only) ───────────────────────────────────

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
    // Support-filed refunds have no automated handler — a human actually
    // issues the refund via Stripe/WiPay/wallet. Approving acknowledges it.
    "refund",
    // Filed by g_driver_concierge's flag_concern tool (safety, pay question,
    // or general feedback from a driver). No automated handler by design —
    // this only ever needs a human to see it and act manually; "approving"
    // means "seen," not "system did something."
    "driver_concern",
]);

const HANDLERS: Record<string, (supabase: Svc, p: Proposal) => Promise<ExecResult>> = {
    // Jarvis (rider-facing concierge) used to call create_split_session
    // directly with the rider's own access token the moment the LLM decided
    // to -- a wrong guess about friend count/fare created a real,
    // other-people-visible split session with zero admin oversight, the one
    // consequential action in this codebase that bypassed the propose →
    // approve → execute pattern everything else goes through. Jarvis now
    // files a g_proposed_actions row instead; this handler does what
    // create_split_session's own insert does, as reviewed code, using
    // payload.rider_id rather than a rider JWT that may have expired by the
    // time an admin gets to it (approval can be minutes to hours later).
    async initiate_lime_fleet(supabase, p) {
        const riderId = p.payload?.rider_id;
        const participantCount = p.payload?.participant_count;
        const totalCents = p.amount_cents ?? p.payload?.total_cents;
        if (!riderId) return { ok: false, result: { error: "payload.rider_id missing" } };
        if (!participantCount || participantCount < 2 || participantCount > 20) {
            return { ok: false, result: { error: "payload.participant_count must be 2-20" } };
        }
        if (!totalCents || totalCents <= 0) {
            return { ok: false, result: { error: "amount_cents missing or invalid" } };
        }
        const shareCents = p.payload?.share_cents ?? Math.floor(totalCents / participantCount);

        const { data: session, error } = await supabase
            .from("split_sessions")
            .insert({
                creator_id: riderId,
                ride_id: p.payload?.ride_id || null,
                total_cents: totalCents,
                participant_count: participantCount,
                share_cents: shareCents,
                title: p.title || "Lime Fleet",
                status: "collecting",
            })
            .select()
            .single();
        if (error) return { ok: false, result: { error: error.message } };

        const { data: profile } = await supabase.from("profiles")
            .select("push_token").eq("id", riderId).maybeSingle();
        await sendExpoPush(
            profile?.push_token ?? null,
            "Your Lime Fleet is ready! 🚗",
            `Approved — each person pays $${(shareCents / 100).toFixed(2)} TTD. Share it with your friends.`,
        );

        return { ok: true, result: { session } };
    },

    // Filed by check_territory_vertical_unlocks() (daily cron,
    // 20260912040000_territory_vertical_unlock.sql) once a territory's
    // distinct completed-ride rider count crosses that vertical's
    // configured threshold. Approving here appends the territory's code to
    // vertical_settings.enabled_regions — the actual "unlock the next
    // vertical for this community" moment. is_enabled/rollout_percentage on
    // the vertical still apply on top of this; this only adds the territory
    // to the allow-list, it doesn't switch the vertical on platform-wide.
    async unlock_territory_vertical(supabase, p) {
        const territoryId = p.payload?.territory_id;
        const verticalName = p.payload?.vertical_name;
        if (!territoryId || !verticalName) {
            return { ok: false, result: { error: "payload missing territory_id or vertical_name" } };
        }

        const { data: territory, error: terrError } = await supabase
            .from("territories").select("code, name").eq("id", territoryId).maybeSingle();
        if (terrError) return { ok: false, result: { error: terrError.message } };
        if (!territory?.code) return { ok: false, result: { error: "territory not found or has no code" } };

        const { data: vertical, error: vertError } = await supabase
            .from("vertical_settings").select("enabled_regions").eq("vertical_name", verticalName).maybeSingle();
        if (vertError) return { ok: false, result: { error: vertError.message } };
        if (!vertical) return { ok: false, result: { error: `no vertical_settings row for '${verticalName}'` } };

        const currentRegions: string[] = vertical.enabled_regions ?? [];
        if (currentRegions.includes(territory.code)) {
            return { ok: true, result: { already_unlocked: true, territory: territory.name, vertical: verticalName } };
        }

        const { error: updateError } = await supabase
            .from("vertical_settings")
            .update({ enabled_regions: [...currentRegions, territory.code], updated_at: new Date().toISOString() })
            .eq("vertical_name", verticalName);
        if (updateError) return { ok: false, result: { error: updateError.message } };

        return { ok: true, result: { unlocked: true, territory: territory.name, territory_code: territory.code, vertical: verticalName } };
    },

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

    // ICE→EV transition bonus (G Garage Phase D). Filed automatically by
    // file_transition_bonus_proposal() when an admin approves a garage
    // request for a driver with a ready_for_assignment Earn-to-Deposit plan
    // (20260902020000_transition_bonus_phase_d.sql). Approving here calls
    // start_transition_bonus_schedule, which pays month 1 immediately as a
    // real wallet_transactions credit and creates the schedule row; months
    // 2-6 are paid by the pay_due_transition_bonus_installments daily cron.
    // Idempotent on double-execute via the wallet_transactions reference_id
    // unique index.
    //
    // NOTE: this handler existed live in production but was absent from this
    // repo's git history entirely until discovered while building Phase 2 of
    // the G-employee plan (2026-09-06) — the "deployed code ahead of git"
    // hazard this project's CLAUDE.md warns about. Registered into
    // g_action_types (20260908030000) so the new drift check below
    // recognizes it as a real handler instead of flagging it.
    async grant_transition_bonus(supabase, p) {
        const pl = p.payload ?? {};
        if (!pl.driver_user_id || !pl.deposit_savings_id || !pl.garage_request_id || !pl.monthly_bonus_cents || !pl.months_total) {
            return { ok: false, result: { error: "payload missing required fields (driver_user_id, deposit_savings_id, garage_request_id, monthly_bonus_cents, months_total)" } };
        }

        // Never trust the proposal's own dollar figure — it may have come
        // from an LLM propose_action call rather than the deterministic
        // file_transition_bonus_proposal() filer. Recompute it from the same
        // real data (recompute_transition_bonus_cents, added 2026-09-12) and
        // refuse to execute if the proposal's number doesn't match exactly,
        // rather than silently substituting a different amount than what an
        // admin actually approved.
        const { data: recomputed, error: recomputeError } = await supabase
            .rpc("recompute_transition_bonus_cents", { p_garage_request_id: pl.garage_request_id })
            .single();
        if (recomputeError) return { ok: false, result: { error: recomputeError.message } };
        if (recomputed?.error_message) {
            return { ok: false, result: { error: `Cannot verify bonus amount: ${recomputed.error_message}` } };
        }
        if (recomputed.monthly_bonus_cents !== pl.monthly_bonus_cents || recomputed.months_total !== pl.months_total) {
            return {
                ok: false,
                result: {
                    error: `Proposal amount does not match the deterministic calculation — refusing to execute. Proposed: ${pl.monthly_bonus_cents} cents/${pl.months_total} months. Recomputed from real data: ${recomputed.monthly_bonus_cents} cents/${recomputed.months_total} months.`,
                },
            };
        }

        const { data, error } = await supabase.rpc("start_transition_bonus_schedule", {
            p_driver_user_id: pl.driver_user_id,
            p_deposit_savings_id: pl.deposit_savings_id,
            p_monthly_bonus_cents: recomputed.monthly_bonus_cents,
            p_months_total: recomputed.months_total,
            p_proposal_id: p.id,
        });
        if (error) return { ok: false, result: { error: error.message } };
        return { ok: true, result: data };
    },

    // 2b-i, allowlisted in g_reactivate_cron_job itself (SQL, not here) —
    // only 9 named G/maintenance jobs, never settlement/payout/lease/dispatch.
    async reactivate_cron_job(supabase, p) {
        const jobName = p.payload?.job_name;
        if (!jobName) return { ok: false, result: { error: "payload.job_name missing" } };
        const { data, error } = await supabase.rpc("g_reactivate_cron_job", { p_job_name: jobName });
        if (error) return { ok: false, result: { error: error.message } };
        if (data?.ok === false) return { ok: false, result: data };
        return { ok: true, result: data };
    },

    // 2b-i, allowlisted in g_set_config_key itself (SQL, not here) — a fixed
    // set of 4 g_config keys with range validation; g_enabled excluded.
    async set_g_config_key(supabase, p) {
        const key = p.payload?.key;
        const value = p.payload?.value;
        if (!key || value === undefined) return { ok: false, result: { error: "payload.key / payload.value missing" } };
        const { data, error } = await supabase.rpc("g_set_config_key", { p_key: key, p_value: value });
        if (error) return { ok: false, result: { error: error.message } };
        if (data?.ok === false) return { ok: false, result: data };
        return { ok: true, result: data };
    },
};

// Deduped alert: g_action_types (the DB registry) and HANDLERS (this file's
// in-code registry) drifting apart means either a type was seeded in SQL
// with no matching handler written, or a handler exists here with no
// registry row — either way, propose_action's dynamically-built enum
// (g_agent_runner) and this executor disagree about what G can actually do.
// Raised once per action_type per unresolved window, not once per sweep run.
async function alertHandlerDrift(supabase: Svc, actionType: string, detail: string) {
    const { data: open } = await supabase.from("system_alerts")
        .select("id").eq("type", "G_HANDLER_DRIFT").is("resolved_at", null)
        .contains("details", { action_type: actionType }).maybeSingle();
    if (open) return;
    await supabase.rpc("raise_admin_alert", {
        p_type: "G_HANDLER_DRIFT",
        p_title: `Handler registry drift: ${actionType}`,
        p_body: detail,
        p_severity: "WARNING",
        p_details: { action_type: actionType },
    }).then(null, () => null);
}

async function executeProposal(supabase: Svc, p: Proposal): Promise<ExecResult> {
    if (MANUAL_ACK_TYPES.has(p.action_type)) {
        return {
            ok: true,
            result: { manual: true, note: "Approved — action is manual in phase 1 (post/send it yourself; the draft is in payload)." },
        };
    }

    // Cross-check the DB registry against this file's HANDLERS before
    // running anything — the deploy-order safety net for g_action_types.
    // Confirmed live: g_agent_runner's propose_action enum comes from
    // g_action_types where execution_mode='handler', so a type reaching here
    // should always have a matching handler UNLESS the two have drifted
    // (e.g. this migration lands before this function is redeployed, or vice
    // versa). Refuse the drifted type specifically rather than either
    // silently no-opping or crashing the whole sweep.
    const { data: registryRow } = await supabase.from("g_action_types")
        .select("execution_mode, is_enabled").eq("action_type", p.action_type).maybeSingle();
    const hasHandler = p.action_type in HANDLERS;

    if (registryRow?.execution_mode === "handler" && registryRow.is_enabled && !hasHandler) {
        await alertHandlerDrift(supabase, p.action_type,
            `g_action_types says '${p.action_type}' has a real handler, but g_execute_action's HANDLERS registry has no matching function. This function needs redeploying.`);
        return { ok: false, result: { error: `Handler registry drift for '${p.action_type}' — flagged to the owner, not executed.` } };
    }
    if (hasHandler && registryRow?.execution_mode !== "handler") {
        await alertHandlerDrift(supabase, p.action_type,
            `g_execute_action has a real handler for '${p.action_type}', but g_action_types does not list it as execution_mode='handler' (row: ${registryRow ? JSON.stringify(registryRow) : "missing entirely"}). The registry migration needs updating.`);
        return { ok: false, result: { error: `Handler registry drift for '${p.action_type}' — flagged to the owner, not executed.` } };
    }

    const handler = HANDLERS[p.action_type];
    if (!handler) {
        return {
            ok: false,
            result: { error: `No automated handler for '${p.action_type}' yet — carry it out in the admin dashboard.` },
        };
    }

    // Second independent check on the same *_cents/*_id shape convention
    // g_agent_runner validates at proposal time — a proposal could have been
    // filed before that validation existed, or by anything other than
    // propose_action. Refuse to hand a malformed payload to a handler that
    // will pass it straight into a real RPC.
    const payloadViolations = validateActionPayloadShape(p.payload ?? {});
    if (payloadViolations.length > 0) {
        return {
            ok: false,
            result: { error: `Refusing to execute — payload has invalid field(s): ${payloadViolations.join("; ")}` },
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

    // Phase 2d: the thing that makes this a LOOP, not just an executor. G
    // gets to learn what happened to what it proposed. embedding is left
    // NULL deliberately — this executor stays free of a network dependency
    // on the embedding gateway; full-text search already covers this until
    // a future backfill job fills embeddings in for outcome rows.
    await supabase.rpc("g_memory_write", {
        p_scope: "department",
        p_department: p.department ?? null,
        p_entity_type: "proposal",
        p_entity_key: String(p.id),
        p_entity_id: p.id,
        p_kind: "outcome",
        p_title: `${p.action_type}: ${res.ok ? "executed" : "failed"} — ${String(p.title ?? "").slice(0, 150)}`,
        p_body: `${p.reasoning ?? ""}\n\nResult: ${JSON.stringify(res.result).slice(0, 1000)}`.slice(0, 1500),
        p_confidence: 1.0, // observed fact, not inference
        p_source: "execution_outcome",
        p_source_ref: { proposal_id: p.id },
        p_valid_until: null,
        p_supersedes_id: null,
        p_embedding: null,
        p_embedding_model: null,
    }).then(null, () => null); // memory is an enhancement — never let it fail the real settlement

    return res;
}

// ── Rider reminder delivery (part of the sweep) ─────────────────────────────

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

// ── Auth ───────────────────────────────────────────────────────

async function isAuthorized(req: Request, supabase: Svc): Promise<boolean> {
    const cronHeader = req.headers.get("x-cron-secret");
    if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) return true;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return false;
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return false;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

// ── Main ──────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  function json(payload: unknown, status = 200): Response {
      return new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  }

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
