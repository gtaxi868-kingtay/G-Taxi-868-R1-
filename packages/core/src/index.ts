export * from './utils';
export * from './retryWrapper';
export * from './env';
export * from './supabase';
export * from './client';
export * from './realtime';
export * from './native';
export * from './nfcRouter';
// featureFlags.ts removed 2026-08-08. It was a SECOND flag resolver that
// disagreed with the server-side gate: it selected vertical_settings.vertical
// (the column is vertical_name), so that query always failed, grocery and
// laundry always fell back to `false`, and an admin switching them on would
// have had no effect. Nothing imported it. The single source of truth is
// get_rider_progress, which intersects what a rider earned with what the admin
// allows (vertical_settings.is_enabled + rollout_percentage) server-side.
export * from './contactConfig';
export { AppError, secureApiCall } from './api';
export * from './types/ride';
export * from './types/profile';
export * from './types/marketplace';
export * from './services/geofencing';
export * from './outbox';
export { installCrashReporter } from './CrashReporter';
