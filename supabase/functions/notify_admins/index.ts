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

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsApp } from "../_shared/sms.ts";

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
      .select("id, full_name, phone_number").eq("id", id).maybeSingle();
    if (!data) return null;
    return {
      role, id: data.id, name: data.full_name ?? "there",
      phone: data.phone_number ?? null, territoryId: null,
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
 * Claim the right to send, then send. The insert is the lock: if the unique
 * index rejects it, this person already has this message and we stop. Claiming
 * BEFORE sending means a crash costs at most one unsent message, never a
 * duplicate — the safer direction for something that messages real people.
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
      status: "pending",
    })
    .select("id")
    .single();

  if (claimErr) {
    // 23505 = unique violation = already messaged. Not an error condition.
    if ((claimErr as any).code === "23505") return { sent: false, reason: "already_sent" };
    return { sent: false, reason: `claim_failed: ${claimErr.message}` };
  }

  const result = await sendWhatsApp(args.phone, args.body, { previewUrl: true });

  await supabase.from("outbound_messages").update({
    status: result.success ? "sent" : "failed",
    channel: result.channel,
    error: result.success ? null : (result.error ?? null),
    sent_at: result.success ? new Date().toISOString() : null,
  }).eq("id", claim.id);

  return { sent: result.success, reason: result.error, channel: result.channel };
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
        // Riders have no territory column, so the people a zone can actually
        // reach today are its drivers. Telling riders needs a rider-to-zone
        // link that does not exist in the schema yet — flagged, not faked.
        const { data: drivers } = await supabase.from("drivers")
          .select("id, name, phone_number")
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
          sent, skipped_already_sent: skipped, failed,
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
      const result = await claimAndSend(supabase, {
        role: outboxRole as Role, recipientId: row.id, phone: row.phone,
        template: "waitlist_approved", territoryId: null,
        body: waitlistApprovedText(row.full_name ?? "there", row.user_type ?? "ride", links[downloadKey]),
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
