import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOOKING_API_KEY = Deno.env.get("BOOKING_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOCATIONS = [
  { city: "Tobago", country: "TT" },
  { city: "Port of Spain", country: "TT" },
  { city: "Bridgetown", country: "BB" },
  { city: "Georgetown", country: "GY" },
];

function getDateRanges(): { checkIn: string; checkOut: string }[] {
  const ranges: { checkIn: string; checkOut: string }[] = [];
  const today = new Date();
  for (let w = 0; w < 4; w++) {
    const ci = new Date(today);
    ci.setDate(ci.getDate() + w * 7);
    const co = new Date(ci);
    co.setDate(co.getDate() + 3);
    ranges.push({
      checkIn: ci.toISOString().split("T")[0],
      checkOut: co.toISOString().split("T")[0],
    });
  }
  return ranges;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Allow cron (no auth) or admin JWT
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!BOOKING_API_KEY) {
      return new Response(JSON.stringify({
        error: "Booking.com API key not configured",
        hint: "Set BOOKING_API_KEY in Edge Function secrets",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dateRanges = getDateRanges();
    let totalInserted = 0;

    for (const loc of LOCATIONS) {
      for (const range of dateRanges) {
        const url = new URL("https://distribution-xml.booking.com/2.0/json/hotels");
        url.searchParams.set("city", loc.city);
        url.searchParams.set("countrycode", loc.country);
        url.searchParams.set("checkin", range.checkIn);
        url.searchParams.set("checkout", range.checkOut);
        url.searchParams.set("rows", "20");
        url.searchParams.set("extras", "hotel_details,hotel_photos");

        const resp = await fetch(url.toString(), {
          headers: {
            Authorization: `Basic ${btoa(`${BOOKING_API_KEY}:`)}`,
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`Booking error ${loc.city} ${range.checkIn}: ${errText}`);
          continue;
        }

        const data = await resp.json();
        const hotels = data.result || [];

        for (const hotel of hotels) {
          const cheapest = hotel.min_price || 0;
          const row = {
            external_id: String(hotel.hotel_id),
            property_name: hotel.name || hotel.hotel_name || "Unknown",
            location: loc.city,
            check_in_date: range.checkIn,
            check_out_date: range.checkOut,
            room_type: "standard",
            available_rooms: hotel.room_left || hotel.available_rooms || 10,
            price_per_night_cents: Math.round(cheapest * 100),
            currency: hotel.currency || "TTD",
            total_price_cents: Math.round(cheapest * 3 * 100),
            image_url: hotel.main_photo?.url || hotel.photo_url || null,
            rating: hotel.review_score ? parseFloat(hotel.review_score.toFixed(1)) : null,
            raw_json: hotel,
          };

          const { error: upsertErr } = await supabaseAdmin
            .from("lodging_cache")
            .upsert(row, {
              onConflict: "external_id, check_in_date, check_out_date, room_type",
              ignoreDuplicates: false,
            });

          if (!upsertErr) totalInserted++;
        }

        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return new Response(JSON.stringify({
      success: true,
      locations_scanned: LOCATIONS.length,
      date_ranges: dateRanges.length,
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
