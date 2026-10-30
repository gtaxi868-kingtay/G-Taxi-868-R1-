// Supabase Edge Function: process_lease_defaults
// Cron worker — runs every 6 hours.
//
// Rewritten 2026-09-02: the previous version read and wrote `driver_leases`,
// a table with a completely different column set (daily_deduction_cents,
// total_lease_cents, paid_to_date_cents) than the one real leases actually
// live in — `fleet_leases` (daily_rate_cents, weekly_minimum_cents,
// per_ride_installment_cents). admin_decide_garage_request creates leases
// in fleet_leases; driver_lease_status (what the driver app reads) also
// reads fleet_leases. Only this cron pointed at the wrong table — both
// tables were empty when this was found, so nothing had broken yet, but
// the first real lease approved would never have been watched for
// default. This version operates on fleet_leases + the real
// payment-by-payment lease_payments table.
//
// fleet_leases.status has no 'defaulted' value (CHECK constraint only
// allows active/suspended/terminated/completed) — it already has a
// suspension_reason column, and driver_lease_status already renders a
// LEASE_SUSPENDED state from exactly that combination. Reusing it rather
// than adding a new status value keeps this change minimal and reuses a
// path that's already correctly wired end-to-end for the driver.
//
// Deliberately does NOT auto-enable fleet_vehicles.ignition_cutoff_enabled.
// This codebase has no real geofence data for T&T's highways, so there is
// no honest way to enforce "never cut ignition on a highway" here — an
// unconditional cutoff would be worse than the bug this replaces. GPS
// visibility (gps_relay_enabled) is turned on automatically since it's
// passive; the actual ignition cutoff stays a human admin decision,
// surfaced via the existing system_alerts feed.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";


