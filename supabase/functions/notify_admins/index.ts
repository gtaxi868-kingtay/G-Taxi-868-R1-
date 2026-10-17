// Outbound notification hub.
//
// ORIGINAL JOB (unchanged, still the default when no `action` is given):
// Real-time admin push alert — the missing wire between "a proposal was
// filed" and "an admin's phone actually buzzed in time to act on it."
// Called two ways: (1) from SQL via net.http_post + x-cron-secret, the
// same pattern already used by auto_charge_escape_group and friends;
// (2) directly from another edge function's service-role client.
//
// Uses Expo push (sendExpoPush-equivalent) because it needs no
// FIREBASE_SERVICE_ACCOUNT_JSON secret — that one is a documented
// graceful-degrade gap elsewhere in this project; Expo's own push relay
// works with just the token already stored on profiles.push_token.
//
// ── ADDED 2026-09-07: three WhatsApp actions ─────────────────────────────
//   action: "send_welcome"    — admin sends a rider/driver/merchant a welcome
//                               WhatsApp with a link to their profile.
//   action: "capacity_sweep"  — when a zone hits its verified-driver target,
//                               its people get a download link. Cron only.
//   action: "approve_waitlist" — admin approves one waitlist.* row: marks it
//                               approved and sends the download-link WhatsApp.
//                               This is the actual gate behind "sign up, wait
//                               a spell, then get the app" — status/approved_at/
//                               approved_by already existed on waitlist and were
//                               never written by anything until this.
//
// WHY HERE AND NOT IN A NEW FUNCTION
// This project is AT its 100-edge-function plan cap — a deploy of a new
// `growth_messaging` function was rejected with "Max number of functions
// reached" on 2026-09-07. Rather than delete a live endpoint to make room
// (an owner's decision, not a coding one), these fold into the function
// that already means "the platform tells someone something" and already
// has exactly the auth shape they need: cron secret OR admin JWT.
//
// BACKWARD COMPATIBILITY IS LOAD-BEARING
// Existing callers post {title, body, data} with no `action`. That path is
// untouched and still runs first-class — do not make `action` required.
//
// IDEMPOTENCY IS THE WHOLE GAME ON THE SWEEP
// capacity_sweep runs on a schedule. Without the unique index on
// outbound_messages (recipient_role, recipient_id/phone, template) it would
// re-send "your zone is live" to the same person on every run, forever. The
// outbox row is claimed BEFORE the send, and a duplicate-key error is read as
// "already told them" — so a crash mid-sweep re-sends nothing.
//
// ── ADDED 2026-09-19: retry_pending_sends ─────────────────────────────────
// A failed send used to just die as status='failed' — a slow/down WhatsApp
// call (confirmed happening live: one capacity_sweep run hung 41s and 500'd)
// meant a real message could be silently lost forever, with nothing to
// retry it. claimAndSend now gives a failed send up to max_attempts tries
// with backoff (status='pending_retry' + next_retry_at) before giving up
// for good. action: "retry_pending_sends" (cron only) sweeps due rows and
// tries again — including rows that failed because WHATSAPP_ACCESS_TOKEN
// was invalid, so once that's fixed the backlog drains on its own instead
// of those messages being lost.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsApp, getDeepLink, checkWhatsAppHealth } from "../_shared/sms.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

// Fallbacks only. The real values live in g_config.app_links so they can be
// changed without a deploy — neither link has a real destination yet (the Expo
// apps have never been built for distribution and nothing is deployed at a
// public URL), so the day that changes it is a one-row edit.
const DEFAULT_LINKS = {
  rider_download_url: "https://g-taxi.com/get",
  driver_download_url: "https://g-taxi.com/drive",
  merchant_download_url: "https://g-taxi.com/merchant",
  profile_link_base: "https://g-taxi.com/p",
};

type Role = "rider" | "driver" | "merchant";

interface Recipient {
  role: Role;
  id: string;
  name: string;
  phone: string | null;
  territoryId: string | null;
}

async function sendExpoPush(token: string | null, title: string, body: string, data?: Record<string, unknown>) {
  if (!token || !token.startsWith("ExponentPushToken[")) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default", data: data ?? {} }),
    });
  } catch (_) { /* non-fatal — same as every other push call site in this codebase */ }
}

async function isCron(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get("x-cron-secret");
  return Boolean(PLATFORM_CRON_SECRET) && cronHeader === PLATFORM_CRON_SECRET;
}

/** Resolves the caller to an admin user id, or null. */
async function adminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user.id : null;
}

