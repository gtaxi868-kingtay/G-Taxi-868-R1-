const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 SAFE PRECHECK: Payment Foundation');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // 1. Check Tables
        const tables = ['rides', 'payment_ledger', 'ride_events', 'wallet_transactions'];
        const foundTables = {};

        for (const t of tables) {
            const { error } = await admin.from(t).select('count', { count: 'exact', head: true });
            if (error && error.code === '42P01') { // Undefined table
                console.log(`   ❌ Table '${t}' NOT FOUND`);
                foundTables[t] = false;
            } else if (error) {
                console.error(`   ⚠️ Error checking '${t}':`, error.message);
                foundTables[t] = false;
            } else {
                console.log(`   ✅ Table '${t}' EXISTS`);
                foundTables[t] = true;
            }
        }

        // 2. Check Rides Columns
        if (foundTables['rides']) {
            console.log('   Checking rides columns...');
            const { data, error } = await admin
                .from('rides')
                .select('payment_method, payment_status, cash_confirmed, wallet_used, coins_used, ledger_recorded')
                .limit(1);

            if (error) {
                // If columns missing, error will verify which one
                console.log('   ℹ️ Column check result:', error.message);
                // "Could not find the 'payment_status' column..."
            } else {
                console.log('   ✅ All target columns already exist.');
            }
        }

        // Report
        console.log('--- REPORT ---');
        if (!foundTables['rides']) console.error('CRITICAL: rides table missing');
        if (!foundTables['payment_ledger']) console.error('WARNING: payment_ledger table missing (Instruction says it is existing locked table)');
        if (foundTables['wallet_transactions']) console.log('INFO: wallet_transactions exists (Alternative ledger?)');

    } catch (err) {
        console.error('Unexpected Error:', err);
    }
}

main();
