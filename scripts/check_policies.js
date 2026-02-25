const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // We cannot query pg_policies via PostgREST easily unless exposed.
    // So we try a simpler test: 
    // Try to insert with Service Role. WE KNOW IT FAILS.

    // So let's try to verify if the TABLE exists and if we can SELECT.
    const { data, error } = await admin.from('wallet_transactions').select('*').limit(1);

    if (error) {
        console.log("SELECT Error:", error);
    } else {
        console.log("SELECT Success. Data:", data);
    }
}

main().catch(console.error);