const DEFAULT_GRACE_DAYS = 7;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronHeader = req.headers.get("x-cron-secret");
  if (!PLATFORM_CRON_SECRET || cronHeader !== PLATFORM_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // ── 1. LEASE DEFAULT DETECTION ──────────────────────────────────
  const { data: activeLeases } = await supabase
    .from("fleet_leases")
    .select("id, driver_id, fleet_vehicle_id, created_at, drivers(user_id)")
    .eq("status", "active");

  let defaulted = 0;
  let insuranceBlocked = 0;

  if (activeLeases?.length) {
    for (const lease of activeLeases) {
      // Real signal: the most recent successfully-deducted lease payment,
      // not a bare updated_at (which any incidental UPDATE — e.g. a
      // dispute note — would reset without a real payment happening).
      const { data: lastPayment } = await supabase
        .from("lease_payments")
        .select("deducted_at, paid_at")
        .eq("lease_id", lease.id)
        .eq("status", "deducted")
        .order("deducted_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const lastPaymentAt = lastPayment
        ? new Date(lastPayment.deducted_at ?? lastPayment.paid_at ?? lease.created_at)
        : new Date(lease.created_at);

      if (lastPaymentAt > graceCutoff) continue; // paid recently enough, not stale

      // Driver hasn't paid — but if they've actually completed rides in
      // the grace window, the per-ride deduction just hasn't posted yet.
      // Don't default a driver who's working.
      const { data: recentRide } = await supabase
        .from("rides")
        .select("id")
        .eq("driver_id", lease.driver_id)
        .eq("status", "completed")
        .gte("completed_at", graceCutoff.toISOString())
        .limit(1)
        .maybeSingle();

      if (recentRide) continue;

      const { error: leaseSuspendError } = await supabase
        .from("fleet_leases")
        .update({
          status: "suspended",
          suspension_reason: `Payment default — no lease payment recorded since ${lastPaymentAt.toISOString().slice(0, 10)}`,
          dispute_open: false,
          updated_at: now.toISOString(),
        })
        .eq("id", lease.id);

      if (leaseSuspendError) {
        console.error(`Failed to suspend defaulted lease ${lease.id}:`, leaseSuspendError);
        continue;
      }

      if (lease.fleet_vehicle_id) {
        const { error: gpsEnableError } = await supabase
          .from("fleet_vehicles")
          .update({ gps_relay_enabled: true })
          .eq("id", lease.fleet_vehicle_id);
        if (gpsEnableError) {
          console.error(`Failed to enable GPS visibility for lease ${lease.id}:`, gpsEnableError);
        }
      }

      const { error: alertError } = await supabase.from("system_alerts").insert({
        type: "LEASE_DEFAULT",
        title: "Driver lease defaulted",
        details: {
          message: `Lease ${lease.id} defaulted — no payment recorded since ${lastPaymentAt.toISOString()}. GPS visibility enabled. Ignition cutoff requires manual admin action (no highway-geofence data exists to gate an automatic cutoff safely).`,
          lease_id: lease.id,
          driver_id: lease.driver_id,
          fleet_vehicle_id: lease.fleet_vehicle_id,
        },
        severity: "HIGH",
      });
      if (alertError) {
        console.error(`Failed to record lease default alert for lease ${lease.id}:`, alertError);
      }

      // drivers_status_check only allows online/offline/busy — there is no
      // 'suspended' driver status (that concept lives on fleet_leases,
      // already set above). Taking the driver offline is the real,
      // constraint-valid action here; a prior version of this line wrote
      // status: "suspended" wrapped in a swallowed .then(), so it silently
      // failed on every real default and never took the driver offline.
      const { error: offlineError } = await supabase
        .from("drivers")
        .update({ is_online: false })
        .eq("id", lease.driver_id);

      if (offlineError) {
        console.error(`Failed to take driver ${lease.driver_id} offline for lease default:`, offlineError);
        continue;
      }

      // is_online=false alone is not a real block — the very next GPS ping
      // from update_driver_location sets it back to true. Single-account
      // block (per explicit scope decision — no national_id_hash/KYC
      // cross-account blocking in this pass): stop the account itself from
      // driving until admin review, enforced server-side in requireDriver.
      const driverUserId = (lease as any).drivers?.user_id;
      if (!driverUserId) {
        console.error(`Cannot platform-block driver ${lease.driver_id} for lease default: driver user_id missing`);
        continue;
      }

      const { error: blockError } = await supabase
        .from("profiles")
        .update({
          platform_blocked: true,
          platform_blocked_reason: "Lease payment default — contact support to resolve.",
          platform_blocked_at: now.toISOString(),
        })
        .eq("id", driverUserId);

      if (blockError) {
        console.error(`Failed to platform-block driver ${lease.driver_id} for lease default:`, blockError);
        continue;
      }

      defaulted++;
    }
  }

  // ── 2. INSURANCE EXPIRY — auto-disable online ──────────────────
  // drivers_status_check only allows online/offline/busy — there is no
  // 'active' driver status. A prior .eq("status", "active") filter here
  // could never match any row (confirmed live: 0 drivers have ever had
  // status='active'), so this entire block has silently never fired.
  // is_online = true already scopes this to drivers currently driving.
  // NULL insurance_expires_at means no insurance was ever approved onto
  // the driver's record — the state of every pre-gate driver. A plain
  // .lte() can never match NULL, so not-on-file drivers were never swept;
  // the .or() below treats NULL as non-compliant, same as the go-online
  // gate (check_driver_insurance_compliance) does.
  const { data: expiredInsurance } = await supabase
    .from("drivers")
    .select("id, name, user_id, is_online, insurance_expires_at")
    .or(`insurance_expires_at.is.null,insurance_expires_at.lte.${now.toISOString()}`)
    .eq("is_online", true);

  if (expiredInsurance?.length) {
    for (const driver of expiredInsurance) {
      await supabase
        .from("drivers")
        .update({ is_online: false })
        .eq("id", driver.id);

      if (driver.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("push_token")
          .eq("id", driver.user_id)
          .maybeSingle();

        if (profile?.push_token) {
          try {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: profile.push_token,
                title: driver.insurance_expires_at
                  ? "Insurance expired — driving disabled"
                  : "Insurance not on file — driving disabled",
                body: driver.insurance_expires_at
                  ? "Your insurance has expired. Upload a new certificate to resume driving."
                  : "No insurance on file. Submit your certificate to resume driving.",
                data: { type: "insurance_expired", driver_id: driver.id },
              }),
            });
          } catch { /* best-effort notification */ }
        }
      }

      insuranceBlocked++;
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      leases_defaulted: defaulted,
      insurance_blocked: insuranceBlocked,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
