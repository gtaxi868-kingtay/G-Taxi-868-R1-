const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 DEBUGGING DB PERMISSIONS...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Call a raw query function if available, or use the 'rpc' to call a built-in if we can...
    // But we probably can't run raw SQL easily without a specific RPC or direct connection.
    // Supabase JS client doesn't support raw SQL unless we have a function for it.

    // HOWEVER, we can query "information_schema" via standard .from()
    // BUT information_schema doesn't show function permissions easily (routines doesn't show ACL).
    // pg_catalog tables usually aren't exposed to the API.

    // Let's try to just call it again with verbose error to be sure.
    // Actually, let's try to CALL 'admin_top_up' with an invalid UUID just to see if it even REACHES the function logic (param error) vs permission error.

    console.log('1. Testing Admin RPC Reachability...');
    const { error } = await admin.rpc('admin_top_up', {
        p_user_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 100
    });

    if (error) {
        console.error('   Error Code:', error.code);
        console.error('   Error Msg:', error.message);
        console.error('   Error Header:', error.hint || 'No Hint');
    } else {
        console.log('   ✅ Reachable (Success or no error returned)');
    }

}

main();
