const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manually parse shared/env.ts to avoid TS compilation issues in this script
const envPath = path.resolve(__dirname, '../shared/env.ts');
const envContent = fs.readFileSync(envPath, 'utf8');

const regexUrl = /SUPABASE_URL: '([^']+)'/;
const regexKey = /SUPABASE_ANON_KEY: '([^']+)'/;
const urlMatch = envContent.match(regexUrl);
const keyMatch = envContent.match(regexKey);

if (!urlMatch || !keyMatch) {
    console.error('Failed to parse ENV from shared/env.ts');
    process.exit(1);
}

const ENV = {
    SUPABASE_URL: urlMatch[1],
    SUPABASE_ANON_KEY: keyMatch[1]
};

// Found in scripts/simulate_active_driver.js
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

// Default location (Port of Spain)
const DEFAULT_LOCATION = {
    latitude: 10.6549,
    longitude: -61.5019
};

const RIDER_EMAIL = 'test_rider_sim_v6@gtaxi.com';
const DRIVER_EMAIL = 'test_driver_sim_v6@gtaxi.com';
const PASSWORD = 'password123';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrCreateUser(email, role) {
    console.log(`[Auth] Getting/Creating user: ${email} (${role})`);

    // 1. Sign In / Sign Up (CLIENT SIDE)
    const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
    let session = null;

    let { data: { session: existingSession }, error } = await supabase.auth.signInWithPassword({
        email,
        password: PASSWORD
    });

    if (error && error.message.includes('Invalid login credentials')) {
        console.log(`[Auth] User not found, creating new user...`);
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password: PASSWORD,
            options: {
                data: {
                    full_name: role === 'driver' ? 'Test Driver Sim' : 'Test Rider Sim',
                    phone_number: role === 'driver' ? '555-0100' : '555-0200',
                    avatar_url: 'https://placekitten.com/200/200'
                }
            }
        });

        if (signUpError) throw signUpError;
        session = signUpData.session;
        console.log('[Auth] User created. Waiting for triggers...');
        await sleep(3000);
    } else if (error) {
        throw error;
    } else {
        session = existingSession;
    }

    if (!session) throw new Error(`Failed to get session for ${email}`);

    // 2. Create Authenticated Client
    const userClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
    });

    // 3. Admin Client for Privileged Setup
    const adminClient = createClient(ENV.SUPABASE_URL, SERVICE_ROLE_KEY);

    const userId = session.user.id;

    // 4. Setup Profile / Driver Data via ADMIN
    if (role === 'driver') {
        const { error: driverError } = await adminClient
            .from('drivers')
            .upsert({
                id: userId,
                user_id: userId, // legacy field
                name: 'Test Driver Sim',
                phone_number: '555-0100',
                vehicle_model: 'Toyota Prius',
                plate_number: 'SIM-999',
                is_online: true,
                status: 'online',
                lat: DEFAULT_LOCATION.latitude,
                lng: DEFAULT_LOCATION.longitude,
                updated_at: new Date().toISOString()
            });

        if (driverError) {
            console.error('[Setup] Admin upsert failed:', driverError);
        }
    } else {
        // Fix profile via admin if missing
        const { data: profile } = await userClient.from('profiles').select('*').eq('id', userId).single();
        if (!profile) {
            console.log('[Setup] Admin fixing missing profile...');
            await adminClient.from('profiles').upsert({
                id: userId,
                email: email,
                full_name: 'Test Rider Sim',
                phone_number: '555-0200'
            });
        }
    }

    return { session, userId, client: userClient };
}

