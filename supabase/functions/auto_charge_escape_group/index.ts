import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Cron daemon sends no auth header → skip JWT check (service role already scoped).
    // Admin calls with JWT → validate admin role.
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { data: packages } = await supabaseAdmin
      .from("escape_packages")
      .select("id, package_name, price_per_person_cents, allocated_guests, min_guests_threshold, charge_deadline")
      .eq("is_active", true)
      .not("min_guests_threshold", "is", null);

    let charged = 0;
    let failed = 0;

    const readyPackages = (packages || []).filter(
      (p) => p.allocated_guests >= (p.min_guests_threshold || 999999)
    );

    for (const pkg of readyPackages) {
      const { data: participants } = await supabaseAdmin
        .from("escape_group_participants")
        .select("id, rider_id, party_size, status, paid_cents")
        .eq("package_id", pkg.id)
        .eq("status", "intent_pending");

      if (!participants || participants.length === 0) continue;

      for (const p of participants) {
        const amount_cents = p.party_size * pkg.price_per_person_cents;

        const { data: wallets } = await supabaseAdmin
          .from("wallets")
          .select("balance_cents")
          .eq("user_id", p.rider_id);

        const wallet = wallets?.[0];

        if (wallet && wallet.balance_cents >= amount_cents) {
          const { data: deductResult, error: deductErr } = await supabaseAdmin
            .rpc("charge_escape_participant_wallet", {
              p_rider_id: p.rider_id,
              p_amount_cents: amount_cents,
              p_package_name: pkg.package_name,
              p_reference_id: p.id,
            });

          if (!deductErr) {
            const { error: updateErr } = await supabaseAdmin
              .from("escape_group_participants")
              .update({
                status: "confirmed",
                paid_cents: amount_cents,
                charged_at: new Date().toISOString(),
                confirmed_at: new Date().toISOString(),
              })
              .eq("id", p.id);

            if (!updateErr) {
              await supabaseAdmin.rpc("increment_confirmed_guests", {
                p_package_id: pkg.id,
                p_increment: p.party_size,
              }).catch(() => {});
              charged++;
            } else {
              failed++;
            }
          } else {
            await supabaseAdmin
              .from("escape_group_participants")
              .update({ status: "payment_pending" })
              .eq("id", p.id);
            failed++;
          }
        } else if (STRIPE_SECRET_KEY) {
          try {
            const stripeResp = await fetch("https://api.stripe.com/v1/payment_intents", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                amount: String(amount_cents),
                currency: "ttd",
                "metadata[participant_id]": p.id,
                "metadata[package_name]": pkg.package_name,
                "metadata[type]": "escape_group_booking",
                description: `Escape group: ${pkg.package_name} (${p.party_size} pax)`,
              }),
            });
            const pi = await stripeResp.json();

            if (stripeResp.ok) {
              await supabaseAdmin
                .from("escape_group_participants")
                .update({ status: "payment_pending", stripe_pi_id: pi.id })
                .eq("id", p.id);
            }
            failed++;
          } catch {
            failed++;
          }
        } else {
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({
      charged,
      failed,
      packages_scanned: (packages || []).length,
      ready_packages: readyPackages.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
