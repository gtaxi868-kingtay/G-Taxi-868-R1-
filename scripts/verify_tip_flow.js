const { createClient } = require('@supabase/supabase-js');

// Config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    console.log('🧪 Verifying Phase 10: Tip Infrastructure (PROBE)...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        // 0. Check for Tip Infrastructure (Fast Fail)
        const { error: colCheck } = await admin.from('rides').select('tip_amount').limit(1);
        if (colCheck) throw new Error('❌ Missing tip_amount column. apply 20260216090000_tip_infrastructure.sql');

        // 1. Setup User (Rider)
        const email = `tip-test-${Date.now()}@test.com`;
        const password = 'password123';
        console.log(`   Creating User: ${email}`);

        const { data: user, error: uErr } = await admin.auth.signUp({
            email, password, options: { data: { full_name: 'Tip Tester' } }
        });
        if (uErr) throw uErr;
        const userId = user.user.id;

        // Login
        const { data: { session }, error: loginErr } = await authClient.auth.signInWithPassword({ email, password });
        if (loginErr) throw loginErr;
        const token = session.access_token;
        console.log('   ✅ User Authenticated');

        // 2. Top Up Wallet ($50.00) - VIA RPC
        console.log('   Top Up $50.00 (Via RPC)...');

        // PROBE
        console.log('   (Probing RPC permission with dummy UUID...)');
        const { error: probeErr } = await admin.rpc('admin_top_up', {
            p_user_id: '00000000-0000-0000-0000-000000000000',
            p_amount: 100
        });

        if (probeErr) {
            if (probeErr.code === '42501') {
                console.error('   ❌ PROBE FAILED: Permission Denied (42501). Migration NOT effectively applied?');
            } else if (probeErr.code === '23503') {
                console.log('   ✅ Probe Passed Check (Hit FK Error 23503 as expected for dummy user)');
            } else {
                console.log('   ⚠️ Probe Error (Other):', probeErr.code, probeErr.message);
            }
        } else {
            console.log('   ✅ Probe Success (Unexpectedly, did it insert for dummy user?)');
        }

        const { error: topUpErr } = await admin.rpc('admin_top_up', {
            p_user_id: userId,
            p_amount: 5000
        });

        if (topUpErr) {
            console.error('   ❌ TopUp RPC Failed:', topUpErr);
            throw topUpErr;
        }

        // Check Balance
        const { data: bal } = await admin.rpc('get_wallet_balance', { p_user_id: userId });
        console.log(`   💰 Balance after TopUp: $${bal / 100}`);

        if (bal < 3000) {
            throw new Error(`Insufficient Balance: ${bal}`);
        }

        // 3. Create Ride (Cost $20 approx)
        console.log('   Creating Ride...');
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
        const d1 = await res1.json();
        if (!d1.success) throw new Error('Ride Create Failed: ' + JSON.stringify(d1));
        const rideId = d1.data.ride_id;
        console.log(`   ✅ Ride Created: ${rideId}`);

        // 4. Complete Ride (Admin Force)
        console.log('   Completing Ride...');
        // Need driver first
        const driverEmail = `driver-tip-${Date.now()}@test.com`;
        const { data: dUser } = await admin.auth.signUp({ email: driverEmail, password: 'password' });
        const driverId = dUser.user.id;

        // Create Driver Profile manually if RPC fails, or try RPC
        const { error: drvErr } = await admin.rpc('admin_create_driver', { p_id: driverId, p_name: 'Driver Tip', p_status: 'online', p_is_online: true });
        if (drvErr) {
            console.log('   Warning: admin_create_driver failed, trying manual insert...');
            await admin.from('drivers').insert({ id: driverId, name: 'Driver Tip', status: 'online', is_online: true, vehicle_model: 'Taxi', plate_number: 'TIP123', current_lat: 10, current_lng: -60, heading: 0 });
        }

        // Force transitions
        await admin.rpc('admin_update_ride_status', { p_ride_id: rideId, p_status: 'assigned', p_driver_id: driverId });
        await admin.rpc('admin_update_ride_status', { p_ride_id: rideId, p_status: 'in_progress', p_driver_id: driverId });

        // Mark Payment Captured manually (Foundational Safety Trigger requires this)
        await admin.from('rides').update({ payment_status: 'captured' }).eq('id', rideId);

        await admin.rpc('admin_update_ride_status', { p_ride_id: rideId, p_status: 'completed', p_driver_id: driverId });
        console.log(`   ✅ Ride Completed`);

        // 5. TEST TIP (RPC)
        console.log('   💰 Attempting $5.00 Tip...');
        // We call the RPC via the Auth Client (Rider perspective)
        const { data: tipSuccess, error: tipError } = await authClient.rpc('process_tip', {
            p_ride_id: rideId,
            p_amount: 500
        });

        if (tipError) {
            console.error('   ❌ FAIL: Tip RPC Error:', tipError);
            throw tipError;
        }

        if (tipSuccess) {
            console.log('   ✅ Tip Processed Successfully');
        } else {
            console.error('   ❌ Tip Returned False (Insufficient Funds?)');
        }

        // 6. Verify Ride Column
        const { data: rideRow } = await admin.from('rides').select('tip_amount').eq('id', rideId).single();
        if (rideRow.tip_amount === 500) {
            console.log('   ✅ Ride Column Updated: $5.00');
        } else {
            console.log(`   ❌ Ride Column Mismatch: ${rideRow.tip_amount}`);
        }

        // 7. Verify Ledger for Tip
        const { data: ledger, error: lErr } = await admin
            .from('wallet_transactions')
            .select('*')
            .eq('ride_id', rideId)
            .eq('transaction_type', 'tip')
            .single();

        if (lErr || !ledger) throw new Error('Tip Transaction not found in DB');
        console.log(`   ✅ Ledger Entry Found: -$${Math.abs(ledger.amount) / 100} (${ledger.transaction_type})`);


    } catch (err) {
        console.error('Unexpected Error:', err);
        process.exit(1);
    }
}

main();
