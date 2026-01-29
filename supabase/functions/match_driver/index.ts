// Supabase Edge Function: match_driver
// Path: supabase/functions/match_driver/index.ts
//
// Uses PostGIS RPC 'get_nearby_drivers' for efficient geospatial matching.
// Includes a "System Test Driver" fallback for reliable App Store testing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    ride_id: string;
}

serve(async (req: Request) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body: RequestBody = await req.json();
        const { ride_id } = body;

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing ride_id", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Set Status -> Searching
        const { error: searchingError } = await supabase
            .from("rides")
            .update({ status: "searching" })
            .eq("id", ride_id)
            .eq("status", "requested");

        if (searchingError) {
            console.error("Error updating to searching:", searchingError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to start search", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Simulate network/search delay
        const delay = 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

        // 2. Get Ride Coordinates
        const { data: ride, error: rideError } = await supabase
            .from("rides")
            .select("pickup_lat, pickup_lng")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            throw new Error("Ride not found");
        }

        // 3. Radius Expansion Strategy
        const searchRadii = [2000, 5000, 10000, 50000]; // 2km -> 5km -> 10km -> 50km
        let selectedDriver = null;

        // Attempt Real Search
        for (const radius of searchRadii) {
            console.log(`Searching radius: ${radius}m`);
            const { data: nearbyDrivers, error: nearbyError } = await supabase
                .rpc('get_nearby_drivers', {
                    center_lat: ride.pickup_lat,
                    center_lng: ride.pickup_lng,
                    radius_meters: radius
                });

            if (!nearbyError && nearbyDrivers && nearbyDrivers.length > 0) {
                // Filter out the bot to prefer real humans first
                const realDrivers = nearbyDrivers.filter((d: any) => d.id !== '00000000-0000-0000-0000-000000000000');

                if (realDrivers.length > 0) {
                    selectedDriver = realDrivers[Math.floor(Math.random() * realDrivers.length)];
                    console.log("Found REAL driver:", selectedDriver.name);
                    break;
                }
            }
        }

        // 4. Fallback: The System Bot (Teleportation)
        if (!selectedDriver) {
            console.warn("No real drivers found. Activating SYSTEM BOT.");

            // Teleport Bot to ~300m away so it shows up on map nicely
            // simple math: adds ~0.003 degrees (~300m)
            const botLat = ride.pickup_lat + 0.003;
            const botLng = ride.pickup_lng + 0.003;

            const botData = {
                id: '00000000-0000-0000-0000-000000000000',
                name: 'G-Taxi Bot 🤖',
                vehicle_model: 'Cyber Taxi',
                plate_number: 'TEST-AI',
                rating: 5.0,
                phone_number: '+1 868 000 0000',
                lat: botLat,
                lng: botLng,
                heading: Math.random() * 360,
                status: 'online',
                is_online: true
            };

            const { data: botDriver, error: botError } = await supabase
                .from("drivers")
                .upsert(botData)
                .select()
                .single();

            if (botError || !botDriver) {
                console.error("Failed to activate bot:", botError);
                return new Response(
                    JSON.stringify({ success: false, error: "Failed to create/activate bot driver", data: null }),
                    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            selectedDriver = botDriver;
        }

        // 5. Assign Driver
        const { error: assignedError } = await supabase
            .from("rides")
            .update({
                status: "assigned",
                driver_id: selectedDriver.id
            })
            .eq("id", ride_id);

        if (assignedError) {
            throw assignedError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id,
                    status: "assigned",
                    driver: {
                        name: selectedDriver.name,
                        vehicle: selectedDriver.vehicle_model,
                        plate: selectedDriver.plate_number,
                        rating: parseFloat(selectedDriver.rating),
                        phone: selectedDriver.phone_number
                    },
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("match_driver error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
