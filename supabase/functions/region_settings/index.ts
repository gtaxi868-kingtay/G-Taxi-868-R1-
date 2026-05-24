// Supabase Edge Function: region_settings
// ============================================================
// REGIONAL SCALABILITY ENGINE
//   - CRUD operations for region configurations
//   - Resolve region settings by ID, code, or geolocation
//   - Validate that a region configuration is complete
//   - "Copy-paste" a region config as a template for new countries
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "default";
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // PUBLIC: Resolve current region settings
    // This is called by apps to get pricing, currency, and compliance config
    if (action === "resolve" && req.method === "GET") {
      await requireAuth(req);

      const regionId = url.searchParams.get("region_id");
      const regionCode = url.searchParams.get("region_code");

      // Fetch the region config
      const { data: region, error } = await supabaseAdmin
        .rpc("get_region_settings", {
          p_region_id: regionId || null,
          p_region_code: regionCode || null,
        });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!region) {
        return new Response(
          JSON.stringify({ success: false, error: "No region configuration found", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Return a clean, flat config object that the app can consume directly
      const config = typeof region === "string" ? JSON.parse(region) : region;

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            region: config,
            pricing: {
              base_fare_cents: config.base_fare_cents,
              per_km_cents: config.per_km_cents,
              per_min_cents: config.per_min_cents,
              min_fare_cents: config.min_fare_cents,
              currency: config.currency,
              currency_symbol: config.currency_symbol,
            },
            compliance: config.compliance_config,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUBLIC: Resolve region by GPS coordinates
    if (action === "resolve_by_location" && req.method === "GET") {
      const user = await requireAuth(req);

      const lat = parseFloat(url.searchParams.get("lat") || "0");
      const lng = parseFloat(url.searchParams.get("lng") || "0");

      if (!lat || !lng) {
        return new Response(
          JSON.stringify({ success: false, error: "lat and lng query params required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: regionId } = await supabaseAdmin
        .rpc("resolve_region_for_location", {
          p_lat: lat,
          p_lng: lng,
        });

      if (!regionId) {
        return new Response(
          JSON.stringify({ success: false, error: "No region configured for this location", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Resolve full config
      const { data: region } = await supabaseAdmin
        .rpc("get_region_settings", {
          p_region_id: regionId,
          p_region_code: null,
        });

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            region_id: regionId,
            region: typeof region === "string" ? JSON.parse(region) : region,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUBLIC: List all active regions
    if (action === "list" && req.method === "GET") {
      await requireAuth(req);

      const { data: regions, error } = await supabaseAdmin
        .from("region_settings")
        .select("id, code, name, currency, currency_symbol, is_active")
        .eq("is_active", true)
        .order("name");

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, error: null, data: { regions } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Create a new region (Copy-paste expansion)
    if (action === "create" && req.method === "POST") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const body = await req.json();

      if (!body.code || !body.name) {
        return new Response(
          JSON.stringify({ success: false, error: "code and name required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check for duplicate code
      const { data: existing } = await admin
        .from("region_settings")
        .select("id")
        .eq("code", body.code)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: false, error: `Region code '${body.code}' already exists`, data: null }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If template_region_code provided, copy all settings from that region
      let defaults: Record<string, any> = {};
      if (body.template_region_code) {
        const { data: template } = await admin
          .from("region_settings")
          .select("*")
          .eq("code", body.template_region_code)
          .single();

        if (template) {
          const { id, code, name, created_at, updated_at, ...templateDefaults } = template;
          defaults = templateDefaults;
        }
      }

      const { data: region, error } = await admin
        .from("region_settings")
        .insert({
          code: body.code,
          name: body.name,
          currency: body.currency || defaults.currency || "BBD",
          currency_symbol: body.currency_symbol || defaults.currency_symbol || "BB$",
          locale: body.locale || defaults.locale || "en-BB",
          timezone: body.timezone || defaults.timezone || "America/Barbados",
          default_commission_rate: body.default_commission_rate ?? defaults.default_commission_rate ?? 22.00,
          default_driver_payout_rate: body.default_driver_payout_rate ?? defaults.default_driver_payout_rate ?? 81.00,
          default_merchant_split_rate: body.default_merchant_split_rate ?? defaults.default_merchant_split_rate ?? 5.00,
          min_fare_cents: body.min_fare_cents ?? defaults.min_fare_cents ?? 2200,
          base_fare_cents: body.base_fare_cents ?? defaults.base_fare_cents ?? 1600,
          per_km_cents: body.per_km_cents ?? defaults.per_km_cents ?? 175,
          per_min_cents: body.per_min_cents ?? defaults.per_min_cents ?? 95,
          cancellation_fee_cents: body.cancellation_fee_cents ?? defaults.cancellation_fee_cents ?? 500,
          gps_proximity_dropoff_meters: body.gps_proximity_dropoff_meters ?? defaults.gps_proximity_dropoff_meters ?? 150,
          lease_daily_rate_cents: body.lease_daily_rate_cents ?? defaults.lease_daily_rate_cents ?? 3000,
          lease_mileage_rate_cents: body.lease_mileage_rate_cents ?? defaults.lease_mileage_rate_cents ?? 50,
          compliance_config: body.compliance_config || defaults.compliance_config || {},
          metadata: body.metadata || defaults.metadata || {},
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            region,
            message: `Region '${body.code}' created. All take-rates, pricing, and lease defaults are configured. The platform is now operational in ${body.name}.`,
          },
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Update a region
    if (action === "update" && req.method === "PUT") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const body = await req.json();

      if (!body.region_id) {
        return new Response(
          JSON.stringify({ success: false, error: "region_id required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const allowedFields = [
        "name", "currency", "currency_symbol", "locale", "timezone",
        "default_commission_rate", "default_driver_payout_rate", "default_merchant_split_rate",
        "min_fare_cents", "base_fare_cents", "per_km_cents", "per_min_cents",
        "cancellation_fee_cents", "max_wait_seconds", "wait_fee_per_min_cents",
        "gridlock_surcharge_cents", "gridlock_delay_threshold_seconds",
        "gps_proximity_dropoff_meters", "gps_proximity_pickup_meters",
        "max_offered_radius_meters", "ride_offer_ttl_seconds",
        "lease_daily_rate_cents", "lease_mileage_rate_cents",
        "driver_online_debt_limit_cents", "ride_creation_debt_limit_cents",
        "min_wallet_topup_cents", "max_wallet_topup_cents",
        "compliance_config", "metadata", "is_active",
      ];

      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          updateData[field] = body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "No valid fields to update", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: region, error } = await admin
        .from("region_settings")
        .update(updateData)
        .eq("id", body.region_id)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, error: null, data: { region } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Validate a region configuration
    if (action === "validate" && req.method === "GET") {
      const { supabaseAdmin: admin } = await requireAdmin(req);

      const regionId = url.searchParams.get("region_id");

      if (!regionId) {
        return new Response(
          JSON.stringify({ success: false, error: "region_id required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: region } = await admin
        .from("region_settings")
        .select("*")
        .eq("id", regionId)
        .single();

      if (!region) {
        return new Response(
          JSON.stringify({ success: false, error: "Region not found", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const checks = [
        { field: "currency", passed: !!region.currency, message: "Currency set" },
        { field: "base_fare_cents", passed: region.base_fare_cents > 0, message: "Base fare configured" },
        { field: "per_km_cents", passed: region.per_km_cents > 0, message: "Per-km rate configured" },
        { field: "default_commission_rate", passed: region.default_commission_rate > 0, message: "Commission rate set" },
        { field: "default_driver_payout_rate", passed: region.default_driver_payout_rate > 0, message: "Driver payout rate set" },
        { field: "lease_daily_rate_cents", passed: region.lease_daily_rate_cents > 0, message: "Lease daily rate set" },
        { field: "is_active", passed: region.is_active, message: "Region is active" },
        { field: "locale", passed: !!region.locale, message: "Locale configured" },
        { field: "timezone", passed: !!region.timezone, message: "Timezone configured" },
      ];

      const failedChecks = checks.filter((c) => !c.passed);
      const isReady = failedChecks.length === 0;

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            region_id: regionId,
            is_ready: isReady,
            checks,
            failed_checks: failedChecks,
            summary: `${checks.length - failedChecks.length}/${checks.length} checks passed`,
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
            "GET ?action=resolve — Resolve current region config",
            "GET ?action=resolve_by_location&lat=X&lng=Y — Resolve by GPS coordinates",
            "GET ?action=list — List all active regions",
            "GET ?action=validate&region_id=X — Validate region completeness",
            "POST ?action=create — Create new region (expand to new country)",
            "POST ?action=create&template_region_code=TT — Clone from template",
            "PUT ?action=update — Update region settings",
          ],
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("region_settings error:", error);
    await captureException(error, { function: "region_settings" });
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
