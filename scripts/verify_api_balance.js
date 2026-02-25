const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    console.log('🧪 Verifying Frontend API: getWalletBalance...');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 1. Sign In (Simulate User)
    // Use the wallet user created in previous test
    const email = 'wallet-test-1771173665170@test.com'; // From Step 2068 Output
    const password = 'password';

    const { data: { session }, error: authError } = await client.auth.signInWithPassword({
        email,
        password
    });

    if (authError) {
        // If user not found (cleanup?), create temp one
        console.log('User not found, creating temp...');
        const email2 = `balance-test-${Date.now()}@test.com`;
        const { data: { session: s2 }, error: e2 } = await client.auth.signUp({
            email: email2,
            password: 'password'
        });
        if (e2) throw e2;
        console.log('   ✅ Temp User Created');
        await checkBalance(client, s2.user.id);
        return;
    }

    console.log('   ✅ User Authenticated');
    await checkBalance(client, session.user.id);
}

async function checkBalance(client, userId) {
    const { data, error } = await client.rpc('get_wallet_balance', {
        p_user_id: userId
    });

    if (error) {
        console.error('❌ RPC Failed:', error);
        process.exit(1);
    }

    console.log(`   💰 Balance: $${data}`);
    console.log('✅ API Verification Passed');
}

main().catch(err => {
    console.error('Unexpected Error:', err);
    process.exit(1);
});
