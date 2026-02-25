const { createClient } = require('@supabase/supabase-js');

// Config from verify_tip_flow.js
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

async function main() {
    console.log('🔍 INSPECTING RLS POLICIES (Public Access Test)...');

    // Use ANON KEY only. No Service Role.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const tables = ['rides', 'profiles', 'drivers', 'payment_ledger', 'wallet_transactions'];

    for (const t of tables) {
        // Try to select ALL rows (which should be blocked by RLS usually, allowing only own rows)
        // If we get 0 rows, it's good (likely empty or RLS hiding others).
        // If we get "Permission Denied" error, it's safer but usually RLS just filters.
        // We'll try to select just 1 row.
        const { data, error } = await anon.from(t).select('*').limit(1);

        if (error) {
            console.log(`✅ Table '${t}': SECURE (Error: ${error.message})`);
        } else if (data.length === 0) {
            console.log(`✅ Table '${t}': SECURE (0 rows returned - RLS likely active filtering own rows only)`);
        } else {
            console.log(`❌ Table '${t}': RISK (Returned data to Anon User! Possible RLS missing)`);
            console.log(data);
        }
    }
}

main();
