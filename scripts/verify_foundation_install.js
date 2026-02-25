const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 VERIFYING SAFE PAYMENT FOUNDATION...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // 1. Verify Columns Exist (by running the query)
        console.log('   Running Verification Query...');
        const { data, error } = await admin
            .from('rides')
            .select('status, payment_method, payment_status, cash_confirmed, wallet_used, coins_used, ledger_recorded')
            .limit(5);

        if (error) {
            console.error('   ❌ Query Failed:', error.message);
            console.log('   (Did you apply the migration?)');
        } else {
            console.log('   ✅ Query Successful (Columns Exist).');
            console.table(data);
        }

        // 2. Verify Triggers (via RPC if possible, or just assume from query success if logic holds, but we can check pg_trigger if allowed)
        // We will just report columns for now as per Step 8.

    } catch (err) {
        console.error('Unexpected Error:', err);
    }
}

main();
