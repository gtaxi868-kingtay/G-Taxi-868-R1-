// Supabase Edge Function: submit_compliance_document
// Driver uploads insurance certificate, license, PSV badge, etc.
// Image drops into compliance_queue for admin review.
// If insurance, driver's go_online is blocked until approved.
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: driver } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!driver) {
      return new Response(JSON.stringify({ error: "Driver not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { document_type, document_url, expiry_date } = await req.json();

    if (!document_type || !document_url) {
      return new Response(JSON.stringify({ error: "document_type and document_url are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validTypes = ["insurance", "license", "vehicle_registration", "psv_badge", "other"];
    if (!validTypes.includes(document_type)) {
      return new Response(JSON.stringify({ error: "Invalid document_type. Must be: " + validTypes.join(", ") }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: result, error: rpcError } = await supabase
      .rpc("submit_driver_compliance_document", {
        p_driver_id: driver.id,
        p_document_type: document_type,
        p_document_url: document_url,
        p_expiry_date: expiry_date || null,
      });

    if (rpcError) {
      return new Response(JSON.stringify({ error: "Failed to submit: " + rpcError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = typeof result === "string" ? JSON.parse(result) : result;

    // Notify admins
    const { data: admins } = await supabase
      .from("profiles")
      .select("push_token")
      .eq("role", "admin")
      .not("push_token", "is", null);

    for (const admin of admins ?? []) {
      try {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: admin.push_token,
            title: "Compliance document submitted",
            body: `A ${document_type.replace(/_/g, " ")} document requires review. Check Admin > Compliance.`,
            data: { type: "compliance_submission", document_type, queue_id: parsed.queue_id },
          }),
        });
      } catch { }
    }

    return new Response(
      JSON.stringify({ success: true, data: parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("submit_compliance_document error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
