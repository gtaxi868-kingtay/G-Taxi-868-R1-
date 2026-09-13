// Supabase Edge Function: process_lease_defaults
// Cron worker — runs every 6 hours.
// Identifies leases where paid_to_date_cents hasn't increased in 7+ days
// (driver stopped working). Marks as defaulted, enables GPS recovery.
// Also checks insurance expiry and auto-disables online status.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronHeader = req.headers.get("x-cron-secret");
  if (!PLATFORM_CRON_SECRET || cronHeader !== PLATFORM_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. LEASE DEFAULT DETECTION ──────────────────────────────────
  // Find leases where updated_at hasn't changed in 7+ days (no recent deduction)
  const { data: staleLeases } = await supabase
    .from("driver_leases")
    .select("id, driver_id, fleet_vehicle_id, daily_deduction_cents, paid_to_date_cents, total_lease_cents, updated_at")
    .eq("status", "active")
    .lte("updated_at", sevenDaysAgo);

  let defaulted = 0;
  let insuranceBlocked = 0;

  if (staleLeases?.length) {
    for (const lease of staleLeases) {
      // Verify driver hasn't worked
      const { data: recentRide } = await supabase
        .from("rides")
        .select("id")
        .eq("driver_id", lease.driver_id)
        .eq("status", "completed")
        .gte("completed_at", sevenDaysAgo)
        .limit(1)
        .maybeSingle();

      if (recentRide) continue; // Driver is working, deduction will catch up

      await supabase
        .from("driver_leases")
        .update({
          status: "defaulted",
          gps_relay_enabled: true,
          updated_at: now.toISOString(),
        })
        .eq("id", lease.id);

      // Notify admin
      await supabase.from("system_alerts").insert({
        type: "LEASE_DEFAULT",
        title: "Driver lease defaulted",
        details: {
          message: `Lease ${lease.id} defaulted — driver inactive 7+ days. GPS recovery enabled.`,
          lease_id: lease.id,
          driver_id: lease.driver_id,
          remaining_cents: lease.total_lease_cents - lease.paid_to_date_cents,
        },
        severity: "HIGH",
      }).then((__r) => __r, () => null);

      // Block driver from going online
      await supabase
        .from("drivers")
        .update({ is_online: false, status: "suspended" })
        .eq("id", lease.driver_id)
        .then((__r) => __r, () => null);

      defaulted++;
    }
  }

  // ── 2. INSURANCE EXPIRY — auto-disable online ──────────────────
  const { data: expiredInsurance } = await supabase
    .from("drivers")
    .select("id, name, is_online")
    .eq("status", "active")
    .lte("insurance_expires_at", now.toISOString())
    .eq("is_online", true);

  if (expiredInsurance?.length) {
    for (const driver of expiredInsurance) {
      await supabase
        .from("drivers")
        .update({ is_online: false })
        .eq("id", driver.id);

      // Notify driver
      let targetUserId: string | null = null;
      try {
        const { data: d } = await supabase.from("drivers").select("user_id").eq("id", driver.id).single();
        targetUserId = d?.user_id ?? null;
      } catch (e) {
        console.error("[lease_default] driver lookup failed:", e);
      }

      let profile: { push_token?: string } | null = null;
      if (targetUserId) {
        try {
          const { data: p } = await supabase.from("profiles").select("push_token").eq("id", targetUserId).single();
          profile = p;
        } catch (e) {
          console.error("[lease_default] push token lookup failed:", e);
        }
      }

      if (profile?.push_token) {
        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: profile.push_token,
              title: "Insurance expired — driving disabled",
              body: "Your insurance has expired. Upload a new certificate to resume driving.",
              data: { type: "insurance_expired", driver_id: driver.id },
            }),
          });
        } catch { }
      }

      insuranceBlocked++;
    }
  }

  // ── 3. GPS RELAY ACTIVATION for defaulted leases ────────────────
  // In production this would communicate with a GPS relay API (e.g., IoTsPAS, Trakka)
  // For now, we log the relay activation intent and update vehicle record.
  const { data: defaultedLeases } = await supabase
    .from("driver_leases")
    .select("id, driver_id, fleet_vehicle_id, gps_relay_id")
    .eq("status", "defaulted")
    .eq("gps_relay_enabled", false);

  if (defaultedLeases?.length) {
    for (const dl of defaultedLeases) {
      // Enable GPS relay on the vehicle
      if (dl.fleet_vehicle_id) {
        await supabase
          .from("fleet_vehicles")
          .update({
            gps_relay_enabled: true,
            ignition_cutoff_enabled: true,
          })
          .eq("id", dl.fleet_vehicle_id)
          .then((__r) => __r, () => null);

        await supabase
          .from("driver_leases")
          .update({ gps_relay_enabled: true, updated_at: now.toISOString() })
          .eq("id", dl.id);
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      leases_defaulted: defaulted,
      insurance_blocked: insuranceBlocked,
      gps_relays_activated: defaultedLeases?.length ?? 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
