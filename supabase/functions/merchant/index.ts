import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { sendPushNotification } from "../_shared/push.ts";
import { sendWhatsApp, getDeepLink } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing"],
  preparing: ["ready_for_pickup"],
  ready_for_pickup: ["handed_off", "delivered"],
};

const CATEGORIES = [
  "refund_request", "overcharge", "driver_behavior", "rider_behavior",
  "lost_item", "safety", "app_issue", "other",
];

const VEHICLE_MULTIPLIERS: Record<string, number> = {
  Standard: 1.0, XL: 1.5, Premium: 2.0,
};

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateFareCents(
  pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number,
  vehicleType: string,
  p?: { base: number; perKm: number; perMin: number; min: number }
): number {
  const distanceMeters = haversineMeters(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const durationMinutes = Math.max(8, (distanceMeters / 1000 / 28) * 60);
  const multiplier = VEHICLE_MULTIPLIERS[vehicleType] ?? 1.0;
  const b = p?.base ?? 1600, pk = p?.perKm ?? 175, pm = p?.perMin ?? 95, mn = p?.min ?? 2200;
  const fare = (b + (distanceMeters / 1000) * pk + durationMinutes * pm) * multiplier;
  return Math.max(mn, Math.round(fare));
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("Authorization");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace("Bearer ", "") ?? ""
  );
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    switch (action) {

      // ── update_order_status ─────────────────────────────────────────────
      case "update_order_status": {
        const { order_id, new_status } = body;
        if (!order_id || !new_status) return json({ success: false, error: "order_id and new_status required" }, 400);

        const { data: merchant, error: merchantError } = await supabase
          .from("merchants")
          .select("id")
          .eq("created_by", user.id)
          .maybeSingle();

        if (merchantError || !merchant) return json({ success: false, error: "Not a registered merchant" }, 403);

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .select("id, status, merchant_id")
          .eq("id", order_id)
          .single();

        if (orderError || !order) return json({ success: false, error: "Order not found" }, 404);
        if (order.merchant_id !== merchant.id) return json({ success: false, error: "This order does not belong to your merchant" }, 403);

        const allowed = ALLOWED_TRANSITIONS[order.status];
        if (!allowed || !allowed.includes(new_status)) {
          return json({
            success: false,
            error: `Cannot transition from '${order.status}' to '${new_status}'. Allowed: ${(allowed || []).join(", ") || "none"}`,
          }, 400);
        }

        const { data: updated, error: updateError } = await supabase
          .from("orders")
          .update({ status: new_status, updated_at: new Date().toISOString() })
          .eq("id", order_id)
          .select()
          .single();

        if (updateError) return json({ success: false, error: updateError.message }, 500);
        return json({ success: true, order: updated });
      }

      // ── match_delivery ──────────────────────────────────────────────────
      case "match_delivery": {
        const { order_id } = body;
        if (!order_id) return json({ error: "order_id required" }, 400);

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .select("id, rider_id, merchant_id, total_cents, delivery_fee_cents, status, merchants(business_name, address)")
          .eq("id", order_id)
          .single();

        if (orderError || !order) return json({ error: "Order not found" }, 404);

        const OFFER_TIMEOUT_SECONDS = 20;
        const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();

        let selectedDriver: { id: string; push_token: string | null } | null = null;
        let matchType = "broadcast";

        const { data: preferred } = await supabase
          .from("user_preferred_drivers")
          .select("driver_id, drivers!inner(id, push_token, is_online)")
          .eq("user_id", order.rider_id)
          .order("rank", { ascending: true });

        if (preferred?.length) {
          for (const p of preferred) {
            const d = p.drivers as any;
            if (d?.is_online) {
              selectedDriver = { id: p.driver_id, push_token: d.push_token };
              matchType = "preferred";
              break;
            }
          }
        }

        if (!selectedDriver) {
          const { data: nearest } = await supabase
            .from("drivers")
            .select("id, push_token")
            .eq("is_online", true)
            .limit(1)
            .maybeSingle();
          if (nearest) {
            selectedDriver = nearest;
            matchType = "nearest";
          }
        }

        if (!selectedDriver) {
          await supabase.from("dispatch_queue")
            .upsert({ order_id, delivery_method: "driver", status: "pending" }, { onConflict: "order_id" });
          return json({ success: true, match_type: "queued", driver_id: null });
        }

        const { data: offer, error: offerErr } = await supabase
          .from("delivery_offers")
          .insert({ order_id, driver_id: selectedDriver.id, status: "pending", expires_at: expiresAt })
          .select()
          .single();

        if (offerErr) return json({ error: `delivery_offer insert failed: ${offerErr.message}` }, 500);

        const merchantName = (order.merchants as any)?.business_name ?? "Merchant";
        const deliveryFeeTTD = ((order.delivery_fee_cents ?? 0) / 100).toFixed(2);

        if (selectedDriver.push_token) {
          await sendPushNotification(
            selectedDriver.push_token,
            "Delivery Order",
            `${merchantName} — TTD $${deliveryFeeTTD} delivery fee`,
            { type: "delivery_offer", offer_id: offer.id, order_id, merchant_name: merchantName, delivery_fee_cents: order.delivery_fee_cents, total_cents: order.total_cents },
          );
        }

        await supabase.from("dispatch_queue")
          .upsert({ order_id, delivery_method: "driver", status: "dispatched", ride_id: null }, { onConflict: "order_id" });

        return json({ success: true, match_type: matchType, driver_id: selectedDriver.id, offer_id: offer.id });
      }

      // ── create_appointment ──────────────────────────────────────────────
      case "create_appointment": {
        const {
          merchant_id, service_id, scheduled_at,
          pickup_address, pickup_lat, pickup_lng,
          ride_requested = true,
        } = body;

        if (!merchant_id || !service_id || !scheduled_at) {
          return json({ success: false, error: "Missing required fields: merchant_id, service_id, scheduled_at" }, 400);
        }

        const { data: service } = await supabase
          .from("merchant_services")
          .select("name, duration_minutes")
          .eq("id", service_id)
          .single();

        if (!service) return json({ success: false, error: "Service not found" }, 404);

        const { data: appointment, error: insertError } = await supabase
          .from("merchant_appointments")
          .insert({
            rider_id: user.id, merchant_id, service_id, scheduled_at,
            ride_requested, pickup_address: pickup_address || null,
            pickup_lat: pickup_lat || null, pickup_lng: pickup_lng || null,
            merchant_consent_status: "pending", status: "pending",
          })
          .select()
          .single();

        if (insertError) return json({ success: false, error: "Failed to create appointment" }, 500);

        const { data: merchant } = await supabase
          .from("merchants")
          .select("name, created_by")
          .eq("id", merchant_id)
          .single();

        if (merchant?.created_by) {
          const { data: merchantProfile } = await supabase
            .from("profiles")
            .select("push_token, full_name")
            .eq("id", merchant.created_by)
            .single();

          if (merchantProfile?.push_token) {
            const { data: riderProfile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", user.id)
              .single();

            const timeStr = new Date(scheduled_at).toLocaleTimeString("en-TT", {
              hour: "2-digit", minute: "2-digit",
            });

            sendPushNotification(
              merchantProfile.push_token,
              `New Booking: ${riderProfile?.full_name || "A rider"}`,
              `${service.name} at ${timeStr} — ${merchant?.name || "your shop"}`,
              { type: "APPOINTMENT_CREATED", appointment_id: appointment.id, merchant_id },
            ).catch(() => {});
          }
        }

        return json({ success: true, error: null, data: { appointment_id: appointment.id } });
      }

      // ── submit_dispute ──────────────────────────────────────────────────
      case "submit_dispute": {
        const { ride_id, category, description } = body;

        if (!CATEGORIES.includes(category)) return json({ error: "Invalid category" }, 400);
        const text = String(description ?? "").trim();
        if (text.length < 5 || text.length > 2000) return json({ error: "Description must be 5-2000 characters" }, 400);

        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", dayAgo);

        if ((count ?? 0) >= 5) {
          return json({ error: "Too many reports today. Please email support@gtaxi.tt." }, 429);
        }

        if (ride_id) {
          const { data: ride } = await supabase
            .from("rides")
            .select("rider_id, driver_id")
            .eq("id", ride_id)
            .single();
          if (!ride || (ride.rider_id !== user.id && ride.driver_id !== user.id)) {
            return json({ error: "Ride not found" }, 404);
          }
        }

        const { data: ticket, error } = await supabase
          .from("support_tickets")
          .insert({ user_id: user.id, ride_id: ride_id ?? null, category, description: text })
          .select("id, status, created_at")
          .single();

        if (error) throw error;
        return json({ success: true, ticket });
      }

      // ── dispatch_client ─────────────────────────────────────────────────
      case "dispatch_client": {
        const { client_phone, note, vehicle_type = "standard" } = body;
        if (!client_phone) return json({ success: false, error: "client_phone is required" }, 400);

        const { data: merchant, error: merchantErr } = await supabase
          .from("merchants")
          .select("id, name, address, lat, lng, created_by, is_active, activation_status")
          .eq("created_by", user.id)
          .eq("is_active", true)
          .maybeSingle();

        if (merchantErr) throw merchantErr;
        if (!merchant) return json({ success: false, error: "No active merchant found for this account" }, 403);
        if (!merchant.lat || !merchant.lng) {
          return json({ success: false, error: "Merchant location not set. Update your merchant profile first." }, 422);
        }

        const normalizedPhone = client_phone.trim().replace(/\s+/g, "");
        const { data: clientProfile } = await supabase
          .from("profiles")
          .select("id, name, phone")
          .eq("phone", normalizedPhone)
          .maybeSingle();

        const clientName = clientProfile?.name || "Client";
        const riderId = clientProfile?.id ?? user.id;
        const pin = generatePin();

        const placeholderDropoffLat = merchant.lat + 0.001;
        const placeholderDropoffLng = merchant.lng + 0.001;

        const { data: ride, error: rideErr } = await supabase
          .from("rides")
          .insert({
            rider_id: riderId,
            billed_to_merchant_id: merchant.id,
            pickup_lat: merchant.lat,
            pickup_lng: merchant.lng,
            pickup_address: `${merchant.name} — ${merchant.address}`,
            dropoff_lat: placeholderDropoffLat,
            dropoff_lng: placeholderDropoffLng,
            dropoff_address: "Destination pending — driver will confirm with client",
            status: "searching",
            payment_method: "corporate_billing",
            vehicle_type: vehicle_type,
            ride_pin: pin,
            total_fare_cents: 0,
            metadata: {
              is_merchant_dispatch: true, is_merchant_ride: true,
              merchant_name: merchant.name, client_phone: normalizedPhone,
              client_name: clientName, note: note || null, dispatched_by: user.id,
            },
          })
          .select("id, ride_pin")
          .single();

        if (rideErr) throw rideErr;

        if (clientProfile?.id) {
          await supabase.functions.invoke("send_push_notification", {
            body: {
              user_id: clientProfile.id,
              title: `${merchant.name} sent you a ride!`,
              body: `Your car is being arranged. PIN: ${pin}. Driver will confirm destination.`,
              payload: { route: "SearchingDriver", rideId: ride.id },
            },
          }).catch(() => {});
        }

        return json({
          success: true, ride_id: ride.id, ride_pin: ride.ride_pin,
          client_name: clientName,
          pickup_address: `${merchant.name} — ${merchant.address}`,
          message: clientProfile
            ? `Car dispatched. ${clientName} will be notified.`
            : `Car dispatched. Ask client to open the G-Taxi app with PIN ${pin}.`,
        });
      }

      // ── concierge_dispatch ──────────────────────────────────────────────
      case "concierge_dispatch": {
        const { data: pricingRows } = await supabase
          .from("pricing_config")
          .select("key, value_cents")
          .catch(() => ({ data: null }));
        const pcfg: Record<string, number> = {};
        if (pricingRows) for (const r of pricingRows) pcfg[r.key] = r.value_cents;
        const pricing = {
          base: pcfg["BASE_FARE_CENTS"] ?? 1600,
          perKm: pcfg["PER_KM_CENTS"] ?? 175,
          perMin: pcfg["PER_MIN_CENTS"] ?? 95,
          min: pcfg["MIN_FARE_CENTS"] ?? 2200,
        };

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("merchant_id")
          .eq("id", user.id)
          .single();

        if (profileError || !profile?.merchant_id) return json({ success: false, error: "Caller is not linked to a merchant" }, 403);

        const { data: merchant, error: merchantError } = await supabase
          .from("merchants")
          .select("*")
          .eq("id", profile.merchant_id)
          .eq("is_active", true)
          .single();

        if (merchantError || !merchant) return json({ success: false, error: "Caller is not a registered merchant" }, 403);

        const {
          guest_name, guest_phone, destination_lat, destination_lng,
          destination_address, vehicle_type = "Standard",
          payment_method = merchant.billing_type === "net-30" ? "corporate_billing" : "cash",
        } = body;

        if (!guest_name || !guest_phone || destination_lat == null || destination_lng == null) {
          return json({ success: false, error: "Missing required guest or destination information" }, 400);
        }
        if (merchant.lat == null || merchant.lng == null) {
          return json({ success: false, error: "Merchant pickup coordinates are not configured" }, 422);
        }

        if (payment_method === "corporate_billing") {
          if (merchant.current_debt_cents >= merchant.credit_limit_cents) {
            return json({ success: false, error: "Corporate credit limit reached. Please settle balance or use cash." }, 402);
          }
        }

        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();
        const fareCents = estimateFareCents(merchant.lat, merchant.lng, destination_lat, destination_lng, vehicle_type, pricing);

        const { data: newRide, error: insertError } = await supabase
          .from("rides")
          .insert({
            rider_id: user.id,
            pickup_lat: merchant.lat, pickup_lng: merchant.lng,
            pickup_address: `${merchant.name} (${merchant.address})`,
            dropoff_lat: destination_lat, dropoff_lng: destination_lng,
            dropoff_address,
            status: "searching", total_fare_cents: fareCents,
            vehicle_type, payment_method,
            billed_to_merchant_id: payment_method === "corporate_billing" ? merchant.id : null,
            ride_pin: ridePin,
            metadata: { is_concierge: true, merchant_name: merchant.name, guest_name, guest_phone },
          })
          .select()
          .single();

        if (insertError) throw insertError;

        const smsMessage = `G-TAXI: ${merchant.name} has summoned a ride for you to ${destination_address}. Your driver will arrive soon. Your ride PIN is ${ridePin}. Track your ride: https://gtaxi.app/track/${newRide.id}`;
        const waResult = await sendWhatsApp(guest_phone, smsMessage, { previewUrl: true }).catch(() => ({ success: false }));
        if (!waResult.success) {
          const deepLink = getDeepLink(guest_phone, smsMessage);
          console.log(`[Merchant] WhatsApp API unavailable — deep link: ${deepLink}`);
        }

        await supabase.from("user_events").insert({
          user_id: user.id,
          event_type: "concierge_dispatch",
          payload: { ride_id: newRide.id, guest_name },
        }).catch(() => {});

        return json({
          success: true, ride_id: newRide.id,
          message: `Ride summoned for ${guest_name}. Share details with guest.`,
          sms_message: smsMessage,
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error(`merchant/${action} error:`, err);
    if (err instanceof Response) return err;
    return json({ success: false, error: err.message || "Internal server error" }, 500);
  }
});
