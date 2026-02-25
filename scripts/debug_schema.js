const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '../shared/env.ts');
const envContent = fs.readFileSync(envPath, 'utf8');
const urlMatch = envContent.match(/SUPABASE_URL: '([^']+)'/);
const keyMatch = envContent.match(/SUPABASE_ANON_KEY: '([^']+)'/);

const supabase = createClient(urlMatch[1], keyMatch[1]);

async function inspect() {
    console.log('--- Checking Drivers Table Columns ---');
    const { data: cols, error: colError } = await supabase
        .from('drivers')
        .select('*')
        .limit(1);

    if (colError) {
        console.log('Error selecting drivers:', colError);
        // Try getting column info via RPC if we had one, but we don't.
        // We can try to infer from error message? Use empty select?
    } else {
        if (cols.length > 0) {
            console.log('Sample driver keys:', Object.keys(cols[0]));
        } else {
            console.log('No drivers found, cannot infer columns from data.');
        }
    }

    console.log('\n--- Checking RLS Policies (Inferred) ---');
    // We can't query pg_policies easily with anon key.
    // But we can try to insert and see the error message details?
    // The previous error was: "new row violates row-level security policy for table "profiles""

    // Let's try to list columns using a trick if possible, or just trust the error.
    // The previous error said "Could not find the 'current_lat' column".

    // Let's try to upsert with different column names to see which works.

}

inspect();
