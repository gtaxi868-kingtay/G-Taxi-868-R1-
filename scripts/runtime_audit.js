/**
 * RUNTIME TRUTH VERIFICATION SCRIPT
 * 
 * Executes live probes against the G-Taxi Supabase backend.
 * Tests every Edge Function, database state, and realtime connectivity.
 * 
 * Usage: node scripts/runtime_audit.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kdatihgcxrosuwcqtjsi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYXRpaGdjeHJvc3V3Y3F0anNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyOTMxNzMsImV4cCI6MjA4NDg2OTE3M30.dQ6Fm4DrKdkWHPlMGr82fPr6mWtzRVYkJ8SnLnDrTLQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const results = [];

function log(stage, test, status, details) {
    const entry = { stage, test, status, details, timestamp: new Date().toISOString() };
    results.push(entry);
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} [${stage}] ${test}: ${details}`);
}

// ============================================================
// STAGE 0: SUPABASE CONNECTIVITY
// ============================================================
async function stage0_connectivity() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 0: SUPABASE CONNECTIVITY');
    console.log('══════════════════════════════════════════════\n');

    // Test basic connectivity
    try {
        const { data, error } = await supabase.from('drivers').select('count', { count: 'exact', head: true });
        if (error) {
            log('S0', 'Supabase Connection', 'FAIL', `Error: ${error.message}`);
        } else {
            log('S0', 'Supabase Connection', 'PASS', 'Connected to Supabase successfully');
        }
    } catch (e) {
        log('S0', 'Supabase Connection', 'FAIL', `Exception: ${e.message}`);
    }

    // Test auth
    try {
        const { data, error } = await supabase.auth.getSession();
        log('S0', 'Auth Session (Anonymous)', error ? 'FAIL' : 'PASS',
            error ? `Error: ${error.message}` : `Session: ${data.session ? 'Active' : 'No session (expected for anon)'}`);
    } catch (e) {
        log('S0', 'Auth Session', 'FAIL', `Exception: ${e.message}`);
    }
}

// ============================================================
// STAGE 1: DATABASE STATE AUDIT
// ============================================================
async function stage1_database() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 1: DATABASE STATE AUDIT');
    console.log('══════════════════════════════════════════════\n');

    // Count drivers
    const { data: drivers, error: dErr } = await supabase.from('drivers').select('id, name, status, is_online, is_bot, lat, lng, vehicle_model, plate_number');
    if (dErr) {
        log('S1', 'Drivers Table', 'FAIL', `Error: ${dErr.message}`);
    } else {
        log('S1', 'Drivers Count', 'INFO', `${drivers.length} drivers in database`);
        const online = drivers.filter(d => d.is_online);
        const bots = drivers.filter(d => d.is_bot);
        log('S1', 'Online Drivers', 'INFO', `${online.length} online, ${bots.length} bots`);
        drivers.forEach(d => {
            console.log(`   📋 ${d.name || 'unnamed'} | status=${d.status} | online=${d.is_online} | bot=${d.is_bot} | pos=${d.lat?.toFixed(4)},${d.lng?.toFixed(4)} | ${d.vehicle_model} ${d.plate_number}`);
        });
    }

    // Count rides by status
    const { data: rides, error: rErr } = await supabase.from('rides').select('id, status, rider_id, driver_id, created_at, updated_at, total_fare_cents');
    if (rErr) {
        log('S1', 'Rides Table', 'FAIL', `Error: ${rErr.message}`);
    } else {
        log('S1', 'Rides Count', 'INFO', `${rides.length} total rides`);
        const statusCounts = {};
        rides.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`   📊 ${status}: ${count} rides`);
        });

        // Check for stuck rides
        const stuckStatuses = ['requested', 'searching', 'assigned', 'in_progress'];
        const stuck = rides.filter(r => stuckStatuses.includes(r.status));
        if (stuck.length > 0) {
            log('S1', 'Stuck Rides', 'WARN', `${stuck.length} rides in active states`);
            stuck.forEach(r => {
                const age = (Date.now() - new Date(r.updated_at || r.created_at).getTime()) / 60000;
                console.log(`   ⚠️  Ride ${r.id.slice(0, 8)}... status=${r.status} age=${age.toFixed(0)}min driver=${r.driver_id?.slice(0, 8) || 'none'}`);
            });
        } else {
            log('S1', 'Stuck Rides', 'PASS', 'No stuck rides found');
        }
    }

    // Check profiles
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, full_name, phone');
    if (pErr) {
        log('S1', 'Profiles Table', 'FAIL', `Error: ${pErr.message} (RLS may block anon access)`);
    } else {
        log('S1', 'Profiles', 'INFO', `${profiles.length} profiles accessible via anon key`);
    }

    // Check locations table
    const { data: locations, error: lErr } = await supabase.from('locations').select('id', { count: 'exact', head: true });
    if (lErr) {
        log('S1', 'Locations Table', 'FAIL', `Error: ${lErr.message}`);
    } else {
        log('S1', 'Locations Table', 'PASS', 'Locations table accessible');
    }

    // Check ride_offers
    const { data: offers, error: oErr } = await supabase.from('ride_offers').select('id, ride_id, driver_id, status, created_at');
    if (oErr) {
        log('S1', 'Ride Offers', 'FAIL', `Error: ${oErr.message}`);
    } else {
        log('S1', 'Ride Offers', 'INFO', `${offers.length} ride offers in database`);
    }

    // Check events
    const { data: events, error: eErr } = await supabase.from('events').select('id', { count: 'exact', head: true });
    if (eErr) {
        log('S1', 'Events Table', 'FAIL', `Error: ${eErr.message}`);
    } else {
        log('S1', 'Events Table', 'PASS', 'Events table accessible');
    }
}

// ============================================================
// STAGE 2: EDGE FUNCTION PROBES
// ============================================================
async function stage2_edgeFunctions() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 2: EDGE FUNCTION PROBES');
    console.log('══════════════════════════════════════════════\n');

    // Test estimate_fare (no auth required)
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('estimate_fare', {
            body: {
                pickup_lat: 10.6549,
                pickup_lng: -61.5019,
                dropoff_lat: 10.6700,
                dropoff_lng: -61.5200,
                vehicle_type: 'Standard'
            }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'estimate_fare', 'FAIL', `Error: ${error.message} (${elapsed}ms)`);
        } else if (data && data.success) {
            log('S2', 'estimate_fare', 'PASS', `Fare=$${(data.data.estimated_fare_cents / 100).toFixed(2)} dist=${data.data.distance_meters}m dur=${data.data.duration_seconds}s (${elapsed}ms)`);
        } else {
            log('S2', 'estimate_fare', 'FAIL', `Response: ${JSON.stringify(data)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'estimate_fare', 'FAIL', `Exception: ${e.message}`);
    }

    // Test geocode
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('geocode', {
            body: { query: 'Port of Spain', limit: 5 }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'geocode', 'FAIL', `Error: ${error.message} (${elapsed}ms)`);
        } else if (data && data.success) {
            log('S2', 'geocode', 'PASS', `${data.data.length} results, source=${data.source} (${elapsed}ms)`);
            data.data.slice(0, 3).forEach(r => {
                console.log(`   📍 ${r.name}: ${r.latitude?.toFixed(4)}, ${r.longitude?.toFixed(4)} [${r.category}]`);
            });
        } else {
            log('S2', 'geocode', 'FAIL', `Response: ${JSON.stringify(data)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'geocode', 'FAIL', `Exception: ${e.message}`);
    }

    // Test get_active_ride (no JWT — should return null)
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('get_active_ride', {
            body: {}
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'get_active_ride (no auth)', 'FAIL', `Error: ${error.message} (${elapsed}ms)`);
        } else if (data && data.success && data.data === null) {
            log('S2', 'get_active_ride (no auth)', 'PASS', `Returns null ride as expected (${elapsed}ms)`);
        } else {
            log('S2', 'get_active_ride (no auth)', 'WARN', `Unexpected: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'get_active_ride', 'FAIL', `Exception: ${e.message}`);
    }

    // Test create_ride WITHOUT auth (security test)
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('create_ride', {
            body: {
                pickup_lat: 10.6549,
                pickup_lng: -61.5019,
                dropoff_lat: 10.6700,
                dropoff_lng: -61.5200,
                vehicle_type: 'Standard',
                payment_method: 'cash'
            }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'create_ride (NO AUTH)', 'PASS', `Correctly rejected unauthenticated request: ${error.message} (${elapsed}ms)`);
        } else if (data && data.success) {
            log('S2', 'create_ride (NO AUTH)', 'FAIL', `⚠️ SECURITY: Ride created WITHOUT authentication! ride_id=${data.data.ride_id} (${elapsed}ms)`);
            // Clean up the unauthorized ride
            if (data.data.ride_id) {
                await supabase.from('rides').update({ status: 'cancelled' }).eq('id', data.data.ride_id);
                console.log(`   🧹 Cleaned up unauthorized ride ${data.data.ride_id}`);
            }
        } else {
            log('S2', 'create_ride (NO AUTH)', 'INFO', `Response: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'create_ride (NO AUTH)', 'FAIL', `Exception: ${e.message}`);
    }

    // Test match_driver with bogus ride ID
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('match_driver', {
            body: { ride_id: '00000000-0000-0000-0000-000000000000' }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'match_driver (bogus id)', 'INFO', `Error: ${error.message} (${elapsed}ms)`);
        } else if (data && !data.success) {
            log('S2', 'match_driver (bogus id)', 'PASS', `Correctly returns error: ${data.error} (${elapsed}ms)`);
        } else {
            log('S2', 'match_driver (bogus id)', 'WARN', `Unexpected: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'match_driver', 'FAIL', `Exception: ${e.message}`);
    }

    // Test cancel_ride without auth
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('cancel_ride', {
            body: { ride_id: '00000000-0000-0000-0000-000000000000' }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'cancel_ride (no auth)', 'PASS', `Correctly rejected: ${error.message} (${elapsed}ms)`);
        } else if (data && !data.success && data.error === 'Missing authorization') {
            log('S2', 'cancel_ride (no auth)', 'PASS', `Correctly requires auth: "${data.error}" (${elapsed}ms)`);
        } else {
            log('S2', 'cancel_ride (no auth)', 'FAIL', `Unexpected: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'cancel_ride', 'FAIL', `Exception: ${e.message}`);
    }

    // Test complete_ride without auth
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('complete_ride', {
            body: { ride_id: '00000000-0000-0000-0000-000000000000' }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'complete_ride (no auth)', 'PASS', `Correctly rejected: ${error.message} (${elapsed}ms)`);
        } else if (data && !data.success && data.error === 'Missing authorization') {
            log('S2', 'complete_ride (no auth)', 'PASS', `Correctly requires auth: "${data.error}" (${elapsed}ms)`);
        } else {
            log('S2', 'complete_ride (no auth)', 'FAIL', `Unexpected: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'complete_ride', 'FAIL', `Exception: ${e.message}`);
    }

    // Test accept_ride without auth (security test)
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('accept_ride', {
            body: { ride_id: '00000000-0000-0000-0000-000000000000', driver_id: '00000000-0000-0000-0000-000000000000' }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'accept_ride (no auth)', 'INFO', `Response: ${error.message} (${elapsed}ms)`);
        } else if (data && !data.success) {
            log('S2', 'accept_ride (no auth)', 'WARN', `No auth required! Returns: ${data.error} (only data validation stops it) (${elapsed}ms)`);
        } else {
            log('S2', 'accept_ride (no auth)', 'FAIL', `⚠️ SECURITY: Accepts without authentication (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'accept_ride', 'FAIL', `Exception: ${e.message}`);
    }

    // Test update_driver_location without auth (security test)
    try {
        const start = Date.now();
        const { data, error } = await supabase.functions.invoke('update_driver_location', {
            body: { driver_id: '00000000-0000-0000-0000-000000000000', lat: 10.65, lng: -61.50 }
        });
        const elapsed = Date.now() - start;
        if (error) {
            log('S2', 'update_driver_location (no auth)', 'INFO', `Response: ${error.message} (${elapsed}ms)`);
        } else if (data && data.success) {
            log('S2', 'update_driver_location (no auth)', 'FAIL', `⚠️ SECURITY: Location updated without auth! (${elapsed}ms)`);
        } else {
            log('S2', 'update_driver_location (no auth)', 'WARN', `Response: ${JSON.stringify(data).slice(0, 200)} (${elapsed}ms)`);
        }
    } catch (e) {
        log('S2', 'update_driver_location', 'FAIL', `Exception: ${e.message}`);
    }
}

// ============================================================
// STAGE 3: REALTIME CONNECTIVITY TEST
// ============================================================
async function stage3_realtime() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 3: REALTIME CONNECTIVITY TEST');
    console.log('══════════════════════════════════════════════\n');

    return new Promise((resolve) => {
        let subscribed = false;
        const timeout = setTimeout(() => {
            if (!subscribed) {
                log('S3', 'Realtime Subscribe', 'FAIL', 'Timed out after 10s waiting for SUBSCRIBED status');
            }
            supabase.removeAllChannels();
            resolve();
        }, 10000);

        const channel = supabase
            .channel('audit-test')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'drivers'
            }, (payload) => {
                log('S3', 'Realtime Event', 'PASS', `Received ${payload.eventType} on drivers table`);
            })
            .subscribe((status, err) => {
                console.log(`   📡 Realtime status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    subscribed = true;
                    log('S3', 'Realtime Subscribe', 'PASS', 'Successfully subscribed to drivers table');
                    clearTimeout(timeout);
                    // Wait 2 more seconds to see if any events come in
                    setTimeout(() => {
                        supabase.removeAllChannels();
                        resolve();
                    }, 2000);
                } else if (status === 'CHANNEL_ERROR') {
                    log('S3', 'Realtime Subscribe', 'FAIL', `Channel error: ${err}`);
                    clearTimeout(timeout);
                    supabase.removeAllChannels();
                    resolve();
                } else if (status === 'TIMED_OUT') {
                    log('S3', 'Realtime Subscribe', 'FAIL', 'Realtime subscription timed out');
                    clearTimeout(timeout);
                    supabase.removeAllChannels();
                    resolve();
                }
            });
    });
}

// ============================================================
// STAGE 4: AUTHENTICATED RIDE FLOW TEST
// ============================================================
async function stage4_authFlow() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 4: AUTHENTICATED RIDE FLOW TEST');
    console.log('══════════════════════════════════════════════\n');

    // Try login with test account
    const testEmail = 'test@gtaxi.com';
    const testPassword = 'testpassword123';

    console.log(`   Attempting login: ${testEmail}`);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword
    });

    if (authError) {
        log('S4', 'Test Login', 'WARN', `Login failed: ${authError.message}. Will test unauthenticated flow.`);

        // Try signup
        console.log('   Attempting signup...');
        const { data: signupData, error: signupError } = await supabase.auth.signUp({
            email: `audit_${Date.now()}@gtaxi.com`,
            password: 'AuditTest123!'
        });
        if (signupError) {
            log('S4', 'Test Signup', 'WARN', `Signup failed: ${signupError.message}`);
        } else {
            log('S4', 'Test Signup', 'INFO', `Signup result: ${signupData.user ? 'User created' : 'Email confirmation required'}`);
        }

        return null;
    }

    log('S4', 'Test Login', 'PASS', `Logged in as ${authData.user.email}, user_id=${authData.user.id}`);

    // Check profile
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();

    if (profileError) {
        log('S4', 'Profile Load', 'WARN', `Profile error: ${profileError.message}`);
    } else {
        log('S4', 'Profile Load', profile ? 'PASS' : 'WARN',
            profile ? `Profile: ${profile.full_name || 'no name'}, phone=${profile.phone || 'none'}` : 'No profile found');
    }

    // Check preferences
    const { data: prefs, error: prefsError } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', authData.user.id)
        .single();

    if (prefsError) {
        log('S4', 'User Preferences', 'WARN', `Preferences error: ${prefsError.message}`);
    } else {
        log('S4', 'User Preferences', prefs ? 'PASS' : 'WARN',
            prefs ? `Preferences loaded` : 'No preferences found');
    }

    return authData;
}

// ============================================================
// STAGE 5: FULL RIDE LIFECYCLE (E2E)
// ============================================================
async function stage5_rideLifecycle(authData) {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 5: FULL RIDE LIFECYCLE (E2E)');
    console.log('══════════════════════════════════════════════\n');

    // 1. Estimate fare
    console.log('   Step 1: Estimate fare...');
    const { data: fareData, error: fareErr } = await supabase.functions.invoke('estimate_fare', {
        body: {
            pickup_lat: 10.6549, pickup_lng: -61.5019,
            dropoff_lat: 10.6700, dropoff_lng: -61.5200,
            vehicle_type: 'Standard'
        }
    });
    if (fareErr || !fareData?.success) {
        log('S5', 'Fare Estimate', 'FAIL', `${fareErr?.message || fareData?.error}`);
        return;
    }
    log('S5', 'Fare Estimate', 'PASS', `Fare=$${(fareData.data.estimated_fare_cents / 100).toFixed(2)}`);

    // 2. Create ride
    console.log('   Step 2: Create ride...');
    const { data: rideData, error: rideErr } = await supabase.functions.invoke('create_ride', {
        body: {
            pickup_lat: 10.6549, pickup_lng: -61.5019,
            pickup_address: 'Audit Test Pickup',
            dropoff_lat: 10.6700, dropoff_lng: -61.5200,
            dropoff_address: 'Audit Test Destination',
            vehicle_type: 'Standard',
            payment_method: 'cash'
        }
    });

    if (rideErr || !rideData?.success) {
        log('S5', 'Create Ride', 'FAIL', `${rideErr?.message || rideData?.error}`);
        return;
    }

    const rideId = rideData.data.ride_id;
    const rideStatus = rideData.data.status;
    const rideFare = rideData.data.total_fare_cents;
    log('S5', 'Create Ride', 'PASS', `ride_id=${rideId.slice(0, 8)}... status=${rideStatus} fare=$${(rideFare / 100).toFixed(2)}`);

    // Compare estimate vs actual fare
    if (fareData.data.estimated_fare_cents !== rideFare) {
        log('S5', 'Fare Consistency', 'WARN', `Estimate=$${(fareData.data.estimated_fare_cents / 100).toFixed(2)} vs Actual=$${(rideFare / 100).toFixed(2)} — MISMATCH (Mapbox may return different route)`);
    } else {
        log('S5', 'Fare Consistency', 'PASS', 'Estimate matches ride fare');
    }

    // 3. Verify in DB
    const { data: dbRide, error: dbErr } = await supabase.from('rides').select('*').eq('id', rideId).single();
    if (dbErr) {
        log('S5', 'DB Verify Ride', 'FAIL', `Error: ${dbErr.message}`);
    } else {
        log('S5', 'DB Verify Ride', 'PASS', `DB status=${dbRide.status} fare=${dbRide.total_fare_cents} pickup=${dbRide.pickup_address}`);

        // Check: Does DB status match API response?
        if (dbRide.status !== rideStatus) {
            log('S5', 'Status Consistency', 'FAIL', `API says ${rideStatus} but DB says ${dbRide.status}`);
        } else {
            log('S5', 'Status Consistency', 'PASS', 'API response matches database');
        }
    }

    // 4. Test duplicate ride creation
    console.log('   Step 4: Test duplicate ride creation...');
    const { data: dupData, error: dupErr } = await supabase.functions.invoke('create_ride', {
        body: {
            pickup_lat: 10.6549, pickup_lng: -61.5019,
            dropoff_lat: 10.6700, dropoff_lng: -61.5200,
            vehicle_type: 'Standard', payment_method: 'cash'
        }
    });
    if (dupData?.success && dupData.data?.existing_ride) {
        log('S5', 'Duplicate Prevention', 'PASS', 'Returned existing ride instead of creating duplicate');
    } else if (dupData?.success && dupData.data?.ride_id !== rideId) {
        log('S5', 'Duplicate Prevention', 'FAIL', `Created DUPLICATE ride: ${dupData.data.ride_id}`);
    } else {
        log('S5', 'Duplicate Prevention', 'INFO', `Response: ${JSON.stringify(dupData).slice(0, 200)}`);
    }

    // 5. Test match_driver
    console.log('   Step 5: Match driver...');
    const { data: matchData, error: matchErr } = await supabase.functions.invoke('match_driver', {
        body: { ride_id: rideId }
    });
    if (matchErr) {
        log('S5', 'Match Driver', 'FAIL', `Error: ${matchErr.message}`);
    } else if (matchData?.success) {
        const driver = matchData.data.driver;
        log('S5', 'Match Driver', 'PASS', `Matched: ${driver.name} (${driver.vehicle_model}) rating=${driver.rating}`);

        // Verify DB updated
        const { data: updatedRide } = await supabase.from('rides').select('status, driver_id').eq('id', rideId).single();
        if (updatedRide) {
            log('S5', 'Match DB Verify', updatedRide.status === 'assigned' ? 'PASS' : 'FAIL',
                `DB status=${updatedRide.status} driver_id=${updatedRide.driver_id?.slice(0, 8)}`);
        }
    } else {
        log('S5', 'Match Driver', 'WARN', `No match: ${matchData?.error}`);
    }

    // 6. Cancel the test ride
    console.log('   Step 6: Cancel test ride...');
    if (authData) {
        const { data: cancelData, error: cancelErr } = await supabase.functions.invoke('cancel_ride', {
            body: { ride_id: rideId, reason: 'Runtime audit test' }
        });
        if (cancelErr) {
            log('S5', 'Cancel Ride', 'FAIL', `Error: ${cancelErr.message}`);
        } else if (cancelData?.success) {
            log('S5', 'Cancel Ride', 'PASS', 'Ride cancelled successfully');
        } else {
            log('S5', 'Cancel Ride', 'WARN', `Response: ${JSON.stringify(cancelData).slice(0, 200)}`);
            // Fallback: cancel directly in DB
            await supabase.from('rides').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', rideId);
            log('S5', 'Cancel Ride (direct DB)', 'INFO', 'Cancelled via direct DB update');
        }
    } else {
        // No auth, cancel directly
        await supabase.from('rides').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', rideId);
        log('S5', 'Cancel Ride (no auth)', 'INFO', 'Cancelled via direct DB update (no auth session)');
    }
}

// ============================================================
// STAGE 6: VEHICLE MULTIPLIER VERIFICATION
// ============================================================
async function stage6_pricing() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 6: PRICING VERIFICATION');
    console.log('══════════════════════════════════════════════\n');

    const vehicles = ['Standard', 'XL', 'Premium'];
    const fares = {};

    for (const vt of vehicles) {
        const { data, error } = await supabase.functions.invoke('estimate_fare', {
            body: {
                pickup_lat: 10.6549, pickup_lng: -61.5019,
                dropoff_lat: 10.6700, dropoff_lng: -61.5200,
                vehicle_type: vt
            }
        });
        if (data?.success) {
            fares[vt] = data.data.estimated_fare_cents;
            console.log(`   ${vt}: $${(data.data.estimated_fare_cents / 100).toFixed(2)} TT (multiplier=${data.data.multiplier})`);
        }
    }

    // Verify multipliers
    if (fares.Standard && fares.XL) {
        const xlRatio = fares.XL / fares.Standard;
        log('S6', 'XL Multiplier', Math.abs(xlRatio - 1.5) < 0.01 ? 'PASS' : 'FAIL',
            `XL/Standard = ${xlRatio.toFixed(3)} (expected 1.5)`);
    }
    if (fares.Standard && fares.Premium) {
        const premRatio = fares.Premium / fares.Standard;
        log('S6', 'Premium Multiplier', Math.abs(premRatio - 2.0) < 0.01 ? 'PASS' : 'FAIL',
            `Premium/Standard = ${premRatio.toFixed(3)} (expected 2.0)`);
    }
}

// ============================================================
// STAGE 7: RATING PERSISTENCE TEST
// ============================================================
async function stage7_ratings() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  STAGE 7: RATING PERSISTENCE AUDIT');
    console.log('══════════════════════════════════════════════\n');

    // Check if ride_ratings table is accessible
    const { data, error } = await supabase.from('ride_ratings').select('*').limit(5);
    if (error) {
        log('S7', 'ride_ratings Table', 'FAIL', `Error: ${error.message}`);
    } else {
        log('S7', 'ride_ratings Data', 'INFO', `${data.length} ratings found`);
        if (data.length === 0) {
            log('S7', 'Rating Persistence', 'FAIL', 'ZERO ratings in database — confirms RatingScreen does NOT persist ratings');
        }
    }
}

// ============================================================
// FINAL REPORT
// ============================================================
function printReport() {
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         RUNTIME TRUTH VERIFICATION — FINAL REPORT     ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const warn = results.filter(r => r.status === 'WARN').length;
    const info = results.filter(r => r.status === 'INFO').length;
    const total = pass + fail + warn;

    console.log(`   ✅ PASS: ${pass}`);
    console.log(`   ❌ FAIL: ${fail}`);
    console.log(`   ⚠️  WARN: ${warn}`);
    console.log(`   ℹ️  INFO: ${info}`);
    console.log(`\n   SCORE: ${total > 0 ? ((pass / total) * 100).toFixed(1) : 0}% (${pass}/${total})\n`);

    if (fail > 0) {
        console.log('   ──── FAILURES ────');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`   ❌ [${r.stage}] ${r.test}: ${r.details}`);
        });
    }

    if (warn > 0) {
        console.log('\n   ──── WARNINGS ────');
        results.filter(r => r.status === 'WARN').forEach(r => {
            console.log(`   ⚠️  [${r.stage}] ${r.test}: ${r.details}`);
        });
    }

    console.log('\n══════════════════════════════════════════════\n');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║       G-TAXI RUNTIME TRUTH VERIFICATION               ║');
    console.log('║       Live execution audit against Supabase           ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log(`   Target: ${SUPABASE_URL}\n`);

    await stage0_connectivity();
    await stage1_database();
    await stage2_edgeFunctions();
    await stage3_realtime();
    const authData = await stage4_authFlow();
    await stage5_rideLifecycle(authData);
    await stage6_pricing();
    await stage7_ratings();

    printReport();

    // Sign out
    await supabase.auth.signOut();
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
});
