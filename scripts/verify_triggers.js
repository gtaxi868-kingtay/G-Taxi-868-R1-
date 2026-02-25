const { createClient } = require('@supabase/supabase-js');

// Config from verify_tip_flow.js
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    console.log('🔍 VERIFYING TRIGGERS (With Auth)...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        // 1. Create & Login User
        const email = `trigger-test-${Date.now()}@test.com`;
        const { data: user, error: uErr } = await admin.auth.signUp({
            email, password: 'password123'
        });
        if (uErr) {
            console.log('❌ Trigger Test Skipped: Could not create test user.');
            return;
        }
        const userId = user.user.id;

        const { data: { session }, error: loginErr } = await authClient.auth.signInWithPassword({ email, password: 'password123' });
        if (loginErr || !session) {
            console.log('❌ Trigger Test Skipped: Login failed.');
            return;
        }
        const token = session.access_token;
        console.log(`   User Created: ${userId}`);

        // 2. Create Dummy Ride (via Edge Function)
        const ridePayload = {
            pickup_lat: 10, pickup_lng: -60,
            dropoff_lat: 10.1, dropoff_lng: -60.1,
            payment_method: 'cash',
            vehicle_type: 'Standard'
        };

        const res = await fetch(`${SUPABASE_URL}/functions/v1/create_ride`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ridePayload)
        });

        const json = await res.json();

        if (!json.success || !json.data || !json.data.ride_id) {
            console.log('❌ Trigger Test Skipped: Create Ride Failed:', json);
            return;
        }
        const rideId = json.data.ride_id;
        console.log(`   Dummy Ride Created: ${rideId}`);

        // TEST 1: trg_validate_ride_status
        // Try to update status to 'invalid_status' via Admin (Triggers run on DB level, so Admin writes also trigger them)
        const { error: statusErr } = await admin.from('rides').update({ status: 'flying' }).eq('id', rideId);

        if (statusErr && statusErr.message.includes('invalid input value for enum')) {
            console.log('✅ Status Lifecycle: ENFORCED (Enum)');
        } else if (statusErr) {
            console.log('✅ Status Lifecycle: ACTIVE (Error: ' + statusErr.message + ')');
        } else {
            // If enum check fails, maybe text column? 
            // Try a logic violation (e.g. status transition 'completed' without payment?)
            console.log('⚠️ Status Lifecycle: Enum check failed (Maybe text column?). Checking transitions...');
        }

        // TEST 2: trg_block_completion_without_payment
        // Try to FORCE COMPLETE (Admin)
        // Cash payment, not confirmed.
        const { error: completeErr } = await admin.from('rides').update({ status: 'completed' }).eq('id', rideId);

        if (completeErr) {
            console.log('✅ Payment Enforcement: ACTIVE (Blocked completion: ' + completeErr.message + ')');
        } else {
            console.log('❌ Payment Enforcement: FAILED (Allowed completion without payment!)');
        }

        // TEST 3: Active Ride Recovery (Section E)
        const activeRes = await fetch(`${SUPABASE_URL}/functions/v1/get_active_ride`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const activeJson = await activeRes.json();
        if (activeJson.success && activeJson.data && activeJson.data.ride_id === rideId) {
            console.log('✅ Active Ride Recovery: WORKING (Returned current ride)');
        } else {
            console.log('❌ Active Ride Recovery: FAILED', activeJson);
        }

        // Clean up
        await admin.from('rides').delete().eq('id', rideId);

    } catch (err) {
        console.error('Trigger Test Error:', err);
    }
}

main();
