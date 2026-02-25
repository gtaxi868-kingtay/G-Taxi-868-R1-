const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appsDir = path.join(rootDir, 'apps');
const sharedDir = path.join(rootDir, 'shared');

const expectedFiles = [
    'apps/rider/App.tsx',
    'apps/rider/index.js',
    'apps/rider/package.json',
    'apps/rider/metro.config.js',
    'apps/rider/src/services/api.ts',

    'apps/driver/App.tsx',
    'apps/driver/index.js',
    'apps/driver/package.json',
    'apps/driver/metro.config.js',
    'apps/driver/src/services/api.ts',
    'apps/driver/src/services/realtime.ts',
    'apps/driver/src/context/AuthContext.tsx',

    'shared/supabase.ts',
    'shared/env.ts',
    'shared/retryWrapper.ts'
];

let errors = [];

console.log('Verifying Monorepo Structure...');

expectedFiles.forEach(file => {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) {
        errors.push(`Missing file: ${file}`);
    } else {
        console.log(`✅ Found ${file}`);
    }
});

// Verify shared import in Rider API
const riderApi = fs.readFileSync(path.join(rootDir, 'apps/rider/src/services/api.ts'), 'utf8');
if (!riderApi.includes('../../../../shared/supabase')) {
    errors.push('Rider API does not import shared supabase correctly');
}
if (!riderApi.includes('../../../../shared/retryWrapper')) {
    errors.push('Rider API does not import shared retryWrapper correctly');
}

// Verify shared import in Driver API
const driverApi = fs.readFileSync(path.join(rootDir, 'apps/driver/src/services/api.ts'), 'utf8');
if (!driverApi.includes('../../../../shared/supabase')) {
    errors.push('Driver API does not import shared supabase correctly');
}
if (!driverApi.includes('../../../../shared/retryWrapper')) {
    errors.push('Driver API does not import shared retryWrapper correctly');
}

if (errors.length > 0) {
    console.error('❌ Verification Failed:');
    errors.forEach(e => console.error(`- ${e}`));
    process.exit(1);
} else {
    console.log('✅ Monorepo Integrity Verified!');
}
