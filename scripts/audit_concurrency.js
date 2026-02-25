const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

console.log("DEBUG: Script Start");

async function main() {
    console.log('🏁 Starting Concurrency Audit: Race Condition Check');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("   Admin Client Created");

    // 1. Setup Data
    const timestamp = Date.now();
    const riderEmail = `audit-rider-${timestamp}@test.com`;
    const d1Email = `audit-d1-${timestamp}@test.com`;
    const d2Email = `audit-d2-${timestamp}@test.com`;
    const password = 'password123';

    console.log("   Creating Rider:", riderEmail);
    // Create Users
    const { data: uRider, error: e1 } = await admin.auth.admin.createUser({ email: riderEmail, password, email_confirm: true });
    if (e1) throw e1;
    console.log("   Rider Created");

    const { data: u1, error: e2 } = await admin.auth.admin.createUser({ email: d1Email, password, email_confirm: true });
    if (e2) throw e2;
    console.log("   Driver 1 Created");

    const { data: u2, error: e3 } = await admin.auth.admin.createUser({ email: d2Email, password, email_confirm: true });
    if (e3) throw e3;
    console.log("   Driver 2 Created");

    const d1Id = u1.user.id;
    const d2Id = u2.user.id;
    const riderId = uRider.user.id;

    console.log("   Creating Driver Profiles...");
    // Create Driver Profiles
    const { error: e4 } = await admin.from('drivers').insert([
        { id: d1Id, name: 'Race Driver 1', status: 'online', is_online: true },
        { id: d2Id, name: 'Race Driver 2', status: 'online', is_online: true }
    ]);
    if (e4) throw e4;

    console.log("   Creating Ride...");
    // Create Ride
    const { data: ride, error: e5 } = await admin.from('rides').insert({
        rider_id: riderId,
        pickup_lat: 10, pickup_lng: -61, dropoff_lat: 10.1, dropoff_lng: -61.1,
        status: 'searching'
    }).select().single();
    if (e5) throw e5;
    const rideId = ride.id;

    console.log("   Creating Offers...");
    // Create Offers
    const { data: o1 } = await admin.from('ride_offers').insert({ ride_id: rideId, driver_id: d1Id, status: 'pending' }).select().single();
    const { data: o2 } = await admin.from('ride_offers').insert({ ride_id: rideId, driver_id: d2Id, status: 'pending' }).select().single();

    console.log(`   Ride Created: ${rideId}`);
    console.log(`   Drivers: ${d1Id}, ${d2Id}`);

    // 2. Login Drivers
    const c1 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const c2 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await c1.auth.signInWithPassword({ email: d1Email, password });
    await c2.auth.signInWithPassword({ email: d2Email, password });

    // 3. RACE!
    console.log('🔥 FIRING RPCs SIMULTANEOUSLY...');
    const p1 = c1.rpc('accept_ride_offer', { p_offer_id: o1.id });
    const p2 = c2.rpc('accept_ride_offer', { p_offer_id: o2.id });

    const results = await Promise.all([p1, p2]);

    console.log('   Result 1:', results[0].data);
    console.log('   Result 2:', results[1].data);

    // 4. Verify State
    const { data: finalRide } = await admin.from('rides').select('driver_id, status').eq('id', rideId).single();
    const { data: acceptedOffers } = await admin.from('ride_offers').select('*').eq('ride_id', rideId).eq('status', 'accepted');

    console.log('\n📊 POST-MORTEM:');
    console.log(`   Ride Driver: ${finalRide.driver_id}`);
    console.log(`   Ride Status: ${finalRide.status}`);
    console.log(`   Accepted Offers Count: ${acceptedOffers.length}`);

    if (acceptedOffers.length === 1 && finalRide.status === 'assigned') {
        console.log('✅ PASS: Concurrency Safe (Only 1 winner)');
    } else {
        console.log('❌ FAIL: Race Condition Detected!');
    }
}

main().catch(err => {
    console.error("CRITICAL FAILURE:", err);
});
