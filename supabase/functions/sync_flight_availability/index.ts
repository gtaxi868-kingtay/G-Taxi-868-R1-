import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const ROUTES = [
  { origin: "POS", dest: "TAB" },
  { origin: "TAB", dest: "POS" },
  { origin: "POS", dest: "BGI" },
  { origin: "POS", dest: "GEO" },
  { origin: "POS", dest: "MIA" },
  { origin: "POS", dest: "JFK" },
  { origin: "POS", dest: "YYZ" },
  { origin: "POS", dest: "LHR" },
];

function getDateRange(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Conditional auth: cron daemon sends no header → skip JWT check
    // Admin calls with JWT → validate admin role
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader) {
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: profile } = await supabaseClient.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
      return new Response(JSON.stringify({
        error: "Amadeus API keys not configured",
        hint: "Set AMADEUS_API_KEY and AMADEUS_API_SECRET in Edge Function secrets",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getAmadeusToken();
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const dates = getDateRange();
    let totalInserted = 0;

    for (const route of ROUTES) {
      for (const date of dates) {
        const url = new URL("https://api.amadeus.com/v2/shopping/flight-offers");
        url.searchParams.set("originLocationCode", route.origin);
        url.searchParams.set("destinationLocationCode", route.dest);
        url.searchParams.set("departureDate", date);
        url.searchParams.set("adults", "1");
        url.searchParams.set("max", "10");

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`Amadeus error ${route.origin}->${route.dest} ${date}: ${errText}`);
          continue;
        }

        const data = await resp.json();
        const offers = data.data || [];

        for (const offer of offers) {
          const firstSeg = offer.itineraries?.[0]?.segments?.[0];
          if (!firstSeg) continue;

          const row = {
            origin_code: firstSeg.departure?.iataCode || route.origin,
            destination_code: firstSeg.arrival?.iataCode || route.dest,
            departure_date: date,
            flight_number: `${firstSeg.carrierCode}${firstSeg.number}`,
            airline_code: firstSeg.carrierCode,
            departure_time: firstSeg.departure?.at?.split("T")[1]?.slice(0, 5) || "00:00",
            arrival_time: firstSeg.arrival?.at?.split("T")[1]?.slice(0, 5) || "00:00",
            available_seats: offer.numberOfBookableSeats ?? 0,
            fare_cents: Math.round(parseFloat(offer.price?.grandTotal || "0") * 100),
            fare_class: (offer.offerItems?.[0]?.price?.billingCurrency || "TTD") === "TTD" ? "economy" : "business",
            currency: offer.price?.currency || "TTD",
            raw_json: offer,
          };

          const { error: upsertErr } = await supabaseAdmin
            .from("flight_cache")
            .upsert(row, {
              onConflict: "origin_code, destination_code, departure_date, flight_number, fare_class",
              ignoreDuplicates: false,
            });

          if (!upsertErr) totalInserted++;
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return new Response(JSON.stringify({
      success: true,
      routes_scanned: ROUTES.length,
      dates_scanned: dates.length,
      records_upserted: totalInserted,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
