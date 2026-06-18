import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AMADEUS_API_KEY = Deno.env.get("AMADEUS_API_KEY")!;
const AMADEUS_API_SECRET = Deno.env.get("AMADEUS_API_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getAmadeusToken(): Promise<string> {
  const resp = await fetch("https://api.amadeus.com/v1/security/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: AMADEUS_API_KEY,
      client_secret: AMADEUS_API_SECRET,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Amadeus auth failed: ${data.error_description || resp.status}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    await requireAdmin(req);
    if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
      return new Response(JSON.stringify({
        error: "Amadeus API keys not configured",
        hint: "Set AMADEUS_API_KEY and AMADEUS_API_SECRET in Edge Function secrets",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { flight_offer } = await req.json();
    if (!flight_offer) {
      return new Response(JSON.stringify({ error: "flight_offer is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getAmadeusToken();

    // Step 2: Flight Offers Price — confirm current price and availability
    const priceResp = await fetch("https://api.amadeus.com/v1/shopping/flight-offers/pricing", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.amadeus+json",
      },
      body: JSON.stringify({
        data: {
          type: "flight-offers-pricing",
          flightOffers: Array.isArray(flight_offer) ? flight_offer : [flight_offer],
        },
      }),
    });

    const priceData = await priceResp.json();

    if (!priceResp.ok) {
      console.error("Amadeus Flight Offers Price error:", priceData);
      return new Response(JSON.stringify({
        error: "Flight price confirmation failed",
        detail: priceData.errors?.[0]?.detail || priceResp.statusText,
        amadeus_response: priceData,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confirmedOffers = priceData.data?.flightOffers || [];

    if (confirmedOffers.length === 0) {
      return new Response(JSON.stringify({ error: "No flight offers returned after pricing" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confirmed = confirmedOffers[0];
    const totalPrice = parseFloat(confirmed.price?.grandTotal || "0");
    const currency = confirmed.price?.currency || "TTD";
    const totalCents = Math.round(totalPrice * 100);

    return new Response(JSON.stringify({
      success: true,
      confirmed_offer: confirmed,
      price_total: totalPrice,
      currency,
      price_cents: totalCents,
      available_seats: confirmed.numberOfBookableSeats ?? null,
      warnings: priceData.warnings || [],
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("confirm_flight_price error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
