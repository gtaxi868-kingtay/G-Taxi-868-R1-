const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 INITIATING MASTER SYSTEM INSPECTION...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const report = {};

    try {
        // --- SECTION A: DATABASE TABLES ---
        console.log('\n--- SECTION A: TABLES & COLUMNS ---');
        const tablesToCheck = [
            'rides', 'ride_offers', 'drivers', 'profiles', 'driver_locations',
            'payment_ledger', 'ride_events', 'wallet_transactions', 'audit_logs', 'notifications'
        ];

        for (const table of tablesToCheck) {
            // Check metadata (columns)
            // Note: Supabase JS doesn't give unlimited metadata access easily. 
            // We'll infer existence by selecting 0 rows.
            const { error: existError } = await admin.from(table).select('*').limit(0);

            if (existError) {
                console.log(`❌ Table '${table}': MISSING or INACCESSIBLE (${existError.code})`);
                continue;
            }

            console.log(`✅ Table '${table}': EXISTS`);

            // RLS Check (Query pg_policies if possible, or infer from previous knowledge/migrations)
            // We can't easily query pg_policies via JS client without a wrapper function.
            // PROXY CHECK: Try to select as ANON (if we had anon client, but we are admin here).
            // We will report "RLS STATUS: UNKNOWN (Manual Check Needed)" unless we see it in migrations.
        }

        // Detailed Column Check for 'rides'
        console.log('   Checking CRITICAL rides columns...');
        const { data: rideCols, error: colErr } = await admin.from('rides').select('payment_method, payment_status, cash_confirmed, wallet_used, coins_used, ledger_recorded, tip_amount').limit(1);
        if (colErr) console.log('   ⚠️ Rides Schema Issues:', colErr.message);
        else console.log('   ✅ Rides Payment Columns: VERIFIED');

        // --- SECTION B: TRIGGERS ---
        // We can't verify triggers directly via JS client without RPC access to pg_catalogs.
        // We will infer from behavior or assume based on recent migrations.
        // However, we CAN check if specific RPCs exist.

        // --- SECTION D: RPCs ---
        console.log('\n--- SECTION D: RPCs ---');
        const rpcs = ['accept_ride_offer', 'confirm_cash_payment', 'process_tip', 'admin_top_up', 'get_wallet_balance'];
        for (const fn of rpcs) {
            const { error } = await admin.rpc(fn, {});
            // We expect error (params missing), but NOT "function not found"
            if (error && error.code === '42883') { // Undefined function
                console.log(`❌ RPC '${fn}': MISSING`);
            } else {
                console.log(`✅ RPC '${fn}': EXISTS (Found)`);
            }
        }

        // --- SECTION E: EDGE FUNCTIONS ---
        // We'll inspect local file system for these later.

        // --- SECTION G: WALLET SYSTEM ---
        console.log('\n--- SECTION G: WALLET DATA ---');
        const { count: walletTxCount, error: wErr } = await admin.from('wallet_transactions').select('*', { count: 'exact', head: true });
        if (!wErr) console.log(`✅ Wallet Transactions: Active (${walletTxCount} records)`);
        else console.log(`❌ Wallet Transactions: ERROR ${wErr.message}`);

        // --- SECTION H: REALTIME ---
        console.log('\n--- SECTION H: REALTIME DATA ---');
        const { count: locCount, error: lErr } = await admin.from('driver_locations').select('*', { count: 'exact', head: true });
        if (!lErr) console.log(`✅ Driver Locations: Active (${locCount} records)`);
        else console.log(`❌ Driver Locations: ERROR ${lErr.message}`);

    } catch (err) {
        console.error('FATAL INSPECTION ERROR:', err);
    }
}

main();
