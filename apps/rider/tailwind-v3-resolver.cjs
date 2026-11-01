// NativeWind 4 only works with Tailwind CSS 3, but this monorepo also has
// Tailwind 4 (admin and merchant websites) hoisted to the root node_modules,
// and NativeWind (hoisted too) would find that one. This makes every
// `require('tailwindcss...')` made while building the rider app resolve to
// the rider's own Tailwind 3 (apps/rider/node_modules/tailwindcss).
// Loaded by metro.config.js and passed to child processes via NODE_OPTIONS.
const Module = require('module');

if (!Module._resolveFilename.__riderTailwindV3) {
    const original = Module._resolveFilename;
    const patched = function (request, parent, isMain, options) {
        if (request === 'tailwindcss' || request.startsWith('tailwindcss/')) {
            return original.call(this, request, parent, isMain, { ...(options || {}), paths: [__dirname] });
        }
        return original.call(this, request, parent, isMain, options);
    };
    patched.__riderTailwindV3 = true;
    Module._resolveFilename = patched;
}
