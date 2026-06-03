const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1); }

function decode(token) {
    try {
        const parts = token.split('.');
        const payload = JSON.parse(atob(parts[1]));
        return payload;
    } catch (e) {
        return null;
    }
}

// Node's atob polyfill if needed
if (typeof atob === 'undefined') {
    global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

const payload = decode(SUPABASE_SERVICE_ROLE_KEY);
console.log("Key Payload:", payload);
