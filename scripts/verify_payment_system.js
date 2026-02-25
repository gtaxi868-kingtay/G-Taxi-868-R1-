const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    console.log('💸 Starting Phase 7: Payment System Verification...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Setup User (Rider)
    const email = `wallet-test-${Date.now()}@test.com`;
    const password = 'password123';

    console.log(`   Creating User: ${email}`);
    const { data: user, error: uErr } = await admin.auth.signUp({
        email, password,
        options: { data: { full_name: 'Wallet Tester' } }
    });

    if (uErr) throw uErr;
    const userId = user.user.id;

    // Login to get Token
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session }, error: loginErr } = await authClient.auth.signInWithPassword({ email, password });
    if (loginErr) throw loginErr;
    const token = session.access_token;

    console.log('   ✅ User Authenticated.');

    // 2. TEST 1: Insufficient Balance Rejection
    console.log('   Test 1: Attempting Ride with Zero Balance...');
    const ridePayload = {
        pickup_lat: 10.0, pickup_lng: -60.0,
        dropoff_lat: 10.1, dropoff_lng: -60.1,
        payment_method: 'wallet'
    };

    const res1 = await fetch(`${SUPABASE_URL}/functions/v1/create_ride`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(ridePayload)
    });

    if (res1.status === 402) {
        console.log('   ✅ PASS: Connection Rejected (402 Insufficient Funds).');
    } else {
        console.log(`   ❌ FAIL: Expected 402, got ${res1.status}`);
        const txt = await res1.text();
        console.log(txt);
        process.exit(1);
    }

    // 3. TEST 2: Top Up Wallet
    console.log('   Test 2: Top Up Wallet (100.00 TTD)...');
    const { error: txErr } = await admin.rpc('admin_top_up', {
        p_user_id: userId,
        p_amount: 10000
    });

    if (txErr) {
        console.error('   ❌ FAIL: Wallet Insert Failed', txErr);
        // process.exit(1); 
    }

    const { data: balance } = await admin.rpc('get_wallet_balance', { p_user_id: userId });
    console.log(`   Current Balance: $${balance / 100}`);
    if (balance !== 10000) throw new Error('Balance update failed');

    // 4. TEST 3: Successful Creation
    console.log('   Test 3: Creating Ride with Sufficient Balance...');
    const res2 = await fetch(`${SUPABASE_URL}/functions/v1/create_ride`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(ridePayload)
    });

    const data2 = await res2.json();
    if (data2.success) {
        console.log(`   ✅ PASS: Ride Created ID: ${data2.data.ride_id}`);
    } else {
        console.log('   ❌ FAIL: Ride Creation failed after topup.');
        console.log(data2);
        process.exit(1);
    }

    const rideId = data2.data.ride_id;
    const fare = data2.data.total_fare_cents;
    console.log(`   Fare: $${fare / 100}`);

    // 5. TEST 5: Complete & Capture
    console.log('   Test 5: Completing Ride (Simulating Driver)...');
    // Assign Driver first (Admin)
    const { data: driverUser } = await admin.auth.signUp({ email: `driver-${Date.now()}@test.com`, password: 'password' });
    const driverId = driverUser.user.id;
    const { error: dErr } = await admin.rpc('admin_create_driver', {
        p_id: driverId,
        p_name: 'Driver',
        p_status: 'online',
        p_is_online: true
    });
    if (dErr) console.error('Driver Insert Error:', dErr);

    // Simulate State Machine (Strict Mode)
    const statuses = ['assigned', 'arrived', 'in_progress'];
    for (const s of statuses) {
        console.log(`   Transitioning to ${s}...`);

        const { error: sErr, data: success } = await admin.rpc('admin_update_ride_status', {
            p_ride_id: rideId,
            p_status: s,
            p_driver_id: driverId
        });

        if (sErr || !success) throw new Error(`Transition to ${s} failed: ${sErr ? sErr.message : 'No rows updated'}`);
        console.log(`   Transition Validated.`);
    }

    // Call Complete Ride (As Rider? Check Logic. "Only rider or driver can complete")
    // Let's call as Rider (since we have token)
    const res3 = await fetch(`${SUPABASE_URL}/functions/v1/complete_ride`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ride_id: rideId })
    });

    const data3 = await res3.json();
    if (data3.success) {
        console.log('   ✅ PASS: Ride Completed.');
    } else {
        console.log('   ❌ FAIL: Completion failed.');
        console.log(data3);
        process.exit(1);
    }

    // 6. VERIFY LEDGER
    console.log('   Verifying Ledger...');
    const { data: rideRow } = await admin.from('rides').select('payment_status').eq('id', rideId).single();
    if (rideRow.payment_status === 'captured') {
        console.log('   ✅ PASS: Ride Payment Status = Captured');
    } else {
        console.log(`   ❌ FAIL: Payment Status = ${rideRow.payment_status}`);
    }

    const { data: newBalance } = await admin.rpc('get_wallet_balance', { p_user_id: userId });
    console.log(`   New Balance: $${newBalance / 100}`);

    if (newBalance === (10000 - fare)) {
        console.log('   ✅ PASS: Balance Deduction Correct.');
    } else {
        console.log('   ❌ FAIL: Balance Incorrect.');
    }

}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
