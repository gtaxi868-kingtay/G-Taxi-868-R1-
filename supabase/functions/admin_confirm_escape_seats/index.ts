import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { supabaseAdmin } = await requireAdmin(req);

    const { package_id, action, departure_date, arrival_date, booking_reference } = await req.json();

    if (!package_id || !action) {
      return new Response(JSON.stringify({ error: "package_id and action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "confirm") {
      const { data: participants } = await supabaseAdmin
        .from("escape_group_participants")
        .select("id, rider_id, party_size, status, paid_cents")
        .eq("package_id", package_id)
        .in("status", ["confirmed", "payment_pending"]);

      if (!participants || participants.length === 0) {
        return new Response(JSON.stringify({ error: "No participants to confirm" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pkg, error: pkgErr } = await supabaseAdmin
        .from("escape_packages")
        .update({
          allocated_guests: participants.reduce((s, p) => s + p.party_size, 0),
        })
        .eq("id", package_id)
        .select("id, package_name, flight_block_id, lodging_node_id, price_per_person_cents")
        .single();

      if (pkgErr) throw pkgErr;

      for (const p of participants) {
        if (p.status === "payment_pending") {
          await supabaseAdmin
            .from("escape_group_participants")
            .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
            .eq("id", p.id);
        }

        await supabaseAdmin
          .from("passenger_details")
          .upsert({
            participant_id: p.id,
            rider_id: p.rider_id,
            full_name: "",
            date_of_birth: "2000-01-01",
            nationality: "TT",
          }, { onConflict: "participant_id", ignoreDuplicates: true });

        await supabaseAdmin
          .from("escape_group_participants")
          .update({ status: "passport_pending" })
          .eq("id", p.id);

        await supabaseAdmin.rpc("notify_user", {
          p_user_id: p.rider_id,
          p_type: "escape_confirmed",
          p_title: `Trip confirmed! ${pkg.package_name}`,
          p_body: "Your trip is booked. Please submit your passport details to complete check-in.",
          p_data: { package_id, participant_id: p.id },
        }).then((__r) => __r, () => {});
      }

      if (booking_reference) {
        const { data: itineraries } = await supabaseAdmin
          .from("master_escape_itineraries")
          .select("id")
          .eq("package_id", package_id)
          .limit(1);

        if (itineraries && itineraries.length > 0) {
          await supabaseAdmin
            .from("itinerary_legs")
            .insert(
              participants.map((p) => ({
                master_itinerary_id: itineraries[0].id,
                leg_sequence: 1,
                service_type: "flight",
                status: "confirmed",
                reference_code: booking_reference,
                scheduled_start: departure_date || null,
                scheduled_end: arrival_date || null,
              }))
            );
        }
      }

      await supabaseAdmin
        .from("group_booking_alerts")
        .insert({
          package_id,
          alert_type: "reschedule_accepted",
          message: `Admin confirmed ${participants.length} participants for ${pkg.package_name}. Ref: ${booking_reference || "N/A"}`,
        });

      return new Response(JSON.stringify({
        success: true,
        participants_confirmed: participants.length,
        package: pkg.package_name,
        booking_reference: booking_reference || null,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delay") {
      const { message } = await req.json();

      await supabaseAdmin
        .from("group_booking_alerts")
        .insert({
          package_id,
          alert_type: "delay",
          message: message || "Trip delayed by admin",
        });

      const { data: participants } = await supabaseAdmin
        .from("escape_group_participants")
        .select("rider_id")
        .eq("package_id", package_id)
        .in("status", ["confirmed", "passport_pending", "travel_ready"]);

      if (participants) {
        for (const p of participants) {
          await supabaseAdmin.rpc("notify_user", {
            p_user_id: p.rider_id,
            p_type: "escape_delay",
            p_title: "Trip update",
            p_body: message || "Your trip has been delayed. We'll notify you of the new schedule.",
            p_data: { package_id },
          }).then((__r) => __r, () => {});
        }
      }

      return new Response(JSON.stringify({ success: true, notified: participants?.length || 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "refund_all") {
      const { data: participants } = await supabaseAdmin
        .from("escape_group_participants")
        .select("id, rider_id, paid_cents")
        .eq("package_id", package_id)
        .in("status", ["confirmed", "passport_pending", "travel_ready"]);

      let refunded = 0;
      for (const p of participants || []) {
        if (p.paid_cents > 0) {
          const { error: refundErr } = await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: p.rider_id,
            p_amount_cents: p.paid_cents,
            p_type: "travel_package_refund",
            p_description: "Full refund — trip cancelled by admin",
            p_reference_id: p.id,
          });

          if (!refundErr) {
            await supabaseAdmin
              .from("escape_group_participants")
              .update({ status: "refunded" })
              .eq("id", p.id);
            refunded++;
          }
        } else {
          await supabaseAdmin
            .from("escape_group_participants")
            .update({ status: "cancelled" })
            .eq("id", p.id);
          refunded++;
        }
      }

      await supabaseAdmin
        .from("group_booking_alerts")
        .insert({
          package_id,
          alert_type: "refund_completed",
          message: `Admin refunded ${refunded} participants for cancelled trip`,
        });

      return new Response(JSON.stringify({ success: true, refunded }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}. Use confirm, delay, or refund_all.` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
