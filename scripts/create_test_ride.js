/**
 * create_test_ride.js
 * 
 * Simulates a Rider creating a ride request.
 * Useful for testing the Driver Bot's response.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 1. Create a Rider User (Ephemeral)
    const email = `rider-${Date.now()}@test.com`;
    const password = 'pass-secure-123';

    console.log(`\n👤 Creating Rider: ${email}`);
    const { data: auth, error: authError } = await supabase.auth.signUp({
        email,
        password,
    });

    if (authError) {
        console.error('❌ Sign up failed:', authError.message);
        process.exit(1);
    }

    // Auto-confirm if possible? No, signUp usually sends email.
    // But since we are using Supabase Cloud, we might need to use Admin to create user if email confirm is ON.
    // Let's try signIn immediately. If "Email not confirmed", we fail.
    // Actually, "simulate_active_driver.js" used Admin Client to create confirmed user.
    // Use Admin Client here too if we want to skip email confirmation.
    // BUT we don't have Service Role Key easily available here unless we hardcode it again.
    // We SHOULD hardcode it for this test script to ensure it works.

    // ... Refactoring to use Service Role for User Creation ...
}

// Relaunching with Service Role...
main_with_admin();

async function main_with_admin() {
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const email = `rider-${Date.now()}@test.com`;
    const password = 'pass-secure-123';

    console.log(`\n👤 Creating Rider (Confirmed): ${email}`);
    const { data: userDat, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (createError) {
        console.error('❌ User creation failed:', createError.message);
        process.exit(1);
    }

    const userId = userDat.user.id;
    console.log(`   ✅ Rider ID: ${userId}`);

    // Login to get Token
    const { data: login, error: loginError } = await anonClient.auth.signInWithPassword({
        email,
        password
    });

    if (loginError) {
        console.error('❌ Login failed:', loginError.message);
        process.exit(1);
    }

    const token = login.session.access_token;

    // Call create_ride Edge Function
    console.log('\n🚖 Requesting Ride...');
    const functionUrl = `${SUPABASE_URL}/functions/v1/create_ride`;

    try {
        const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pickup_lat: 10.655, // Port of Spain
                pickup_lng: -61.502,
                pickup_address: "Queen's Park Savannah",
                dropoff_lat: 10.660,
                dropoff_lng: -61.510,
                dropoff_address: "Emperor Valley Zoo",
                vehicle_type: "Standard"
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('❌ Function Error:', result);
        } else {
            console.log('   ✅ Ride Created!');
            console.log('   🆔 Ride ID:', result.data.ride_id);
            console.log('   💵 Fare: $' + (result.data.total_fare_cents / 100).toFixed(2));
            console.log('\n👉 Now run the BOT to accept this ride!');
        }

    } catch (e) {
        console.error('❌ Network Error:', e);
    }
}
