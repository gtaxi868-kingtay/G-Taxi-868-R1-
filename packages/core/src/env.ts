// Environment configuration
// All keys are consumed from platform-specific env variables:
//   - Expo (mobile): process.env.EXPO_PUBLIC_*
//   - Vite (web):    import.meta.env.VITE_*
// No hardcoded keys in source code.

// Detect the runtime platform to pick the correct env prefix
function getEnvVar(key: string): string {
    // Expo React Native — process.env is available
    if (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SUPABASE_URL) {
        const expoKey = `EXPO_PUBLIC_${key}`;
        return (process.env as Record<string, string | undefined>)[expoKey] || '';
    }

    // Vite web — import.meta.env is available at build time
    if (typeof (globalThis as any).import?.meta?.env !== 'undefined') {
        const viteKey = `VITE_${key}`;
        return ((globalThis as any).import.meta.env as Record<string, string | undefined>)[viteKey] || '';
    }

    // Fallback for SSR / test environments
    return '';
}

export const ENV = {
    SUPABASE_URL: getEnvVar('SUPABASE_URL'),
    SUPABASE_ANON_KEY: getEnvVar('SUPABASE_ANON_KEY'),
    MAPBOX_PUBLIC_TOKEN: getEnvVar('MAPBOX_ACCESS_TOKEN') || getEnvVar('MAPBOX_PUBLIC_TOKEN'),
    STRIPE_PUBLISHABLE_KEY: getEnvVar('STRIPE_PUBLISHABLE_KEY'),
    GEMINI_API_KEY: getEnvVar('GEMINI_API_KEY'),
    GROQ_API_KEY: getEnvVar('GROQ_API_KEY'),
    SENTRY_DSN: getEnvVar('SENTRY_DSN'),
} as const;

// Trinidad & Tobago default location (Port of Spain)
export const DEFAULT_LOCATION = {
    latitude: 10.6549,
    longitude: -61.5019,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
} as const;
