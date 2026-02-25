const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔄 Verifying State Restoration (Simulation of App Resume)...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Setup User and Active Ride
    const email = `restore-${Date.now()}@test.com`;
    // Create User
    const { data: u } = await admin.auth.admin.createUser({ email, password: 'password', email_confirm: true });
    const userId = u.user.id;

    // Create Active Ride via DB (Simulating state exists)
    const { data: ride } = await admin.from('rides').insert({
        rider_id: userId,
        pickup_lat: 10, pickup_lng: -10, dropoff_lat: 10, dropoff_lng: -10,
        status: 'in_progress', // Active state
        total_fare_cents: 2000
    }).select().single();

    console.log(`   Ride Created with status 'in_progress': ${ride.id}`);

    // 2. Simulate Client fetching 'get_active_ride'
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: login } = await client.auth.signInWithPassword({ email, password: 'password' });
    const token = login.session.access_token;

    console.log("   Calling get_active_ride Edge Function...");
    const fnUrl = `${SUPABASE_URL}/functions/v1/get_active_ride`;

    try {
        const resp = await fetch(fnUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await resp.json();

        if (resp.ok && result.data && result.data.ride_id === ride.id) {
            console.log("   ✅ PASS: State Restored Correctly.");
            console.log("   Recovered Ride ID:", result.data.ride_id);
            console.log("   Recovered Status:", result.data.status);
        } else {
            console.log("   ❌ FAIL: Could not restore state.", result);
        }
    } catch (e) {
        console.log("   ❌ FAIL: Network/Function Error", e);
    }
}

main().catch(console.error);