async function isAuthorized(req: Request): Promise<boolean> {
  if (await isCron(req)) return true;
  return (await adminUserId(req)) !== null;
}

async function readLinks(supabase: any): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("g_config").select("value").eq("key", "app_links").maybeSingle();
  return { ...DEFAULT_LINKS, ...(data?.value ?? {}) };
}

/**
 * Resolve a person to a name and a phone number.
 *
 * Note the merchant case: the merchants table has NO phone column, so the only
 * route to a number is merchants.created_by -> profiles.phone_number. Every
 * live merchant row currently has created_by = NULL, so merchant welcomes
 * correctly report "no phone on file" rather than pretending to send. That is a
 * data gap, not a bug here.
 */
async function resolveRecipient(supabase: any, role: Role, id: string): Promise<Recipient | null> {
  if (role === "driver") {
    const { data } = await supabase.from("drivers")
      .select("id, name, phone_number, territory_id").eq("id", id).maybeSingle();
    if (!data) return null;
    return {
      role, id: data.id, name: data.name ?? "there",
      phone: data.phone_number ?? null, territoryId: data.territory_id ?? null,
    };
  }

  if (role === "rider") {
    const { data } = await supabase.from("profiles")
      .select("id, full_name, phone_number, territory_id").eq("id", id).maybeSingle();
    if (!data) return null;
    return {
      role, id: data.id, name: data.full_name ?? "there",
      phone: data.phone_number ?? null, territoryId: data.territory_id ?? null,
    };
  }

  const { data } = await supabase.from("merchants")
    .select("id, name, created_by, territory_id").eq("id", id).maybeSingle();
  if (!data) return null;
  let phone: string | null = null;
  if (data.created_by) {
    const { data: owner } = await supabase.from("profiles")
      .select("phone_number").eq("id", data.created_by).maybeSingle();
    phone = owner?.phone_number ?? null;
  }
  return {
    role, id: data.id, name: data.name ?? "there",
    phone, territoryId: data.territory_id ?? null,
  };
}

function welcomeText(r: Recipient, links: Record<string, string>): string {
  const profileUrl = `${links.profile_link_base}/${r.role}/${r.id}`;
  if (r.role === "driver") {
    return `Welcome to G-Taxi, ${r.name}! \u{1F695}\n\n` +
      `Your driver profile is ready. Open it here to finish setup and start earning:\n${profileUrl}\n\n` +
      `Any questions, just reply to this message.`;
  }
  if (r.role === "merchant") {
    return `Welcome to G-Taxi, ${r.name}! \u{1F6CD}\n\n` +
      `Your store is set up. Manage your listing, hours and orders here:\n${profileUrl}\n\n` +
      `Any questions, just reply to this message.`;
  }
  return `Welcome to G-Taxi, ${r.name}! \u{1F44B}\n\n` +
    `Your profile is ready — set your saved places and payment here:\n${profileUrl}\n\n` +
    `Any questions, just reply to this message.`;
}

function zoneLiveText(name: string, zone: string, downloadUrl: string): string {
  return `Good news ${name} — G-Taxi is now live in ${zone}! \u{1F389}\n\n` +
    `We've got enough drivers on the road in your area. Download the app and take your first ride:\n${downloadUrl}`;
}

// waitlist.user_type is 'ride' | 'drive' | 'sell' (free text, no CHECK constraint
// live) — map to the right g_config.app_links key and a role-flavored message.
const WAITLIST_TYPE_TO_DOWNLOAD_KEY: Record<string, string> = {
  ride: "rider_download_url", drive: "driver_download_url", sell: "merchant_download_url",
};
const WAITLIST_TYPE_LABEL: Record<string, string> = { ride: "rider", drive: "driver", sell: "merchant" };

function waitlistApprovedText(name: string, userType: string, downloadUrl: string): string {
  return `Good news ${name} — you're approved on G-Taxi! \u{1F389}\n\n` +
    `Download the app and set up your ${WAITLIST_TYPE_LABEL[userType] ?? "profile"} — most of what you told us is already filled in:\n${downloadUrl}`;
}

/**
 * Backoff schedule for a failed send: 10 min, 20 min, 30 min, 40 min, capped
 * at 120 min. attemptCount is the count AFTER the failed attempt (i.e. the
 * number of tries so far, including this one).
 */
function backoffMinutes(attemptCount: number): number {
  return Math.min(10 * attemptCount, 120);
}

