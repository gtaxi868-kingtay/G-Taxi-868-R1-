import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireAuth(req: Request) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        throw new Response(JSON.stringify({ error: "Missing authorization header" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error } = await supabaseClient.auth.getUser(
        authHeader.replace("Bearer ", "")
    );
    if (error || !user) {
        throw new Response(JSON.stringify({ error: "Invalid or expired token" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    return user;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { name, lat, lng, radius_meters, is_home, is_work, run_verification, document_id } = await req.json();

        if (!name || lat === undefined || lng === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: "name, lat, and lng are required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid coordinates" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check zone limit (max 10 per user)
        const { count: zoneCount } = await supabaseAdmin
            .from("safe_zones")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id);

        if (zoneCount && zoneCount >= 10) {
            return new Response(
                JSON.stringify({ success: false, error: "Maximum 10 safe zones allowed" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let geocodedAddress: string | null = null;
        let verifiedDocumentId: string | null = document_id || null;
        let verificationStatus = "unverified";
        let verificationMessage: string | null = null;
        let distanceMeters: number | null = null;

        if (run_verification) {
            // Step a: Call Mapbox Reverse Geocoding
            const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || Deno.env.get("MAPBOX_ACCESS_TOKEN");

            if (mapboxToken) {
                const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=address&limit=1&access_token=${mapboxToken}`;

                try {
                    const geoRes = await fetch(geoUrl);
                    if (geoRes.ok) {
                        const geoJson = await geoRes.json();
                        if (geoJson.features && geoJson.features[0]) {
                            geocodedAddress = geoJson.features[0].place_name;

                            // Step b+c: Compare with verified document if provided
                            if (document_id) {
                                const { data: doc } = await supabaseAdmin
                                    .from("user_documents")
                                    .select("verified_address, address_lat, address_lng, status")
                                    .eq("id", document_id)
                                    .eq("user_id", user.id)
                                    .single();

                                if (doc && doc.status === "verified" && doc.address_lat && doc.address_lng) {
                                    const R = 6371e3;
                                    const φ1 = (doc.address_lat * Math.PI) / 180;
                                    const φ2 = (lat * Math.PI) / 180;
                                    const Δφ = ((lat - doc.address_lat) * Math.PI) / 180;
                                    const Δλ = ((lng - doc.address_lng) * Math.PI) / 180;
                                    const a = Math.sin(Δφ / 2) ** 2 +
                                        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
                                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                                    distanceMeters = R * c;

                                    if (distanceMeters <= 100) {
                                        verificationStatus = "verified";
                                        verificationMessage = `Zone verified — ${Math.round(distanceMeters)}m from registered address`;
                                        verifiedDocumentId = document_id;
                                    } else {
                                        verificationStatus = "rejected";
                                        verificationMessage =
                                            `Zone is ${Math.round(distanceMeters)}m from verified address (max 100m). Adjust zone location or use a closer address document.`;
                                        return new Response(
                                            JSON.stringify({
                                                success: false,
                                                error: verificationMessage,
                                                data: {
                                                    distance_meters: Math.round(distanceMeters),
                                                    geocoded_address: geocodedAddress,
                                                    verified_address: doc.verified_address,
                                                },
                                            }),
                                            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                                        );
                                    }
                                } else if (doc && doc.status !== "verified") {
                                    verificationMessage = "Document not yet verified by admin. Zone created as unverified.";
                                } else {
                                    verificationMessage = "No verified document found. Zone created as unverified.";
                                }
                            } else {
                                verificationMessage = "No document provided for verification. Zone created as unverified.";
                            }
                        }
                    }
                } catch (geoErr) {
                    console.error("Mapbox reverse geocoding failed (non-fatal):", geoErr);
                    verificationMessage = "Geocoding unavailable. Zone created as unverified.";
                }
            } else {
                verificationMessage = "Mapbox token not configured. Zone created as unverified.";
            }
        }

        // Insert the safe zone
        const { data: zone, error: insertErr } = await supabaseAdmin
            .from("safe_zones")
            .insert({
                user_id: user.id,
                name,
                location: `SRID=4326;POINT(${lng} ${lat})`,
                radius_meters: radius_meters || 100,
                is_home: is_home || false,
                is_work: is_work || false,
                verification_status: verificationStatus,
                geocoded_address: geocodedAddress,
                verified_document_id: verifiedDocumentId,
            })
            .select("id, name, verification_status, geocoded_address, created_at")
            .single();

        if (insertErr) {
            if (insertErr.code === "23505") {
                return new Response(
                    JSON.stringify({ success: false, error: `You already have a safe zone named "${name}"` }),
                    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            console.error("Failed to insert safe zone:", insertErr);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to create safe zone" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    id: zone.id,
                    name: zone.name,
                    lat,
                    lng,
                    radius_meters: radius_meters || 100,
                    verification_status: zone.verification_status,
                    geocoded_address: zone.geocoded_address,
                    verification_message: verificationMessage,
                    is_home: is_home || false,
                    is_work: is_work || false,
                },
                message: verificationStatus === "verified"
                    ? "Safe zone verified! Your address has been confirmed against official documents."
                    : "Safe zone created. Verification pending.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("create_safe_zone error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
