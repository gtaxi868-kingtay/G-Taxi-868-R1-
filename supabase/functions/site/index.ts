// supabase/functions/site/index.ts
// Public touchpoint resolver for the launch site's NFC cold-start.
// (Supabase forces text/plain on function HTML, so the site itself is hosted
// on a static host; this endpoint just answers tap -> real pickup.)
//   .../functions/v1/site?resolve=1&node=<id>   -> {found, pickup:{name,address,lat,lng}}
//   .../functions/v1/site?resolve=1&tag=<uid>   -> same, by physical tag
// verify_jwt = false: the caller is a stranger with no session.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const tag = url.searchParams.get("tag") ?? "";
  const node = url.searchParams.get("node") ?? "";
  if (!tag && !node) return json({ found: false, reason: "no tag or node" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  let q = supabase.from("kiosk_nodes")
    .select("id, location_name, pickup_address, lat, lng, is_active, merchant_id").limit(1);
  q = node ? q.eq("id", node) : q.eq("tag_uid", tag);
  const { data } = await q.maybeSingle();
  if (!data || data.is_active === false) return json({ found: false, reason: "touchpoint not active yet" });

  try { await supabase.from("kiosk_nodes").update({ last_heartbeat: new Date().toISOString() }).eq("id", data.id); } catch (e) { console.error("[kiosk] heartbeat failed:", e); }
  return json({
    found: true,
    pickup: { name: data.location_name ?? "G-Taxi touchpoint", address: data.pickup_address ?? null, lat: data.lat ?? null, lng: data.lng ?? null },
    is_merchant: !!data.merchant_id,
  });
});
