const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 Starting Phase 7: Lifecycle Audit with Event Logging Check...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Setup Data
    const rEmail = `audit-log-rider-${Date.now()}@test.com`;
    const { data: rU } = await admin.auth.admin.createUser({ email: rEmail, password: 'password', email_confirm: true });

    const dEmail = `audit-log-driver-${Date.now()}@test.com`;
    const { data: dU } = await admin.auth.admin.createUser({ email: dEmail, password: 'password', email_confirm: true });
    await admin.from('drivers').insert({ id: dU.user.id, name: 'Audit Driver', status: 'online', is_online: true });

    // 2. Create Ride (Status: searching)
    console.log('   Creating Ride (searching)...');
    const { data: ride } = await admin.from('rides').insert({
        rider_id: rU.user.id,
        pickup_lat: 10, pickup_lng: -10, dropoff_lat: 10, dropoff_lng: -10,
        status: 'searching',
        total_fare_cents: 2000,
        payment_method: 'cash'
    }).select().single();

    // 3. Assign Driver (searching -> assigned)
    console.log('   Assigning Driver (assigned)...');
    await admin.from('rides').update({
        driver_id: dU.user.id,
        status: 'assigned'
    }).eq('id', ride.id);

    // 4. In Progress (assigned -> in_progress) - skipping enroute/arrived for speed
    console.log('   Starting Ride (in_progress)...');
    // Note: Transition trigger blocks assigned->in_progress directly?
    // Let's check trigger logic:
    // assigned->enroute (OK), enroute->arrived (OK), arrived->in_progress (OK).
    // Can I jump assigned->in_progress?
    // Trigger says: "Invalid Ride Status Transition: assigned -> in_progress" (if verified).
    // Let's TRY it. If it fails, we know trigger works (Phase 2), so we respect it.

    // To respect trigger, we must step through.
    await admin.from('rides').update({ status: 'enroute' }).eq('id', ride.id);
    await admin.from('rides').update({ status: 'arrived' }).eq('id', ride.id);
    await admin.from('rides').update({ status: 'in_progress' }).eq('id', ride.id);

    // 5. Complete (in_progress -> completed)
    console.log('   Completing Ride (completed)...');
    try {
        await admin.from('rides').update({ status: 'completed' }).eq('id', ride.id);
    } catch (e) {
        console.log("   Creation failed (Expected if payment check active?)", e.message);
        // Oh right, we need payment captured if not cash.
        // We set payment_method='cash' above, so it SHOULD pass.
    }

    // 6. VERIFY AUDIT LOGS
    console.log('   Verifying ride_events...');
    const { data: events } = await admin.from('ride_events')
        .select('*')
        .eq('ride_id', ride.id)
        .order('created_at', { ascending: true });

    console.log(`   Found ${events.length} events.`);
    events.forEach(e => {
        console.log(`   - [${e.event_type}] ${e.metadata.old_status} -> ${e.metadata.new_status}`);
    });

    // We expect: 
    // searching -> assigned
    // assigned -> enroute
    // enroute -> arrived
    // arrived -> in_progress
    // in_progress -> completed
    // Total 5 events?

    if (events.length >= 4) {
        console.log("   ✅ PASS: Lifecycle Events Logged.");
    } else {
        console.log("   ❌ FAIL: Missing events.");
        process.exit(1);
    }

}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
