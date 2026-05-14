import { type Environment, getEnv } from '@gtaxi/config';

/**
 * Shared bootstrap for all G-Taxi apps
 * Initializes logging, error handling, and core services
 */

export interface BootstrapOptions {
  env: Environment;
  telemetry?: boolean;
  logging?: 'structured' | 'simple' | 'none';
  errorBoundaries?: boolean;
  enableDevTools?: boolean;
}

// Global bootstrap state
let initialized = false;
let options: BootstrapOptions;

/**
 * Initialize shared bootstrap services
 * Call this once at app startup, before rendering
 */
export async function bootstrapApp(opts: BootstrapOptions): Promise<void> {
  if (initialized) {
    console.warn('[bootstrap] Already initialized, skipping');
    return;
  }

  options = opts;

  // 1. Initialize logger
  if (opts.logging && opts.logging !== 'none') {
    initializeLogger(opts.logging);
  }

  // 2. Initialize error handling
  if (opts.errorBoundaries) {
    initializeErrorHandling();
  }

  // 3. Initialize telemetry (Sentry)
  if (opts.telemetry && opts.env.EXPO_PUBLIC_SENTRY_DSN) {
    initializeTelemetry(opts.env);
  }

  // 4. Log startup
  log('info', '[bootstrap] App initialized', {
    env: opts.env.NODE_ENV,
    telemetry: opts.telemetry,
  });

  initialized = true;
}

/**
 * Initialize structured logging
 */
function initializeLogger(style: 'structured' | 'simple'): void {
  globalThis.gtaxiLog = (level: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);

    if (style === 'structured') {
      // JSON structured logs
      console.log(JSON.stringify(
        { timestamp, level, message, data },
        null,
        2
      ));
    } else {
      // Simple text logs
      console.log(`[${timestamp}] ${levelUpper} ${message}`, data || '');
    }
  };

  log('info', '[logger] Initialized', { style });
}

/**
 * Initialize error handling
 */
function initializeErrorHandling(): void {
  // Capture unhandled errors
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      log('error', 'Uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      log('error', 'Unhandled promise rejection', {
        reason: event.reason,
      });
    });
  }

  log('info', '[error-handler] Initialized');
}

/**
 * Initialize Sentry for telemetry
 */
function initializeTelemetry(env: Environment): void {
  if (!env.EXPO_PUBLIC_SENTRY_DSN) {
    log('warn', '[telemetry] Sentry DSN not provided, skipping');
    return;
  }

  // Defer Sentry initialization to avoid circular deps
  log('info', '[telemetry] Sentry will initialize on demand');
}

/**
 * Structured logging function
 */
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: any
): void {
  if (globalThis.gtaxiLog) {
    globalThis.gtaxiLog(level, message, data);
  } else {
    // Fallback to console
    (console as any)[level](message, data || '');
  }
}

/**
 * Check if bootstrap is initialized
 */
export function isBootstrapped(): boolean {
  return initialized;
}

/**
 * Get current bootstrap options (if initialized)
 */
export function getBootstrapOptions(): BootstrapOptions | null {
  return initialized ? options : null;
}

/**
 * Get current environment (requires bootstrap to be initialized)
 */
export function getBootstrapEnv(): Environment {
  if (!initialized) {
    throw new Error('[bootstrap] Not initialized. Call bootstrapApp() first.');
  }
  return getEnv();
}

/**
 * Declare global bootstrap logger
 */
declare global {
  var gtaxiLog: (level: string, message: string, data?: any) => void;
}

export {};
