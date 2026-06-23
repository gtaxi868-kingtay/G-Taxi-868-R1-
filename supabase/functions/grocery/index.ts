import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.6.0?target=deno";
import { requireAuth } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
const stripe = stripeKey ? Stripe(stripeKey, { apiVersion: "2025-02-24.acacia", httpClient: Stripe.createFetchHttpClient() }) : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let user;
  try { user = await requireAuth(req); } catch { return json({ error: "Unauthorized" }, 401); }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const { allowed, retryAfter } = await checkRateLimit(supabase, user.id, ip, "grocery_api");
  if (!allowed) return json({ error: `Rate limited. Try again in ${retryAfter}s.` }, 429);

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    switch (action) {

      case "get_nearby_stores": {
        const { lat, lng, radius_km = 10 } = body;
        if (lat == null || lng == null) return json({ error: "lat and lng required" }, 400);

        const radiusMeters = radius_km * 1000;
        const { data: stores, error } = await supabase.rpc("get_nearby_stores", {
          p_lat: lat, p_lng: lng, p_radius_meters: radiusMeters,
        });

        if (error) throw error;
        return json({ stores: stores ?? [] });
      }

      case "get_catalogue": {
        const { store_id } = body;
        if (!store_id) return json({ error: "store_id required" }, 400);

        const [categoriesRes, itemsRes] = await Promise.all([
          supabase.from("store_categories").select("id, name, sort_order").eq("store_id", store_id).order("sort_order"),
          supabase.from("store_items").select("*").eq("store_id", store_id).eq("is_available", true),
        ]);

        if (categoriesRes.error) throw categoriesRes.error;
        if (itemsRes.error) throw itemsRes.error;

        return json({ categories: categoriesRes.data ?? [], items: itemsRes.data ?? [] });
      }

      case "get_cart": {
        const { data: cart, error } = await supabase
          .from("carts")
          .select("*, cart_items(*, store_items(*))")
          .eq("user_id", user.id)
          .is("placed_at", null)
          .order("created_at", { foreignTable: "cart_items", ascending: true })
          .maybeSingle();

        if (error) throw error;
        return json({ cart: cart ?? { items: [], total_cents: 0 } });
      }

      case "manage_cart": {
        const { store_id, items: cartItems } = body;

        if (!store_id) return json({ error: "store_id required" }, 400);
        if (!Array.isArray(cartItems)) return json({ error: "items array required" }, 400);

        const { data: existing } = await supabase
          .from("carts")
          .select("id")
          .eq("user_id", user.id)
          .is("placed_at", null)
          .maybeSingle();

        let cartId: string;
        if (existing) {
          cartId = existing.id;
          await supabase.from("cart_items").delete().eq("cart_id", cartId);
        } else {
          const { data: newCart, error: cartError } = await supabase
            .from("carts")
            .insert({ user_id: user.id, store_id })
            .select("id")
            .single();
          if (cartError) throw cartError;
          cartId = newCart.id;
        }

        if (cartItems.length > 0) {
          const { error: itemsError } = await supabase.from("cart_items").insert(
            cartItems.map((i: any) => ({
              cart_id: cartId,
              item_id: i.item_id,
              quantity: i.quantity ?? 1,
              notes: i.notes ?? null,
            }))
          );
          if (itemsError) throw itemsError;
        }

        const { data: cart } = await supabase
          .from("carts")
          .select("*, cart_items(*, store_items(*))")
          .eq("id", cartId)
          .single();

        return json({ cart });
      }

      case "place_order": {
        const { store_id, delivery_address, payment_method = "card", notes } = body;

        if (!store_id || !delivery_address) {
          return json({ error: "store_id and delivery_address required" }, 400);
        }

        const { data: cart, error: cartError } = await supabase
          .from("carts")
          .select("*, cart_items(*, store_items(name, price_cents))")
          .eq("user_id", user.id)
          .eq("store_id", store_id)
          .is("placed_at", null)
          .maybeSingle();

        if (cartError) throw cartError;
        if (!cart || !cart.cart_items?.length) {
          return json({ error: "Cart is empty or not found" }, 400);
        }

        const subtotalCents = (cart.cart_items as any[]).reduce(
          (sum: number, item: any) => sum + (item.store_items?.price_cents ?? 0) * item.quantity,
          0
        );
        const deliveryCents = subtotalCents >= 50000 ? 0 : 1500;
        const totalCents = subtotalCents + deliveryCents;

        const { data: store } = await supabase
          .from("merchants")
          .select("name, created_by")
          .eq("id", store_id)
          .single();

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .insert({
            rider_id: user.id,
            merchant_id: store_id,
            store_name: (store as any)?.name ?? "Store",
            item_summary: (cart.cart_items as any[]).map((i: any) => `${i.quantity}x ${i.store_items?.name ?? "item"}`).join(", "),
            total_cents: totalCents,
            delivery_fee_cents: deliveryCents,
            delivery_address,
            payment_method,
            status: "pending",
            order_type: "grocery",
            notes: notes ?? null,
          })
          .select()
          .single();

        if (orderError) throw orderError;

        await supabase.from("carts").update({ placed_at: new Date().toISOString() }).eq("id", cart.id);

        if (payment_method === "card" && stripe) {
          const holdAmount = Math.round(totalCents * 1.15);
          const paymentIntent = await stripe.paymentIntents.create({
            amount: holdAmount,
            currency: "ttd",
            capture_method: "manual",
            metadata: { order_id: order.id, type: "grocery" },
          });

          return json({
            order,
            payment_intent_client_secret: paymentIntent.client_secret,
            hold_cents: holdAmount,
          });
        }

        return json({ order });
      }

      case "get_order_status": {
        const { order_id } = body;
        if (!order_id) return json({ error: "order_id required" }, 400);

        const { data: order, error } = await supabase
          .from("orders")
          .select("*, riders(name, phone), merchants(business_name, address, lat, lng)")
          .eq("id", order_id)
          .single();

        if (error || !order) return json({ error: "Order not found" }, 404);
        if (order.rider_id !== user.id) return json({ error: "Forbidden" }, 403);

        const { data: events } = await supabase
          .from("order_events")
          .select("*")
          .eq("order_id", order_id)
          .order("created_at", { ascending: true });

        return json({ order, events: events ?? [] });
      }

      case "create_payment_intent": {
        const { order_id } = body;
        if (!order_id) return json({ error: "order_id required" }, 400);

        const { data: order } = await supabase
          .from("orders")
          .select("id, rider_id, total_cents, status, payment_method")
          .eq("id", order_id)
          .single();

        if (!order) return json({ error: "Order not found" }, 404);
        if (order.rider_id !== user.id) return json({ error: "Forbidden" }, 403);
        if (order.status !== "pending") return json({ error: "Order is not pending" }, 400);
        if (!stripe) return json({ error: "Stripe not configured" }, 503);

        const holdAmount = Math.round(order.total_cents * 1.15);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: holdAmount,
          currency: "ttd",
          capture_method: "manual",
          metadata: { order_id: order.id, type: "grocery" },
        });

        return json({
          client_secret: paymentIntent.client_secret,
          hold_cents: holdAmount,
        });
      }

      case "confirm_authorization": {
        const { order_id, payment_intent_id } = body;
        if (!order_id || !payment_intent_id) {
          return json({ error: "order_id and payment_intent_id required" }, 400);
        }

        const { data: order } = await supabase
          .from("orders")
          .select("id, rider_id, total_cents, status")
          .eq("id", order_id)
          .single();

        if (!order) return json({ error: "Order not found" }, 404);
        if (order.rider_id !== user.id) return json({ error: "Forbidden" }, 403);

        let confirmed = false;
        if (stripe) {
          const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
          if (pi.status === "requires_capture") {
            await stripe.paymentIntents.capture(payment_intent_id);
            confirmed = true;
          } else if (pi.status === "succeeded") {
            confirmed = true;
          }
        }

        if (confirmed) {
          await supabase
            .from("orders")
            .update({ status: "confirmed", payment_status: "paid", updated_at: new Date().toISOString() })
            .eq("id", order_id);
        }

        const { data: updatedOrder } = await supabase
          .from("orders")
          .select("*")
          .eq("id", order_id)
          .single();

        return json({ success: confirmed, order: updatedOrder });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error(`grocery/${action} error:`, err);
    if (err instanceof Response) return err;
    return json({ success: false, error: err.message || "Internal server error" }, 500);
  }
});