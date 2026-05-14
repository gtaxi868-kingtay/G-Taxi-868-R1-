import { z } from 'zod';

/**
 * Environment validation schema
 * All required env vars must be present and valid
 * Fail-fast on app boot
 */

const EnvironmentSchema = z.object({
  // Supabase (required for all apps)
  EXPO_PUBLIC_SUPABASE_URL: z
    .string()
    .url('Invalid Supabase URL')
    .describe('Supabase project URL'),
  
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'Supabase anon key required')
    .describe('Supabase public (anon) key'),

  // Maps
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: z
    .string()
    .min(1, 'Mapbox token required')
    .optional()
    .describe('Mapbox API token (optional)'),

  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: z
    .string()
    .min(1, 'Google Maps API key required')
    .optional()
    .describe('Google Maps API key (optional)'),

  // Payments (optional for now)
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .optional()
    .describe('Stripe publishable key (not in use yet)'),

  // Monitoring
  EXPO_PUBLIC_SENTRY_DSN: z
    .string()
    .url('Invalid Sentry DSN')
    .optional()
    .describe('Sentry error tracking DSN (optional)'),

  // App mode
  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development')
    .describe('App environment'),

  // Debug mode
  DEBUG: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1')
    .default('false')
    .describe('Enable debug logging'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Load and validate environment variables
 * Throws detailed error if validation fails
 */
export function loadEnv(): Environment {
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key.startsWith('EXPO_PUBLIC_') ||
        key.startsWith('VITE_') ||
        ['NODE_ENV', 'DEBUG'].includes(key)
    )
  );

  try {
    return EnvironmentSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n  ');
      throw new Error(
        `Environment validation failed:\n  ${issues}\n\nCheck your .env file and ensure all required variables are set.`
      );
    }
    throw error;
  }
}

/**
 * Type-safe environment access
 * Use this in your app instead of process.env
 */
export let env: Environment;

/**
 * Initialize environment (call once at app boot)
 */
export function initializeEnv(overrides?: Partial<Environment>): Environment {
  const base = loadEnv();
  env = { ...base, ...overrides };
  return env;
}

/**
 * Get validated env (must call initializeEnv first)
 */
export function getEnv(): Environment {
  if (!env) {
    throw new Error(
      'Environment not initialized. Call initializeEnv() in your app boot sequence.'
    );
  }
  return env;
}

/**
 * Validate a single env var
 */
export function validateEnvVar(key: string, value: string | undefined): boolean {
  try {
    // Use 'as any' to allow dynamic key pick at runtime (TypeScript typing limitation)
    EnvironmentSchema.pick({ [key]: true } as any).parse({ [key]: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Export the schema for other validation needs
 */
export { EnvironmentSchema, z };