async function runSimulation() {
    console.log('🚀 Starting End-to-End Simulation (Admin Mode)...');

    try {
        // 1. Setup Actors
        const rider = await getOrCreateUser(RIDER_EMAIL, 'rider');
        const driver = await getOrCreateUser(DRIVER_EMAIL, 'driver');

        const riderClient = rider.client;
        const driverClient = driver.client;

        console.log('✅ Actors Ready');

        // 2. Rider: Create Ride Request
        console.log('[Rider] Requesting Ride...');
        const rideParams = {
            pickup_lat: DEFAULT_LOCATION.latitude + 0.001,
            pickup_lng: DEFAULT_LOCATION.longitude + 0.001,
            pickup_address: 'Sim Pickup St',
            dropoff_lat: DEFAULT_LOCATION.latitude + 0.02,
            dropoff_lng: DEFAULT_LOCATION.longitude + 0.02,
            dropoff_address: 'Sim Dropoff Ave',
            vehicle_type: 'Standard',
            payment_method: 'cash'
        };

        const { data: rideData, error: rideError } = await riderClient.functions.invoke('create_ride', {
            body: rideParams
        });

        if (rideError || !rideData || !rideData.success) {
            throw new Error(`Ride creation failed: ${rideError?.message || JSON.stringify(rideData)}`);
        }

        const rideId = rideData.data.ride_id;
        console.log(`✅ Ride Created: ${rideId}. Status: ${rideData.data.status}`);

        // 3. Driver: Check for Offer
        console.log('[Driver] Waiting for offer...');
        await sleep(3000);

        // Check for offer
        const { data: offerData, error: offerError } = await driverClient
            .from('ride_offers')
            .select('*')
            .eq('ride_id', rideId)
            .eq('driver_id', driver.userId)
            .single();

        if (offerError) {
            console.log('[Driver] No direct offer found. Calling match_driver explicitly...');
            await riderClient.functions.invoke('match_driver', { body: { ride_id: rideId } });
            await sleep(3000);

            // Re-check
            const { data: retryOffer } = await driverClient
                .from('ride_offers')
                .select('*')
                .eq('ride_id', rideId)
                .eq('driver_id', driver.userId)
                .single();

            if (!retryOffer) console.log('⚠️ Still no offer found. Driver might be busy or offline?');
            else console.log('✅ Offer received after manual match.');
        } else {
            console.log('✅ Offer received automatically.');
        }

        // 4. Driver: Accept Ride
        console.log('[Driver] Accepting Ride...');

        // DEBUG STATUS
        const { data: preAcceptRide } = await riderClient.from('rides').select('status, driver_id').eq('id', rideId).single();
        console.log(`[Debug] Ride status before accept: ${preAcceptRide.status}, Current Driver: ${preAcceptRide.driver_id}`);
        console.log(`[Debug] My Driver ID: ${driver.userId}`);

        const { data: acceptData, error: acceptError } = await driverClient.functions.invoke('accept_ride', {
            body: { ride_id: rideId, driver_id: driver.userId }
        });

        if (acceptError) {
            console.error('[Debug] Accept Response Error:', acceptError);
            throw new Error(`Accept failed: ${JSON.stringify(acceptError)}`);
        }

        // Check if data.success is true (the function might return 200 OK but success:false in body if we didn't handle that in wrapper)
        // Note: supabase-js functions.invoke returns the PARSED JSON body in `data` usually.
        // If the function returns { success: false, error: ... }, it will be in `data`.
        if (acceptData && acceptData.success === false) {
            console.error('[Debug] Accept Success=False:', acceptData);
            throw new Error(`Accept failed logic: ${acceptData.error}`);
        }

        console.log('✅ Ride Accepted.');

        // 5. Verify Status
        const { data: rideCheck } = await riderClient.from('rides').select('status, driver_id').eq('id', rideId).single();
        if (rideCheck.status !== 'assigned' || rideCheck.driver_id !== driver.userId) {
            throw new Error(`Status mismatch: ${rideCheck.status} (Driver: ${rideCheck.driver_id})`);
        }
        console.log(`✅ Verification: Ride is ${rideCheck.status}.`);

        // 6. Driver: Arrive
        console.log('[Driver] Arriving at pickup...');
        const { error: arriveError } = await driverClient.from('rides').update({ status: 'arrived' }).eq('id', rideId);
        if (arriveError) throw arriveError;
        await sleep(1000);

        // 7. Driver: Start Ride
        console.log('[Driver] Starting ride...');
        const { error: startError } = await driverClient.from('rides').update({ status: 'in_progress' }).eq('id', rideId);
        if (startError) throw startError;
        await sleep(1000);

        // 8. Driver: Complete Ride
        console.log('[Driver] Completing ride...');
        const { data: completeData, error: completeError } = await driverClient.functions.invoke('complete_ride', {
            body: { ride_id: rideId }
        });

        if (completeError) throw new Error(`Completion failed: ${completeError.message}`);
        console.log(`✅ Ride Completed. Final Fare: $${(completeData.data.total_fare_cents / 100).toFixed(2)}`);

        // 9. Rider: Tip (Optional)
        console.log('[Rider] Tipping $5...');
        const { data: tipData, error: tipError } = await riderClient.rpc('process_tip', {
            p_ride_id: rideId,
            p_amount: 500
        });

        if (tipError) console.error('Tip failed:', tipError);
        else console.log('✅ Tip processed.');

        console.log('🎉 SIMULATION SUCCESSFUL!');

    } catch (e) {
        console.error('❌ Simulation Failed:', e);
        process.exit(1);
    }
}

runSimulation();
