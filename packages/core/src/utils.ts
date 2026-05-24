import { withRetry } from './retryWrapper';
import type { RetryOptions } from './retryWrapper';

/**
 * Robust helper for retrying idempotent operations with exponential backoff.
 * Aliased from retryWrapper for simplified architecture access.
 */
export async function callWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
) {
    return withRetry(operation, options);
}

/**
 * Formats a cent amount into a TTD dollar string.
 */
export function formatTTD(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}
