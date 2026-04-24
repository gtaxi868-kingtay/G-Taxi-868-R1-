// Supabase Edge Function: admin_get_pending_drivers
// Returns drivers awaiting approval with their submitted documents

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify admin
    const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: "Forbidden: Admins only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get pending drivers (registered but not verified)
    // These are profiles with role='driver' but no matching drivers record, or drivers with is_verified=false
    const { data: pendingDrivers, error: driversError } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, phone, created_at, avatar_url")
      .eq("role", "driver")
      .order("created_at", { ascending: false });

    if (driversError) throw driversError;

    // Check which ones are not yet verified
    const driverIds = pendingDrivers?.map((d: any) => d.id) || [];
    
    const { data: verifiedDrivers, error: verifiedError } = await supabaseAdmin
      .from("drivers")
      .select("id, is_verified, status, vehicle_plate, vehicle_make, vehicle_model")
      .in("id", driverIds.length > 0 ? driverIds : ['00000000-0000-0000-0000-000000000000']);

    if (verifiedError) throw verifiedError;

    // Build lookup map
    const verifiedMap = new Map();
    verifiedDrivers?.forEach((d: any) => verifiedMap.set(d.id, d));

    // Get driver documents from storage metadata or separate table
    const { data: documents, error: docError } = await supabaseAdmin
      .from("driver_documents")
      .select("driver_id, document_type, storage_path, uploaded_at, status")
      .in("driver_id", driverIds.length > 0 ? driverIds : ['00000000-0000-0000-0000-000000000000'])
      .order("uploaded_at", { ascending: false });

    // Group documents by driver
    const docsByDriver: Record<string, any[]> = {};
    documents?.forEach((doc: any) => {
      if (!docsByDriver[doc.driver_id]) docsByDriver[doc.driver_id] = [];
      docsByDriver[doc.driver_id].push(doc);
    });

    // Mark pending drivers
    const pending = pendingDrivers?.filter((p: any) => {
      const driverRecord = verifiedMap.get(p.id);
      return !driverRecord || driverRecord.is_verified === false || driverRecord.status === 'pending';
    }).map((p: any) => ({
      ...p,
      driver_record: verifiedMap.get(p.id) || null,
      documents: docsByDriver[p.id] || [],
      has_license: docsByDriver[p.id]?.some((d: any) => d.document_type === 'license') || false,
      has_insurance: docsByDriver[p.id]?.some((d: any) => d.document_type === 'insurance') || false,
      has_vehicle_photo: docsByDriver[p.id]?.some((d: any) => d.document_type === 'vehicle_photo') || false,
    })) || [];

    return new Response(
      JSON.stringify({ 
        pending,
        count: pending.length,
        summary: {
          with_license: pending.filter((d: any) => d.has_license).length,
          with_insurance: pending.filter((d: any) => d.has_insurance).length,
          with_vehicle_photo: pending.filter((d: any) => d.has_vehicle_photo).length,
        }
      }), 
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("admin_get_pending_drivers error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
