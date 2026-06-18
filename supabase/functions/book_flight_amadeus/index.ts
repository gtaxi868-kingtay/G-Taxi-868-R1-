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

function buildTraveler(pd: Record<string, any>): Record<string, any> {
  return {
    id: pd.id || "1",
    dateOfBirth: pd.date_of_birth || "2000-01-01",
    name: {
      firstName: (pd.full_name || "").split(" ")[0] || "UNKNOWN",
      lastName: (pd.full_name || "").split(" ").slice(1).join(" ") || "UNKNOWN",
    },
    gender: pd.gender || "MALE",
    contact: {
      emailAddress: pd.email || "traveler@g-taxi.com",
      phones: [
        {
          deviceType: "MOBILE",
          countryCallingCode: pd.phone_country_code || "1",
          number: pd.phone_number || "8680000000",
        },
      ],
    },
    documents: [
      {
        documentType: "PASSPORT",
        birthPlace: pd.birth_place || "Port of Spain",
        issuanceLocation: pd.passport_issuance_location || "Port of Spain",
        issuanceDate: pd.passport_issuance_date || "2020-01-01",
        number: pd.passport_number || "P0000000",
        expiryDate: pd.passport_expiry || "2030-01-01",
        issuanceCountry: pd.passport_issuance_country || pd.nationality || "TT",
        validityCountry: pd.nationality || "TT",
        nationality: pd.nationality || "TT",
        holder: true,
      },
    ],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { supabaseAdmin } = await requireAdmin(req);
    if (!supabaseAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
      return new Response(JSON.stringify({
        error: "Amadeus API keys not configured",
        hint: "Set AMADEUS_API_KEY and AMADEUS_API_SECRET in Edge Function secrets",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { package_id, flight_offer } = await req.json();

    if (!package_id || !flight_offer) {
      return new Response(JSON.stringify({ error: "package_id and flight_offer are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participants } = await supabaseAdmin
      .from("escape_group_participants")
      .select(`
        id, rider_id, party_size, status,
        passenger_details (
          full_name, date_of_birth, nationality, passport_number, passport_expiry,
          gender, phone_country_code, phone_number, email,
          passport_issuance_date, passport_issuance_location, passport_issuance_country, birth_place
        )
      `)
      .eq("package_id", package_id)
      .in("status", ["passport_pending", "travel_ready", "confirmed"]);

    if (!participants || participants.length === 0) {
      return new Response(JSON.stringify({ error: "No confirmed participants found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getAmadeusToken();

    // Step 2: Flight Offers Price — confirm price first
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
      return new Response(JSON.stringify({
        error: "Flight price confirmation failed",
        detail: priceData.errors?.[0]?.detail || priceResp.statusText,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confirmedOffers = priceData.data?.flightOffers || [];
    if (confirmedOffers.length === 0) {
      return new Response(JSON.stringify({ error: "No confirmed flight offers after pricing" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build travelers from passenger_details
    const travelers: Record<string, any>[] = [];
    for (const p of participants) {
      const pd = p.passenger_details;
      if (pd) {
        travelers.push(buildTraveler(pd));
      } else {
        // Create placeholder traveler for participants without passport details yet
        travelers.push({
          id: p.id,
          dateOfBirth: "2000-01-01",
          name: { firstName: "RIDER", lastName: p.rider_id.slice(0, 8).toUpperCase() },
          gender: "MALE",
          contact: { emailAddress: "rider@g-taxi.com", phones: [] },
          documents: [],
        });
      }
    }

    // Step 3: Flight Create Orders — book it
    const orderResp = await fetch("https://api.amadeus.com/v1/booking/flight-orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.amadeus+json",
      },
      body: JSON.stringify({
        data: {
          type: "flight-order",
          flightOffers: confirmedOffers,
          travelers,
        },
      }),
    });

    const orderData = await orderResp.json();

    if (!orderResp.ok) {
      console.error("Amadeus Flight Create Orders error:", JSON.stringify(orderData, null, 2));
      return new Response(JSON.stringify({
        error: "Flight booking failed",
        detail: orderData.errors?.[0]?.detail || orderResp.statusText,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract PNR and booking details
    const booking = orderData.data;
    const pnr = booking?.associatedRecords?.[0]?.reference || null;
    const creationDate = booking?.associatedRecords?.[0]?.creationDate || null;
    const totalPrice = parseFloat(booking?.flightOffers?.[0]?.price?.total || "0");

    // Store PNR on the escape package
    await supabaseAdmin
      .from("escape_packages")
      .update({
        amadeus_pnr: pnr,
        amadeus_booked_at: new Date().toISOString(),
        charter_reference: pnr,
      })
      .eq("id", package_id);

    // Update all participants to travel_ready
    await supabaseAdmin
      .from("escape_group_participants")
      .update({ status: "travel_ready" })
      .eq("package_id", package_id)
      .in("status", ["passport_pending", "confirmed"]);

    // Log alert
    await supabaseAdmin
      .from("group_booking_alerts")
      .insert({
        package_id,
        alert_type: "reschedule_accepted",
        message: `Flight booked via Amadeus. PNR: ${pnr || "N/A"}. ${participants.length} travelers. Total: ${totalPrice} ${booking?.flightOffers?.[0]?.price?.currency || "TTD"}`,
      });

    return new Response(JSON.stringify({
      success: true,
      pnr,
      creation_date: creationDate,
      total_price: totalPrice,
      currency: booking?.flightOffers?.[0]?.price?.currency || "TTD",
      travelers_count: travelers.length,
      amadeus_order_id: booking?.id || null,
      queues: booking?.queues || [],
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("book_flight_amadeus error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
