/**
 * simulate_active_driver.js
 * 
 * HARDENED DRIVER SIMULATION (Phase 2 Compatible)
 * 
 * This script acts EXACTLY like a real Driver App:
 * 1. Authenticates as a real user (creates a temp account).
 * 2. Hit the Edge Function API for location updates.
 * 3. Subscribes to ride_offers (RLS protected).
 * 4. Accepts offers via RPC (Auth protected).
 * 
 * Usage: node scripts/simulate_active_driver.js
 */

const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ FATAL: SUPABASE_SERVICE_ROLE_KEY is required.');
    process.exit(1);
}

// Admin client for setup/teardown
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// State
let driverUser = null;  // The Auth User
let driverProfile = null; // The Driver Table Row
let driverClient = null; // The Authenticated Client
let currentRide = null;
let movementInterval = null;
let offerChannel = null;

// ============ SETUP ============

async function setupEphemeralDriver() {
    const timestamp = Date.now();
    const email = `bot-${timestamp}@test.com`;
    const password = `pass-${timestamp}-secure`;

    console.log(`\n🤖 Creating ephemeral bot user: ${email}`);

    // 1. Create User
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (authError) {
        throw new Error(`Failed to create user: ${authError.message}`);
    }

    driverUser = authData.user;

    // 2. Create Driver Profile (if not auto-created by triggers, or explicit insert)
    // We assume 'drivers' table doesn't auto-create from auth.users (usually 'profiles' does).
    // Let's insert explicitly.
    const { data: driverData, error: driverError } = await supabaseAdmin
        .from('drivers')
        .insert({
            id: driverUser.id, // Link to Auth ID
            user_id: driverUser.id,
            name: `Bot ${timestamp.toString().substr(-4)}`,
            vehicle_model: 'Cyber Taxi Not-Tesla',
            plate_number: `BOT-${timestamp.toString().substr(-4)}`,
            is_bot: true,
            is_online: true,
            status: 'online',
            lat: 10.6549, // Port of Spain
            lng: -61.5019
        })
        .select()
        .single();

    if (driverError) {
        // If it failed, maybe trigger created it? Try fetching.
        console.warn(`   Insert failed (${driverError.message}), trying fetch...`);
        const { data: existing, error: fetchError } = await supabaseAdmin
            .from('drivers')
            .select('*')
            .eq('id', driverUser.id)
            .single();

        if (fetchError) throw new Error(`Failed to get driver profile: ${fetchError.message}`);
        driverProfile = existing;
    } else {
        driverProfile = driverData;
    }

    console.log(`   ✅ Driver Profile Created: ${driverProfile.name} (${driverProfile.id})`);

    // 3. Initialize Authenticated Client
    // We use the Access Token from the creation response? 
    // Wait, admin.createUser doesn't return a session usually. 
    // We need to valid login to get a token.
    const { data: loginData, error: loginError } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password
    });

    if (loginError) throw new Error(`Login failed: ${loginError.message}`);

    console.log(`   ✅ Authenticated as Driver. Token acquired.`);

    driverClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            headers: { Authorization: `Bearer ${loginData.session.access_token}` }
        }
    });

    return driverProfile;
}

// ============ API INTERACTION ============

async function updateLocationAPI(lat, lng, heading = 0) {
    // Phase 2: Use the Edge Function!
    // This confirms the API Gateway works.

    // NOTE: Edge Functions URL construction
    const functionsUrl = `${SUPABASE_URL}/functions/v1/update_driver_location`;

    try {
        // We use fetch directly to hit the Edge Function with Auth header
        const response = await fetch(functionsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': (await driverClient.auth.getSession()).data.session?.access_token
                    ? `Bearer ${(await driverClient.auth.getSession()).data.session.access_token}`
                    : `Bearer ${driverUser.aud}` // Fallback, shouldn't happen
            },
            body: JSON.stringify({
                lat,
                lng,
                heading,
                speed: 30 // km/h simulated
            })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`   ❌ API Update Failed: ${response.status} ${text}`);
        } else {
            // Success - silent
        }
    } catch (e) {
        console.error(`   ❌ API Network Error:`, e);
    }
}

// ============ LOGIC ============

