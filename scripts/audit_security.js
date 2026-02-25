const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🛡️  Starting Security Audit: RLS & Auth Validation');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 1. Create a Hacker User
    const email = `hacker-${Date.now()}@test.com`;
    const password = 'password123';
    await admin.auth.admin.createUser({ email, password, email_confirm: true });

    // Login as Hacker
    const { data: login } = await anon.auth.signInWithPassword({ email, password });
    const hackerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${login.session.access_token}` } }
    });
    const hackerId = login.user.id;
    console.log(`   Hacker ID: ${hackerId}`);

    // 2. Test: Can Hacker see ALL rides?
    // First, verify there are rides in the DB (created by other tests)
    const { count } = await admin.from('rides').select('*', { count: 'exact', head: true });
    console.log(`   (Admin sees ${count} total rides)`);

    const { data: visibleRides } = await hackerClient.from('rides').select('*');
    console.log(`   Hacker sees: ${visibleRides.length} rides`);

    if (visibleRides.length === 0) {
        console.log('   ✅ PASS: RLS prevents viewing others rides');
    } else {
        console.log('   ❌ FAIL: Hacker can see rides!');
    }

    // 3. Test: Can Hacker insert a ride for SOMEONE ELSE?
    // We need a victim ID. Let's create one.
    const { data: victim } = await admin.auth.admin.createUser({ email: `victim-${Date.now()}@test.com`, password, email_confirm: true });
    const victimId = victim.user.id;

    console.log(`   Attempting to spoof Ride for Victim ID: ${victimId}...`);
    const { error: spoofError } = await hackerClient.from('rides').insert({
        rider_id: victimId, // SPOOF!
        pickup_lat: 10, pickup_lng: -61, dropoff_lat: 10, dropoff_lng: -61,
        status: 'searching'
    });

    if (spoofError) {
        console.log('   ✅ PASS: ID Spoofing blocked:', spoofError.message);
    } else {
        console.log('   ❌ FAIL: Hacker created ride for victim!');
    }

    // 4. Test: Can Hacker update a Victim's ride?
    // Admin creates a ride for victim
    const { data: vRide } = await admin.from('rides').insert({
        rider_id: victimId,
        pickup_lat: 10, pickup_lng: -61, dropoff_lat: 10, dropoff_lng: -61,
        status: 'searching'
    }).select().single();

    console.log(`   Attempting to DELETE/UPDATE Victim Ride: ${vRide.id}...`);
    const { error: updateError } = await hackerClient.from('rides').update({ status: 'cancelled' }).eq('id', vRide.id); // RLS often silences updates if row not visible, returning 0 rows modified, OR errors.

    // We check if it actually changed
    const { data: checkRide } = await admin.from('rides').select('status').eq('id', vRide.id).single();
    if (checkRide.status === 'searching') {
        console.log('   ✅ PASS: Unauthorized Update prevented (State unchanged)');
    } else {
        console.log('   ❌ FAIL: Hacker cancelled the ride!');
    }

}

main();
