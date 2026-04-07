import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-merchant-key",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    // 1. Verify Merchant API Key
    const merchantKey = req.headers.get("x-merchant-key")
    if (!merchantKey) {
      throw new Error("Missing X-Merchant-Key")
    }

    const { data: merchant, error: mError } = await supabase
      .from("merchants")
      .select("id, name, owner_id")
      .eq("api_key", merchantKey)
      .single()

    if (mError || !merchant) {
      throw new Error("Invalid Merchant API Key")
    }

    // 2. Parse Dispatch Payload
    const { pickup_address, dropoff_address, customer_name, customer_phone, service_type } = await req.json()

    // 3. Create Dispatch Request
    // This creates a 'merchant' type ride that is prioritized in the matching engine
    const { data: ride, error: rError } = await supabase
      .from("rides")
      .insert({
        rider_id: merchant.owner_id, // Default to owner, or a guest-rider record
        pickup_address,
        dropoff_address,
        service_type: service_type || "standard",
        status: "searching",
        is_merchant_ride: true,
        merchant_id: merchant.id,
        metadata: {
          guest_name: customer_name,
          guest_phone: customer_phone,
          source: "enterprise_api"
        }
      })
      .select()
      .single()

    if (rError) throw rError

    return new Response(
      JSON.stringify({
        success: true,
        message: "Dispatch request received. Matching driver...",
        ride_id: ride.id,
        status: ride.status
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
