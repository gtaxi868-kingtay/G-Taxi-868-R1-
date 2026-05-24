// Environment configuration
// All keys are consumed from platform-specific env variables:
//   - Expo (mobile): process.env.EXPO_PUBLIC_*
//   - Vite (web):    import.meta.env.VITE_*
// No hardcoded keys in source code.
//
// IMPORTANT: Every EXPO_PUBLIC_* must be a DIRECT property access on
// process.env (e.g. process.env.EXPO_PUBLIC_SUPABASE_URL) so that Metro's
// DefinePlugin can replace it with the string literal at BUILD time.
// Computed/dynamic accesses (e.g. process.env["EXPO_PUBLIC_" + key])
// are NOT replaced and will be undefined at runtime in React Native.

export const ENV = {
    SUPABASE_URL:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SUPABASE_URL
            ? process.env.EXPO_PUBLIC_SUPABASE_URL
            : typeof (globalThis as any).import?.meta?.env?.VITE_SUPABASE_URL !== 'undefined'
            ? (globalThis as any).import.meta.env.VITE_SUPABASE_URL
            : '',
    SUPABASE_ANON_KEY:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
            ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
            : typeof (globalThis as any).import?.meta?.env?.VITE_SUPABASE_ANON_KEY !== 'undefined'
            ? (globalThis as any).import.meta.env.VITE_SUPABASE_ANON_KEY
            : '',
    MAPBOX_PUBLIC_TOKEN:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
            ? process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
            : typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN
            ? process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN
            : '',
    STRIPE_PUBLISHABLE_KEY:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
            ? process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
            : '',
    GEMINI_API_KEY:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_GEMINI_API_KEY
            ? process.env.EXPO_PUBLIC_GEMINI_API_KEY
            : '',
    GROQ_API_KEY:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_GROQ_API_KEY
            ? process.env.EXPO_PUBLIC_GROQ_API_KEY
            : '',
    SENTRY_DSN:
        typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SENTRY_DSN
            ? process.env.EXPO_PUBLIC_SENTRY_DSN
            : '',
} as const;

// Trinidad & Tobago default location (Port of Spain)
export const DEFAULT_LOCATION = {
    latitude: 10.6549,
    longitude: -61.5019,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
} as const;
