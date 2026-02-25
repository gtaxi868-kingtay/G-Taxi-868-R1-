/**
 * DEEP PROBE — Raw HTTP calls to Edge Functions
 * Captures exact HTTP status codes and response bodies
 * that the Supabase JS client obscures.
 */

const SUPABASE_URL = 'https://kdatihgcxrosuwcqtjsi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYXRpaGdjeHJvc3V3Y3F0anNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyOTMxNzMsImV4cCI6MjA4NDg2OTE3M30.dQ6Fm4DrKdkWHPlMGr82fPr6mWtzRVYkJ8SnLnDrTLQ';

async function probe(name, body) {
    const url = `${SUPABASE_URL}/functions/v1/${name}`;
    const start = Date.now();
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(body)
        });
        const elapsed = Date.now() - start;
        const text = await resp.text();
        let json;
        try { json = JSON.parse(text); } catch { json = null; }

        const status = json ? (json.success ? '✅' : '⚠️') : '❌';
        console.log(`\n${status} ${name} — HTTP ${resp.status} (${elapsed}ms)`);
        console.log(`   Response: ${text.slice(0, 500)}`);
        return { name, httpStatus: resp.status, elapsed, data: json, raw: text };
    } catch (e) {
        console.log(`\n❌ ${name} — EXCEPTION: ${e.message}`);
        return { name, error: e.message };
    }
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║       DEEP EDGE FUNCTION PROBE (Raw HTTP)             ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // 1. estimate_fare — should work, no auth needed
    await probe('estimate_fare', {
        pickup_lat: 10.6549, pickup_lng: -61.5019,
        dropoff_lat: 10.6700, dropoff_lng: -61.5200,
        vehicle_type: 'Standard'
    });

    // 2. geocode — should work, no auth needed
    await probe('geocode', { query: 'Queens Park', limit: 3 });

    // 3. create_ride — no real JWT, just anon key
    const createResult = await probe('create_ride', {
        pickup_lat: 10.6549, pickup_lng: -61.5019,
        pickup_address: 'Deep Probe Pickup',
        dropoff_lat: 10.6700, dropoff_lng: -61.5200,
        dropoff_address: 'Deep Probe Dest',
        vehicle_type: 'Standard',
        payment_method: 'cash'
    });

    // 4. get_active_ride — anon key only
    await probe('get_active_ride', {});

    // 5. match_driver — with fake ride_id
    await probe('match_driver', { ride_id: '00000000-0000-0000-0000-000000000000' });

    // 6. accept_ride — no auth
    await probe('accept_ride', { ride_id: '00000000-0000-0000-0000-000000000000', driver_id: '00000000-0000-0000-0000-000000000000' });

    // 7. update_driver_location — spoofed
    await probe('update_driver_location', { driver_id: '00000000-0000-0000-0000-000000000000', lat: 10.65, lng: -61.50 });

    // 8. cancel_ride — no auth
    await probe('cancel_ride', { ride_id: '00000000-0000-0000-0000-000000000000' });

    // 9. complete_ride — no auth
    await probe('complete_ride', { ride_id: '00000000-0000-0000-0000-000000000000' });

    // 10. If create_ride succeeded, try to clean up
    if (createResult?.data?.success && createResult.data.data?.ride_id) {
        console.log('\n🧹 Cleaning up test ride...');
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        await supabase.from('rides').update({ status: 'cancelled' }).eq('id', createResult.data.data.ride_id);
        console.log(`   Cancelled ride ${createResult.data.data.ride_id}`);
    }

    // 11. Pricing multiplier verification
    console.log('\n\n═══ PRICING MULTIPLIER TEST ═══\n');
    const std = await probe('estimate_fare', { pickup_lat: 10.6549, pickup_lng: -61.5019, dropoff_lat: 10.6700, dropoff_lng: -61.5200, vehicle_type: 'Standard' });
    const xl = await probe('estimate_fare', { pickup_lat: 10.6549, pickup_lng: -61.5019, dropoff_lat: 10.6700, dropoff_lng: -61.5200, vehicle_type: 'XL' });
    const prem = await probe('estimate_fare', { pickup_lat: 10.6549, pickup_lng: -61.5019, dropoff_lat: 10.6700, dropoff_lng: -61.5200, vehicle_type: 'Premium' });

    if (std?.data?.data && xl?.data?.data && prem?.data?.data) {
        const stdFare = std.data.data.estimated_fare_cents;
        const xlFare = xl.data.data.estimated_fare_cents;
        const premFare = prem.data.data.estimated_fare_cents;
        console.log(`\n   Standard: $${(stdFare / 100).toFixed(2)}`);
        console.log(`   XL:       $${(xlFare / 100).toFixed(2)} (ratio: ${(xlFare / stdFare).toFixed(3)}, expected 1.500)`);
        console.log(`   Premium:  $${(premFare / 100).toFixed(2)} (ratio: ${(premFare / stdFare).toFixed(3)}, expected 2.000)`);
        console.log(`   XL multiplier: ${Math.abs(xlFare / stdFare - 1.5) < 0.01 ? '✅ CORRECT' : '❌ WRONG'}`);
        console.log(`   Premium multiplier: ${Math.abs(premFare / stdFare - 2.0) < 0.01 ? '✅ CORRECT' : '❌ WRONG'}`);
    }

    // 12. Database state check for tables
    console.log('\n\n═══ TABLE EXISTENCE TEST ═══\n');
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const tables = ['drivers', 'rides', 'profiles', 'locations', 'saved_places', 'user_preferences',
        'notification_settings', 'events', 'ride_offers', 'ride_ratings', 'driver_earnings',
        'driver_locations', 'blocked_users', 'rider_reports', 'user_xp'];

    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (error) {
            console.log(`   ❌ ${table}: ${error.message}`);
        } else {
            console.log(`   ✅ ${table}: accessible`);
        }
    }
}

main().catch(console.error);
