// Supabase Edge Function: dealer_brokerage
// ============================================================
// DEALERSHIP BROKERAGE ENGINE
//   - Capture vehicle sales leads from drivers
//   - Track lead status through financing pipeline
//   - Auto-generate brokerage commission invoices on approval
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

interface DealerPartnerInput {
  business_name: string;
  registration_number?: string;
  tax_id?: string;
  address?: string;
  phone: string;
  email?: string;
  contact_name?: string;
  commission_type: "percentage" | "fixed";
  commission_value: number;
  payment_terms_days?: number;
  bank_details?: Record<string, unknown>;
  region_id?: string;
}

interface VehicleInput {
  dealer_id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  color?: string;
  license_plate?: string;
  vehicle_type: "standard" | "xl" | "premium" | "eco";
  price_cents: number;
  image_url?: string;
  specifications?: Record<string, unknown>;
}

interface LeadInput {
  vehicle_id: string;
  driver_id?: string;
  referred_by?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "default";

    // PUBLIC: Drivers can browse available inventory
    if (action === "list_vehicles" && req.method === "GET") {
      const user = await requireAuth(req);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const dealerId = url.searchParams.get("dealer_id");
      const vehicleType = url.searchParams.get("vehicle_type");
      const minPrice = url.searchParams.get("min_price");
      const maxPrice = url.searchParams.get("max_price");

      let query = supabaseAdmin
        .from("vehicle_inventory")
        .select("*, dealer:dealer_partners!inner(business_name, phone, email, address)")
        .eq("status", "available");

      if (dealerId) query = query.eq("dealer_id", dealerId);
      if (vehicleType) query = query.eq("vehicle_type", vehicleType);
      if (minPrice) query = query.gte("price_cents", parseInt(minPrice));
      if (maxPrice) query = query.lte("price_cents", parseInt(maxPrice));

      query = query.order("created_at", { ascending: false });

      const { data: vehicles, error } = await query;

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, error: null, data: { vehicles } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUBLIC: List active dealer partners
    if (action === "list_dealers" && req.method === "GET") {
      await requireAuth(req);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const regionCode = url.searchParams.get("region_code");

      let query = supabaseAdmin
        .from("dealer_partners")
        .select("id, business_name, address, phone, email, contact_name")
        .eq("is_active", true);

      if (regionCode) {
        query = query.eq("region_settings.code", regionCode);
      }

      const { data: dealers, error } = await query;

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, error: null, data: { dealers } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PROTECTED: Create a vehicle sales lead
    if (action === "create_lead" && req.method === "POST") {
      const user = await requireAuth(req);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const body: LeadInput & { driver_id?: string } = await req.json();

      if (!body.vehicle_id) {
        return new Response(
          JSON.stringify({ success: false, error: "vehicle_id required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the vehicle exists and is available
      const { data: vehicle } = await supabaseAdmin
        .from("vehicle_inventory")
        .select("*, dealer:dealer_partners!inner(id, is_active)")
        .eq("id", body.vehicle_id)
        .single();

      if (!vehicle || !vehicle.dealer?.is_active) {
        return new Response(
          JSON.stringify({ success: false, error: "Vehicle not found or dealer inactive", data: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If driver_id specified, verify caller can create lead for that driver
      // Driver leads themselves, or admin creates for a driver
      let driverId = body.driver_id;
      if (!driverId) {
        // The authenticated user is the driver — get their driver record
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
        driverId = driver.id;
      } else {
        // Verify admin role if creating lead for another driver
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profile?.role !== "admin" && driverId !== undefined) {
          return new Response(
            JSON.stringify({ success: false, error: "Only admins can create leads for other drivers", data: null }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { data: sale, error } = await supabaseAdmin
        .from("vehicle_sales")
        .insert({
          vehicle_id: body.vehicle_id,
          dealer_id: vehicle.dealer_id,
          driver_id: driverId,
          referred_by: body.referred_by || null,
          notes: body.notes || null,
          metadata: body.metadata || {},
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
          data: { sale, message: "Lead captured successfully" },
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Update lead status (financing pipeline)
    if (action === "update_lead_status" && req.method === "POST") {
      const { supabaseAdmin } = await requireAdmin(req);

      const { sale_id, status, sale_price_cents, financing_partner } = await req.json();

      if (!sale_id || !status) {
        return new Response(
          JSON.stringify({ success: false, error: "sale_id and status required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validStatuses = [
        "lead", "test_drive_scheduled", "financing_pending",
        "financing_approved", "sale_completed", "cancelled",
      ];

      if (!validStatuses.includes(status)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`, data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateData: Record<string, unknown> = { status };

      if (status === "financing_approved") {
        if (!sale_price_cents) {
          return new Response(
            JSON.stringify({ success: false, error: "sale_price_cents required for financing_approved", data: null }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updateData.sale_price_cents = sale_price_cents;
        updateData.financing_partner = financing_partner || null;
        updateData.financing_approved_at = new Date().toISOString();

        // Auto-generate brokerage commission invoice
        const { data: commissionResult } = await supabaseAdmin
          .rpc("handle_brokerage_commission", { p_sale_id: sale_id });

        if (commissionResult?.brokerage_fee_cents > 0) {
          updateData.brokerage_fee_cents = commissionResult.brokerage_fee_cents;
          updateData.brokerage_invoice_id = commissionResult.invoice_id;
        }
      }

      if (status === "sale_completed") {
        updateData.sale_completed_at = new Date().toISOString();

        // Mark vehicle as sold
        const { data: sale } = await supabaseAdmin
          .from("vehicle_sales")
          .select("vehicle_id")
          .eq("id", sale_id)
          .single();

        if (sale?.vehicle_id) {
          await supabaseAdmin
            .from("vehicle_inventory")
            .update({ status: "sold" })
            .eq("id", sale.vehicle_id);
        }
      }

      const { data: updated, error } = await supabaseAdmin
        .from("vehicle_sales")
        .update(updateData)
        .eq("id", sale_id)
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
          data: { sale: updated, message: "Lead status updated" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Manage dealer partners (CRUD)
    if (action === "dealer" && req.method === "POST") {
      const { supabaseAdmin } = await requireAdmin(req);

      const body: DealerPartnerInput = await req.json();

      if (!body.business_name || !body.phone) {
        return new Response(
          JSON.stringify({ success: false, error: "business_name and phone required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: dealer, error } = await supabaseAdmin
        .from("dealer_partners")
        .insert({
          business_name: body.business_name,
          registration_number: body.registration_number || null,
          tax_id: body.tax_id || null,
          address: body.address || null,
          phone: body.phone,
          email: body.email || null,
          contact_name: body.contact_name || null,
          commission_type: body.commission_type,
          commission_value: body.commission_value,
          payment_terms_days: body.payment_terms_days || 30,
          bank_details: body.bank_details || {},
          region_id: body.region_id || null,
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
        JSON.stringify({ success: true, error: null, data: { dealer } }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Add vehicle to inventory
    if (action === "vehicle" && req.method === "POST") {
      const { supabaseAdmin } = await requireAdmin(req);

      const body: VehicleInput = await req.json();

      if (!body.dealer_id || !body.make || !body.model || !body.year || !body.price_cents) {
        return new Response(
          JSON.stringify({ success: false, error: "dealer_id, make, model, year, price_cents required", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: vehicle, error } = await supabaseAdmin
        .from("vehicle_inventory")
        .insert({
          dealer_id: body.dealer_id,
          make: body.make,
          model: body.model,
          year: body.year,
          vin: body.vin || null,
          color: body.color || null,
          license_plate: body.license_plate || null,
          vehicle_type: body.vehicle_type || "standard",
          price_cents: body.price_cents,
          image_url: body.image_url || null,
          specifications: body.specifications || {},
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
        JSON.stringify({ success: true, error: null, data: { vehicle } }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADMIN: Get sales reports (brokerage revenue)
    if (action === "report" && req.method === "GET") {
      const { supabaseAdmin } = await requireAdmin(req);

      const startDate = url.searchParams.get("start_date") || "1970-01-01";
      const endDate = url.searchParams.get("end_date") || "2099-12-31";

      const { data: sales, error } = await supabaseAdmin
        .from("vehicle_sales")
        .select(`
          *,
          vehicle:vehicle_inventory(make, model, year),
          dealer:dealer_partners(business_name, commission_type, commission_value),
          driver:drivers(name, phone_number)
        `)
        .gte("created_at", startDate)
        .lte("created_at", endDate + "T23:59:59Z")
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message, data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalBrokerageFeesCents = sales
        ?.filter((s: any) => s.brokerage_fee_cents != null)
        .reduce((sum: number, s: any) => sum + s.brokerage_fee_cents, 0) || 0;

      const completedSales = sales?.filter((s: any) => s.status === "sale_completed").length || 0;
      const pendingFinancing = sales?.filter((s: any) => s.status === "financing_pending").length || 0;

      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          data: {
            sales,
            summary: {
              total_sales: sales?.length || 0,
              completed_sales: completedSales,
              pending_financing: pendingFinancing,
              total_brokerage_fees_cents: totalBrokerageFeesCents,
              total_brokerage_fees_dollars: (totalBrokerageFeesCents / 100).toFixed(2),
              currency: "TTD",
            },
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback: return available actions
    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: {
          available_actions: [
            "GET ?action=list_vehicles — Browse available vehicles",
            "GET ?action=list_dealers — List active dealer partners",
            "GET ?action=list_dealers&region_code=BB — Filter dealers by region",
            "POST ?action=create_lead — Driver creates a vehicle sales lead",
            "POST ?action=update_lead_status — Admin updates lead through pipeline",
            "POST ?action=dealer — Admin creates a dealer partner",
            "POST ?action=vehicle — Admin adds vehicle inventory",
            "GET ?action=report — Admin brokerage revenue report",
          ],
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("dealer_brokerage error:", error);
    await captureException(error, { function: "dealer_brokerage" });
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