async function checkForAssignedRides() {
    console.log('\n🔍 Checking for existing assigned rides...');

    // RLS Proof: This query uses driverClient. 
    // If Phase 2 Step 1 migration succeeded, this WILL return data.
    // If it fails, RLS is broken.
    const { data: rides, error } = await driverClient
        .from('rides')
        .select('*')
        .eq('driver_id', driverProfile.id)
        .in('status', ['assigned', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('   ❌ RLS Error (Check migration 019!):', error.message);
        return false;
    }

    if (rides && rides.length > 0) {
        const ride = rides[0];
        console.log(`   ✅ Found assigned ride: ${ride.id}`);
        handleAssignedRide(ride);
        return true;
    }

    console.log('   No assigned rides. Waiting for offers...');
    return false;
}

function handleAssignedRide(ride) {
    currentRide = ride;
    console.log(`\n📦 Starting simulation for ride: ${ride.id}`);

    if (ride.status === 'assigned') {
        console.log('   🚀 New Assignment! Navigating to pickup...');
        startMovingToward(ride.pickup_lat, ride.pickup_lng, 'pickup');
    } else if (ride.status === 'arrived') {
        console.log('   ⏳ At pickup, waiting...');
        setTimeout(async () => {
            await driverClient.from('rides').update({ status: 'in_progress' }).eq('id', ride.id);
            console.log('   🚀 TRIP STARTED!');
            startMovingToward(ride.dropoff_lat, ride.dropoff_lng, 'destination');
        }, 3000);
    } else if (ride.status === 'in_progress') {
        console.log('   🚗 Trip in progress...');
        startMovingToward(ride.dropoff_lat, ride.dropoff_lng, 'destination');
    }
}

function startListeningForOffers() {
    console.log('\n👂 LISTENING for ride offers (Realtime)...');

    // Subscribe to ride_offers via Authenticated Client
    offerChannel = driverClient
        .channel('bot-offers')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ride_offers' }, // Filter logic in callback
            (payload) => {
                // RLS should filter this for us, but double check
                console.log('   🔔 Offer received via Realtime!');
                if (payload.new.driver_id === driverProfile.id) {
                    handleNewOffer(payload.new);
                }
            }
        )
        .subscribe((status) => {
            console.log(`   Status: ${status}`);
        });

    // Fallback Poll
    setInterval(async () => {
        if (currentRide) return;
        const { data: offers } = await driverClient
            .from('ride_offers')
            .select('*')
            .eq('driver_id', driverProfile.id)
            .eq('status', 'pending')
            .limit(1);

        if (offers && offers.length > 0) {
            handleNewOffer(offers[0]);
        }
    }, 5000);
}

async function handleNewOffer(offer) {
    if (currentRide) return;

    // Fetch ride details via Authenticated Client (RLS Check!)
    const { data: ride } = await driverClient.from('rides').select('*').eq('id', offer.ride_id).single();
    if (!ride) {
        console.error("   ❌ Cannot see ride details! RLS might be blocking 'rides' SELECT.");
        return;
    }

    console.log(`\n🎉 Offer for Ride ${ride.id} ($${ride.total_fare_cents / 100})`);

    // Simulate think time
    await new Promise(r => setTimeout(r, 1000));

    // RPC Call (Auth Protected)
    console.log('   ✅ Accepting...');
    const { data: success, error } = await driverClient.rpc('accept_ride_offer', { p_offer_id: offer.id });

    if (error) console.error("   ❌ RPC Failed:", error.message);
    else if (!success) console.warn("   ⚠️ Offer expired or taken");
    else console.log("   🚀 Offer Accepted!");
}

function startMovingToward(targetLat, targetLng, phase) {
    if (movementInterval) clearInterval(movementInterval);

    movementInterval = setInterval(async () => {
        // Read current locaion from memory or DB?
        // Let's just update based on last known.
        // Simplified: Just jump for this robust script, or linear interpolate.
        // Let's do linear interp to make map look good.

        const currentLat = driverProfile.lat;
        const currentLng = driverProfile.lng;

        const dLat = targetLat - currentLat;
        const dLng = targetLng - currentLng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (dist < 0.0005) { // Arrived
            clearInterval(movementInterval);
            console.log(`   📍 Arrived at ${phase}`);

            if (phase === 'pickup') {
                await driverClient.from('rides').update({ status: 'arrived' }).eq('id', currentRide.id);
                console.log('   📝 Status: Arrived. Waiting 3s...');
                setTimeout(async () => {
                    await driverClient.from('rides').update({ status: 'in_progress' }).eq('id', currentRide.id);
                    console.log('   🚀 Status: In Progress');
                    startMovingToward(currentRide.dropoff_lat, currentRide.dropoff_lng, 'destination');
                }, 3000);
            } else {
                await driverClient.from('rides').update({ status: 'completed' }).eq('id', currentRide.id);
                console.log('   ✅ Status: Completed. Free for new rides.');
                currentRide = null;
                await driverClient.from('drivers').update({ status: 'online' }).eq('id', driverProfile.id);
            }
            return;
        }

        // Move
        const speed = 0.001; // fast bot
        const newLat = currentLat + (dLat / dist) * speed;
        const newLng = currentLng + (dLng / dist) * speed;
        driverProfile.lat = newLat;
        driverProfile.lng = newLng;

        // API Update
        await updateLocationAPI(newLat, newLng);

    }, 2000);
}


// ============ CLEANUP ============

async function cleanup() {
    console.log('\n🧹 Cleaning up...');
    if (movementInterval) clearInterval(movementInterval);
    if (driverUser) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(driverUser.id);
        if (error) console.error('   ❌ Failed to delete temp user:', error.message);
        else console.log('   ✅ Temp user deleted.');
    }
    process.exit(0);
}

// ============ MAIN ============

async function main() {
    try {
        await setupEphemeralDriver();
        const hasRide = await checkForAssignedRides();
        if (!hasRide) startListeningForOffers();

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch (e) {
        console.error("❌ Fatal Error:", e);
        await cleanup();
    }
}

main();
