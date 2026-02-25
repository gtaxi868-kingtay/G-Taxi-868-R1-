const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkzNzk4MCwiZXhwIjoyMDg2NTEzOTgwfQ.oHfsVBjGi1RpG1r0r_lVzbPLreIat6J1lZVPr6DJEg0';

async function main() {
    console.log('🔍 Checking payment_ledger schema...');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await admin
        .from('payment_ledger')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Success. Data sample:', data);
        if (data.length === 0) console.log('Table is empty, but query worked (cols exist).');
    }
}

main();