/**
 * Claim the right to send, then send. The insert is the lock: if the unique
 * index rejects it, this person already has this message and we stop. Claiming
 * BEFORE sending means a crash costs at most one unsent message, never a
 * duplicate — the safer direction for something that messages real people.
 *
 * A failed send is not the end: it gets up to max_attempts tries (default 5,
 * see retry_pending_sends) with growing backoff before it's marked 'failed'
 * for good.
 */
async function claimAndSend(
  supabase: any,
  args: {
    role: Role | "commander"; recipientId: string | null; phone: string;
    template: string; territoryId: string | null; body: string; payload?: Record<string, unknown>;
  },
): Promise<{ sent: boolean; reason?: string; channel?: string }> {
  const { data: claim, error: claimErr } = await supabase
    .from("outbound_messages")
    .insert({
      recipient_role: args.role,
      recipient_id: args.recipientId,
      phone: args.phone,
      template: args.template,
      territory_id: args.territoryId,
      payload: args.payload ?? {},
      body: args.body,
      status: "pending",
    })
    .select("id, attempt_count, max_attempts")
    .single();

  if (claimErr) {
    // 23505 = unique violation = already messaged. Not an error condition.
    if ((claimErr as any).code === "23505") return { sent: false, reason: "already_sent" };
    return { sent: false, reason: `claim_failed: ${claimErr.message}` };
  }

  const result = await sendWhatsApp(args.phone, args.body, { previewUrl: true });

  if (result.success) {
    await supabase.from("outbound_messages").update({
      status: "sent", channel: result.channel, error: null,
      sent_at: new Date().toISOString(),
    }).eq("id", claim.id);
    return { sent: true, channel: result.channel };
  }

  const willRetry = claim.attempt_count < claim.max_attempts;
  await supabase.from("outbound_messages").update({
    status: willRetry ? "pending_retry" : "failed",
    channel: result.channel,
    error: result.error ?? null,
    next_retry_at: willRetry
      ? new Date(Date.now() + backoffMinutes(claim.attempt_count) * 60_000).toISOString()
      : null,
  }).eq("id", claim.id);

  return { sent: false, reason: result.error, channel: result.channel };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorized(req))) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const payload = await req.json();
    const action = payload?.action;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- capacity_sweep : cron only ------------------------------------
    if (action === "capacity_sweep") {
      if (!(await isCron(req))) return json({ success: false, error: "Unauthorized" }, 401);

      const links = await readLinks(supabase);
      const { data: zones, error } = await supabase.rpc("territories_newly_full");
      if (error) return json({ success: false, error: error.message }, 500);

      const results: any[] = [];
      for (const zone of zones ?? []) {
        const { data: drivers } = await supabase.from("drivers")
          .select("id, name, phone_number")
          .eq("territory_id", zone.territory_id)
          .not("phone_number", "is", null);

        // profiles.territory_id (added by rider_territory_link_and_zone_seed)
        // is the rider-to-zone link that was previously missing — riders now
        // reach this fan-out the same way drivers do.
        const { data: riders } = await supabase.from("profiles")
          .select("id, full_name, phone_number")
          .eq("territory_id", zone.territory_id)
          .not("phone_number", "is", null);

        let sent = 0, skipped = 0, failed = 0;
        for (const d of drivers ?? []) {
          const r = await claimAndSend(supabase, {
            role: "driver", recipientId: d.id, phone: d.phone_number,
            template: "zone_live_download", territoryId: zone.territory_id,
            body: zoneLiveText(d.name ?? "there", zone.territory_name, links.driver_download_url),
            payload: { zone: zone.territory_name, capacity: zone.capacity },
          });
          if (r.sent) sent++;
          else if (r.reason === "already_sent") skipped++;
          else failed++;
        }

        let ridersSent = 0, ridersSkipped = 0, ridersFailed = 0;
        for (const r of riders ?? []) {
          const result = await claimAndSend(supabase, {
            role: "rider", recipientId: r.id, phone: r.phone_number,
            template: "zone_live_download", territoryId: zone.territory_id,
            body: zoneLiveText(r.full_name ?? "there", zone.territory_name, links.rider_download_url),
            payload: { zone: zone.territory_name, capacity: zone.capacity },
          });
          if (result.sent) ridersSent++;
          else if (result.reason === "already_sent") ridersSkipped++;
          else ridersFailed++;
        }

        // Stamp the zone ONLY after the fan-out. If this crashed earlier the
        // zone stays unstamped and the next run retries — and the outbox
        // unique index means the people already told are not told twice.
        await supabase.from("territories")
          .update({ capacity_reached_at: new Date().toISOString() })
          .eq("id", zone.territory_id);

        results.push({
          zone: zone.territory_name,
          verified_drivers: zone.verified_drivers,
          capacity: zone.capacity,
          drivers: { sent, skipped_already_sent: skipped, failed },
          riders: { sent: ridersSent, skipped_already_sent: ridersSkipped, failed: ridersFailed },
        });
      }

      return json({
        success: true,
        zones_triggered: results.length,
        results,
        note: results.length === 0
          ? "No zone met its driver_capacity. Set territories.driver_capacity to arm a zone."
          : undefined,
      });
    }

    // ---- retry_pending_sends : cron only ---------------------------------
    // Picks up every outbound_messages row whose retry is due and tries it
    // again. This is the actual "queue" behavior: a slow/down WhatsApp call
    // no longer means a message is lost, it means it's tried again later.
    if (action === "retry_pending_sends") {
      if (!(await isCron(req))) return json({ success: false, error: "Unauthorized" }, 401);

      const { data: due, error } = await supabase
        .from("outbound_messages")
        .select("id, phone, body, attempt_count, max_attempts")
        .eq("status", "pending_retry")
        .lte("next_retry_at", new Date().toISOString())
        .order("next_retry_at", { ascending: true })
        .limit(50);
      if (error) return json({ success: false, error: error.message }, 500);

      let retried = 0, sent = 0, stillFailing = 0, gaveUp = 0;
      for (const row of due ?? []) {
        if (!row.body) {
          // Rows from before this column existed have nothing to resend —
          // there are none live today (table was empty when this shipped),
          // but fail closed rather than send an empty message.
          await supabase.from("outbound_messages")
            .update({ status: "failed", error: "no body stored to retry" })
            .eq("id", row.id);
          gaveUp++;
          continue;
        }

        retried++;
        const result = await sendWhatsApp(row.phone, row.body, { previewUrl: true });
        const newAttemptCount = row.attempt_count + 1;

        if (result.success) {
          await supabase.from("outbound_messages").update({
            status: "sent", channel: result.channel, error: null,
            sent_at: new Date().toISOString(), attempt_count: newAttemptCount,
            next_retry_at: null,
          }).eq("id", row.id);
          sent++;
          continue;
        }

        const willRetryAgain = newAttemptCount < row.max_attempts;
        await supabase.from("outbound_messages").update({
          status: willRetryAgain ? "pending_retry" : "failed",
          channel: result.channel,
          error: result.error ?? null,
          attempt_count: newAttemptCount,
          next_retry_at: willRetryAgain
            ? new Date(Date.now() + backoffMinutes(newAttemptCount) * 60_000).toISOString()
            : null,
        }).eq("id", row.id);
        if (willRetryAgain) stillFailing++; else gaveUp++;
      }

      return json({ success: true, due: (due ?? []).length, retried, sent, still_failing: stillFailing, gave_up: gaveUp });
    }

    // ---- whatsapp_health : admin or cron --------------------------------
    // Proves the WhatsApp credentials actually work, the same "probe, don't
    // trust a config boolean" discipline g_briefing uses for LLM keys.
    // Read-only against Meta's API -- sends nothing to any person.
    if (action === "whatsapp_health") {
      const health = await checkWhatsAppHealth();
      console.log("[whatsapp_health]", JSON.stringify(health));
      return json({ success: health.valid, ...health });
    }

    // ---- whatsapp_token_scopes : admin only, diagnostic -------------------
    // Asks Meta directly what permissions/assets the current
    // WHATSAPP_ACCESS_TOKEN actually has, via Meta's own debug_token
    // endpoint. The token never leaves this function -- read from the env
    // var, sent straight to Meta, never returned or logged. This exists to
    // diagnose a real "Authorization Error" on send that persisted across
    // two regenerated tokens, which pointed at a scope/asset-assignment
    // problem rather than a bad token value.
    if (action === "whatsapp_token_scopes") {
      const adminId = await adminUserId(req);
      if (!adminId) return json({ success: false, error: "Forbidden: admin role required" }, 403);

      const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
      if (!token) return json({ success: false, error: "WHATSAPP_ACCESS_TOKEN not set" });

      try {
        const resp = await fetch(
          `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
        );
        const body = await resp.json();
        // Strip anything that could echo the token back before it ever
        // leaves this function -- Meta's error bodies have done this before.
        const safe = JSON.parse(JSON.stringify(body).split(token).join("[REDACTED]"));
        return json({ success: resp.ok, status: resp.status, result: safe });
      } catch (err: any) {
        return json({ success: false, error: err.message || "debug_token call failed" });
      }
    }

    // ---- whatsapp_register_number : admin only ---------------------------
    // Workaround for Meta's own dashboard registration flow being
    // unreachable/slow to load. Calls Meta's /{phone_number_id}/register
    // endpoint directly, the same action that dashboard "Register your
    // WhatsApp phone number" button performs. Needed to clear a real
    // "(#133010) Account not registered" error on send -- the number was
    // "Connected" in Business Manager but never formally registered for
    // Cloud API sending. The PIN is Meta's own 2-step-verification PIN for
    // this phone number; it is never logged or echoed back.
    if (action === "whatsapp_register_number") {
      const adminId = await adminUserId(req);
      if (!adminId) return json({ success: false, error: "Forbidden: admin role required" }, 403);

      const pin = (payload?.pin as string ?? "").replace(/\D/g, "");
      if (pin.length !== 6) {
        return json({ success: false, error: "pin must be exactly 6 digits" }, 400);
      }

      const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
      const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
      if (!token || !phoneNumberId) {
        return json({ success: false, error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" });
      }

      try {
        const resp = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/register`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ messaging_product: "whatsapp", pin }),
          },
        );
        const body = await resp.json();
        const safe = JSON.parse(JSON.stringify(body).split(token).join("[REDACTED]"));
        return json({ success: resp.ok, status: resp.status, result: safe });
      } catch (err: any) {
        return json({ success: false, error: err.message || "register call failed" });
      }
    }

    // ---- send_test_message : admin only ---------------------------------
    // A real end-to-end send an admin can trigger on demand, to any phone
    // number they type in -- including their own. Distinct from
    // whatsapp_health (which never sends anything) and from send_welcome
    // (which requires an existing rider/driver/merchant profile row).
    // Doesn't go through claimAndSend/outbound_messages -- there is no
    // recipient row to dedupe against, this is an ad-hoc test, meant to be
    // sendable more than once.
    if (action === "send_test_message") {
      const adminId = await adminUserId(req);
      if (!adminId) return json({ success: false, error: "Forbidden: admin role required" }, 403);

      const phone = (payload?.phone as string ?? "").replace(/\D/g, "");
      if (phone.length < 7) {
        return json({ success: false, error: "Enter a valid phone number (digits, incl. country code)" }, 400);
      }

      const body = `G-Taxi test message \u{1F44B}\n\nIf you're reading this, WhatsApp sending is working. Sent from the admin dashboard at ${new Date().toLocaleString()}.`;
      const result = await sendWhatsApp(phone, body, { previewUrl: false });

      // The Cloud API is still blocked on real Meta-side account registration
      // (verified: "(#133010) Account not registered", 2026-09-20). Rather
      // than leave the admin with nothing, hand back a wa.me deep link they
      // can click to send the exact same message themselves right now --
      // same fallback pattern Waitlist.tsx/approve_waitlist already use.
      return json({
        success: result.success,
        channel: result.channel,
        error: result.success ? undefined : result.error,
        deepLink: result.success ? undefined : getDeepLink(phone, body),
      });
    }

    // ---- send_welcome : admin only -------------------------------------
    if (action === "send_welcome") {
      const adminId = await adminUserId(req);
      if (!adminId) return json({ success: false, error: "Forbidden: admin role required" }, 403);

      const role = payload?.role as Role;
      const id = payload?.id as string;
      if (!["rider", "driver", "merchant"].includes(role) || !id) {
        return json({ success: false, error: "role (rider|driver|merchant) and id are required" }, 400);
      }

      const recipient = await resolveRecipient(supabase, role, id);
      if (!recipient) return json({ success: false, error: `${role} ${id} not found` }, 404);
      if (!recipient.phone) {
        return json({
          success: false,
          reason: "no_phone_on_file",
          detail: role === "merchant"
            ? "This merchant has no owner account linked (merchants.created_by is null), so there is no number to message."
            : "This person has no phone_number on record.",
        });
      }

      const links = await readLinks(supabase);
      const result = await claimAndSend(supabase, {
        role, recipientId: recipient.id, phone: recipient.phone,
        template: "welcome", territoryId: recipient.territoryId,
        body: welcomeText(recipient, links),
        payload: { name: recipient.name, sent_by_admin: adminId },
      });

      return json({
        success: result.sent,
        recipient: { role, id: recipient.id, name: recipient.name },
        channel: result.channel,
        reason: result.reason,
        // channel "noop" is sms.ts saying the WhatsApp Business creds are
        // absent, so NOTHING was delivered. Surfacing this matters: the call
        // still returns 200 and would otherwise read as a success.
        note: result.channel === "noop"
          ? "NOT DELIVERED — WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not set as Supabase secrets, so the WhatsApp send was a no-op. The outbox row is marked failed."
          : undefined,
      });
    }

    // ---- approve_waitlist : admin only ----------------------------------
    // The actual gate for "sign up, wait a spell, then get the app". Marks one
    // waitlist row approved and sends the download-link WhatsApp. Reuses the
    // same claimAndSend/outbound_messages idempotency the other two actions
    // use, so re-clicking Approve twice on the same row cannot double-send.
    if (action === "approve_waitlist") {
      const adminId = await adminUserId(req);
      if (!adminId) return json({ success: false, error: "Forbidden: admin role required" }, 403);

      const waitlistId = payload?.id as string;
      if (!waitlistId) return json({ success: false, error: "id is required" }, 400);

      const { data: row, error: rowErr } = await supabase
        .from("waitlist")
        .select("id, full_name, phone, user_type, status")
        .eq("id", waitlistId)
        .maybeSingle();
      if (rowErr) return json({ success: false, error: rowErr.message }, 500);
      if (!row) return json({ success: false, error: `waitlist row ${waitlistId} not found` }, 404);
      if (!row.phone) {
        return json({ success: false, reason: "no_phone_on_file", detail: "This waitlist entry has no phone number." });
      }
      if (row.status === "approved" || row.status === "claimed") {
        return json({ success: false, reason: "already_approved", detail: `This entry is already ${row.status}.` });
      }

      const { error: updateErr } = await supabase
        .from("waitlist")
        .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: adminId })
        .eq("id", waitlistId);
      if (updateErr) return json({ success: false, error: updateErr.message }, 500);

      const links = await readLinks(supabase);
      const downloadKey = WAITLIST_TYPE_TO_DOWNLOAD_KEY[row.user_type ?? "ride"] ?? "rider_download_url";
      const outboxRole = WAITLIST_TYPE_LABEL[row.user_type ?? "ride"] ?? "rider";
      const messageBody = waitlistApprovedText(row.full_name ?? "there", row.user_type ?? "ride", links[downloadKey]);
      const result = await claimAndSend(supabase, {
        role: outboxRole as Role, recipientId: row.id, phone: row.phone,
        template: "waitlist_approved", territoryId: null,
        body: messageBody,
        payload: { name: row.full_name, approved_by: adminId },
      });

      return json({
        success: result.sent,
        waitlist_id: row.id,
        status: "approved",
        channel: result.channel,
        reason: result.reason,
        // The approval itself always succeeds and is recorded even when
        // delivery fails — don't let a broken WhatsApp integration look like
        // the approval never happened. Covers both failure shapes seen live:
        // "noop" (creds absent) and a whatsapp_api error (creds present but
        // the token is invalid/expired — the actual state as of 2026-09-07,
        // see project_credential_health_2026_09_07).
        note: !result.sent
          ? (result.channel === "noop"
              ? "APPROVED, BUT NOT DELIVERED — WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not set as Supabase secrets, so the WhatsApp send was a no-op."
              : `APPROVED, BUT NOT DELIVERED — WhatsApp send failed (${result.reason ?? "unknown error"}). The outbox row is marked failed; status is still approved.`)
          : undefined,
        // While the Business API is down (no verified WhatsApp Business
        // account yet — see docs/agents notes), this is a real, working
        // substitute: it opens the ADMIN's own WhatsApp with the message
        // already typed, ready to hit send. No API, no token, no Meta
        // approval needed — just a plain wa.me link.
        deep_link: !result.sent ? getDeepLink(row.phone, messageBody) : undefined,
      });
    }

    // ---- default: the original admin push alert ------------------------
    const { title, body, data } = payload ?? {};
    if (!title || !body) return json({ success: false, error: "title and body required" }, 400);

    const { data: admins } = await supabase
      .from("profiles")
      .select("push_token")
      .eq("role", "admin")
      .not("push_token", "is", null);

    await Promise.allSettled(
      (admins ?? []).map((a: { push_token: string }) => sendExpoPush(a.push_token, title, body, data)),
    );

    return json({ success: true, notified: admins?.length ?? 0 });
  } catch (err: any) {
    console.error("notify_admins error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
});
