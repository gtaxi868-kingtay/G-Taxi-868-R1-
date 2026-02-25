const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

console.log("🛡️ Starting Hardening Audit...");

async function main() {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Setup Test Rider
    const ts = Date.now();
    const riderEmail = `hard-${ts}@test.com`;
    const pwd = 'password123';

    console.log("Creating Rider...");
    const { data: u1, error: e1 } = await admin.auth.admin.createUser({ email: riderEmail, password: pwd, email_confirm: true });
    if (e1) throw e1;
    const riderId = u1.user.id; // User ID is rider ID

    // Create Ride
    console.log("Creating Ride...");
    const { data: ride, error: e2 } = await admin.from('rides').insert({
        rider_id: riderId,
        pickup_lat: 10, pickup_lng: -10, dropoff_lat: 10, dropoff_lng: -10,
        status: 'searching', // Valid start
        payment_method: 'card',
        total_fare_cents: 5000
    }).select().single();
    if (e2) throw e2;
    const rideId = ride.id;

    // TEST 1: ILLEGAL TRANSITION
    console.log("[TEST 1] Illegal Transition (searching -> completed)...");
    const { error: te1 } = await admin.from('rides').update({ status: 'completed' }).eq('id', rideId);
    if (te1 && te1.message.includes('Invalid Ride Status Transition')) {
        console.log("   ✅ PASS: Transition Blocked.");
    } else {
        console.log("   ❌ FAIL: Transition Allowed!", te1);
    }

    // TEST 2: PAYMENT GATE
    // Move to in_progress
    await admin.from('rides').update({ status: 'assigned' }).eq('id', rideId);
    // await admin.from('rides').update({ status: 'arrived' }).eq('id', rideId); // Skip enroute allows direct? No, trigger handles old=assigned -> new=arrived. Need to check strictly.
    // Trigger logic: if old=assigned and new=enroute -> OK.
    // If old=assigned and new=arrived -> Logic was "If old=assigned and new=arrived -> OK" (I put that in SQL).
    await admin.from('rides').update({ status: 'in_progress' }).eq('id', rideId); // Need to go assigned -> arrived -> in_progress?
    // Trigger: arrived -> in_progress OK.
    // Let's jump assigned -> in_progress? No, trigger blocks that.
    // So must do: assigned -> arrived -> in_progress.
    // Wait, I didn't add assigned -> in_progress logic in SQL. So it should fail if I skip arrived.
    await admin.from('rides').update({ status: 'arrived' }).eq('id', rideId);
    await admin.from('rides').update({ status: 'in_progress' }).eq('id', rideId);

    console.log("[TEST 2] Completion without Payment...");
    const { error: te2 } = await admin.from('rides').update({ status: 'completed' }).eq('id', rideId);
    if (te2 && te2.message.includes('Cannot complete ride without payment capture')) {
        console.log("   ✅ PASS: Payment Gate Active.");
    } else {
        console.log("   ❌ FAIL: Completion Allowed!", te2);
    }

    // TEST 3: DRIVER PERMISSIONS
    console.log("[TEST 3] Driver attempting to update FARE...");
    // Need Driver User
    const dEmail = `d-hard-${Date.now()}@test.com`;
    const { data: dU } = await admin.auth.admin.createUser({ email: dEmail, password: 'password', email_confirm: true });
    const dId = dU.user.id;
    // Insert driver profile manually (simulating system)
    await admin.from('drivers').insert({ id: dId, name: 'Hacker Driver', status: 'online', is_online: true });

    // Assign driver to ride 
    // Need to reset ride status to assigned to allow driver update? 
    // Or driver can update assigned rides.
    // Let's set driver_id on the ride.
    await admin.from('rides').update({ driver_id: dId }).eq('id', rideId);

    // Login as Driver
    const dClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await dClient.auth.signInWithPassword({ email: dEmail, password: 'password' });

    // Attempt Update Fare
    const { error: e3 } = await dClient.from('rides').update({ total_fare_cents: 999999 }).eq('id', rideId);

    if (e3) {
        if (e3.message.includes('Drivers cannot edit fare') || e3.message.includes('row-level security policy')) {
            console.log("   ✅ PASS: Driver Update Blocked:", e3.message);
        } else {
            console.log("   ❌ FAIL: Blocked but wrong reason?", e3);
        }
    } else {
        console.log("   ❌ FAIL: Driver updated fare!");
    }

}

main().catch(console.error);
