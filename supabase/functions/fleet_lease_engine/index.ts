// Supabase Edge Function: fleet_lease_engine
// ============================================================
// FLEET LEASING ENGINE
//   - Create and manage fleet vehicle leases
//   - Apply daily lease fees (triggered by cron or webhook)
//   - Query lease status and payment history for drivers
//   - Calculate lease deduction impact on driver payout
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, requireAdmin } from "../_shared/auth.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "default";
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // PROTECTED: Driver views their own lease
    if (action === "my_lease" && req.method === "GET") {
      const user = await requireAuth(req);

      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!driver) {
        return new Response(
          JSON.stringify({ success: false, error: "Driver profile not found", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: lease, error } = await supabaseAdmin
        .from("fleet_leases")
        .select(`
          *,
          vehicle:fleet_vehicles!inner(
            id, make, model, year, license_plate, vehicle_type,
            odometer_km, next_maintenance_due_at
          ),
          payments:lease_payments(
            id, amount_cents, deduction_type, mileage_km,
            billing_period_start, billing_period_end,
            status, deducted_at
          )
        `)
        .eq("driver_id", driver.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lease) {
        return new Response(
          JSON.stringify({ success: true, error: null, data: { lease: null, message: "No active lease" } }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate today's deductions
      const todayDeductions = lease.payments
        ?.filter((p: any) =>
          p.billing_period_start <= new Date().toISOString().split("T")[0] &&
          p.status === "deducted"
        )
        .reduce((sum: number, p: any) => sum + p.amount_cents, 0) || 0;

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            lease,
            summary: {
              today_deductions_cents: todayDeductions,
              today_deductions_dollars: (todayDeductions / 100).toFixed(2),
              daily_rate_cents: lease.daily_rate_cents,
              daily_rate_dollars: (lease.daily_rate_cents / 100).toFixed(2),
            },
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Create a new fleet lease
    if (action === "create_lease" && req.method === "POST") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const body = await req.json();

      if (!body.fleet_vehicle_id || !body.driver_id) {
        return new Response(
          JSON.stringify({ success: false, error: "fleet_vehicle_id and driver_id required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify vehicle is available
      const { data: vehicle } = await admin
        .from("fleet_vehicles")
        .select("id, status, region_id")
        .eq("id", body.fleet_vehicle_id)
        .single();

      if (!vehicle || vehicle.status !== "available") {
        return new Response(
          JSON.stringify({ success: false, error: "Vehicle not available for lease", data: null }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check driver doesn't already have an active lease
      const { data: existingLease } = await admin
        .from("fleet_leases")
        .select("id")
        .eq("driver_id", body.driver_id)
        .eq("status", "active")
        .maybeSingle();

      if (existingLease) {
        return new Response(
          JSON.stringify({ success: false, error: "Driver already has an active lease", data: null }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const leaseType = body.lease_type || "daily";
      const dailyRateCents = body.daily_rate_cents ||
        (vehicle.region_id ? null : 3000);
      const mileageRateCents = body.mileage_rate_cents ||
        (vehicle.region_id ? null : 50);

      const { data: lease, error } = await admin
        .from("fleet_leases")
        .insert({
          fleet_vehicle_id: body.fleet_vehicle_id,
          driver_id: body.driver_id,
          start_date: body.start_date || new Date().toISOString().split("T")[0],
          end_date: body.end_date || null,
          lease_type: leaseType,
          daily_rate_cents: dailyRateCents,
          mileage_rate_cents: mileageRateCents,
          weekly_minimum_cents: body.weekly_minimum_cents || null,
          security_deposit_cents: body.security_deposit_cents || 0,
          region_id: body.region_id || vehicle.region_id || null,
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mark vehicle as leased and link driver to lease
      await admin.from("fleet_vehicles").update({ status: "leased" }).eq("id", body.fleet_vehicle_id);
      await admin.from("drivers").update({ fleet_lease_id: lease.id }).eq("id", body.driver_id);

      return new Response(
        JSON.stringify({ success: true, error: null, data: { lease } }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Terminate a fleet lease
    if (action === "terminate_lease" && req.method === "POST") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const { lease_id, reason } = await req.json();

      if (!lease_id) {
        return new Response(
          JSON.stringify({ success: false, error: "lease_id required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: lease } = await admin
        .from("fleet_leases")
        .select("id, fleet_vehicle_id, driver_id, status")
        .eq("id", lease_id)
        .single();

      if (!lease || lease.status !== "active") {
        return new Response(
          JSON.stringify({ success: false, error: "Lease not found or not active", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await admin.from("fleet_leases").update({
        status: "terminated",
        termination_reason: reason || null,
        terminated_at: new Date().toISOString(),
      }).eq("id", lease_id);

      // Return vehicle to available
      await admin.from("fleet_vehicles").update({ status: "available" }).eq("id", lease.fleet_vehicle_id);
      await admin.from("drivers").update({ fleet_lease_id: null }).eq("id", lease.driver_id);

      return new Response(
        JSON.stringify({ success: true, error: null, data: { message: "Lease terminated" } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Apply daily lease fees (can be called by cron job)
    if (action === "apply_daily_fees" && req.method === "POST") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const body = await req.json();
      const leaseId = body.lease_id;
      const applyDate = body.date || new Date().toISOString().split("T")[0];

      let leases: any[];

      if (leaseId) {
        // Apply for a specific lease
        const { data: single } = await admin
          .from("fleet_leases")
          .select("id, daily_rate_cents, lease_type")
          .eq("id", leaseId)
          .eq("status", "active");

        leases = single || [];
      } else {
        // Apply for all active daily/hybrid leases
        const { data: all } = await admin
          .from("fleet_leases")
          .select("id, daily_rate_cents, lease_type")
          .eq("status", "active")
          .in("lease_type", ["daily", "hybrid"]);

        leases = all || [];
      }

      const results: Array<{ lease_id: string; success: boolean; amount_cents: number; error?: string }> = [];

      for (const l of leases) {
        const { data: deduction } = await admin
          .rpc("deduct_daily_lease_fee", {
            p_lease_id: l.id,
            p_date: applyDate,
          });

        results.push({
          lease_id: l.id,
          success: deduction?.[0]?.success || false,
          amount_cents: deduction?.[0]?.amount_cents || 0,
          error: deduction?.[0]?.error_message || undefined,
        });
      }

      const totalDeducted = results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.amount_cents, 0);

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            results,
            summary: {
              total_leases_processed: leases.length,
              successful_deductions: results.filter((r) => r.success).length,
              failed_deductions: results.filter((r) => !r.success).length,
              total_deducted_cents: totalDeducted,
              total_deducted_dollars: (totalDeducted / 100).toFixed(2),
              date: applyDate,
            },
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Get fleet revenue report
    if (action === "report" && req.method === "GET") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const startDate = url.searchParams.get("start_date") || new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const endDate = url.searchParams.get("end_date") || new Date().toISOString().split("T")[0];
      const leaseId = url.searchParams.get("lease_id");

      let query = admin
        .from("lease_payments")
        .select(`
          *,
          lease:fleet_leases!inner(
            id,
            lease_type,
            daily_rate_cents,
            mileage_rate_cents,
            driver:drivers!inner(name, phone_number)
          )
        `)
        .gte("billing_period_start", startDate)
        .lte("billing_period_end", endDate);

      if (leaseId) query = query.eq("lease_id", leaseId);

      const { data: payments, error } = await query.order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalDeductedCents = payments
        ?.filter((p: any) => p.status === "deducted")
        .reduce((sum: number, p: any) => sum + p.amount_cents, 0) || 0;

      const totalFailedCents = payments
        ?.filter((p: any) => p.status === "failed")
        .reduce((sum: number, p: any) => sum + p.amount_cents, 0) || 0;

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            payments,
            summary: {
              total_payments: payments?.length || 0,
              deducted_payments: payments?.filter((p: any) => p.status === "deducted").length || 0,
              failed_payments: payments?.filter((p: any) => p.status === "failed").length || 0,
              total_deducted_cents: totalDeductedCents,
              total_deducted_dollars: (totalDeductedCents / 100).toFixed(2),
              total_failed_cents: totalFailedCents,
              total_failed_dollars: (totalFailedCents / 100).toFixed(2),
              currency: "TTD",
              period: { start: startDate, end: endDate },
            },
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // FALLBACK
    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: {
          available_actions: [
            "GET ?action=my_lease — Driver views their active lease",
            "POST ?action=create_lease — Admin creates new fleet lease",
            "POST ?action=terminate_lease — Admin terminates a lease",
            "POST ?action=apply_daily_fees — Apply daily lease fees (cron or manual)",
            "GET ?action=report — Fleet revenue report",
          ],
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("fleet_lease_engine error:", error);
    await captureException(error, { function: "fleet_lease_engine" });
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
