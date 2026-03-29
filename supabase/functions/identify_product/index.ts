// Supabase Edge Function: identify_product
// Recognizes products from images and returns detail + localized store promos

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { image, merchant_id } = await req.json();
    if (!image) throw new Error("Image data required");

    // --- MOCK PRODUCT RECOGNITION LOGIC ---
    // In production, this would call an LLM (e.g. Gemini-Flash) to identify the product
    // For now, we return a high-fidelity "match" from the DB for demonstration.

    const { data: products, error: prodError } = await supabaseAdmin
      .from("products")
      .select("*, merchant_id(name, city)")
      .limit(1); // Just pick a demo product

    if (prodError || !products || products.length === 0) {
      // Fallback Demo Product if DB is empty
      return new Response(
        JSON.stringify({
          success: true,
          product: {
            name: "Premium Roast Coffee",
            price_cents: 2500,
            category: "Beverage",
            description: "Locally sourced premium roast beans.",
            promo_msg: "Scan in-store for 10% off your next ride!",
            discount_ride_percent: 10
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const product = products[0];

    return new Response(
      JSON.stringify({
        success: true,
        product: {
          ...product,
          promo_msg: "Exclusive G-TAXI Discount Active!",
          discount_ride_percent: 15
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
