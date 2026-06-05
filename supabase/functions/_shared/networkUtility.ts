// supabase/functions/_shared/networkUtility.ts
// Production fetch wrapper with strict timeout enforcement.
// Prevents hung external APIs from exhausting edge function worker slots.

export interface SecureFetchOptions extends RequestInit {
    timeoutMs?: number;
}

/**
 * Executes a fetch with a hard timeout. If the response exceeds the deadline,
 * the AbortController terminates the connection and a clear TimeoutError is thrown.
 *
 * Defaults:
 *   - External API calls: 10 seconds
 *   - AI provider calls (Groq/Gemini): 15 seconds
 *   - Internal Supabase RPC calls: 8 seconds
 */
export async function secureFetch(
    url: string,
    options: SecureFetchOptions = {}
): Promise<Response> {
    const { timeoutMs = 10000, ...restOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...restOptions,
            signal: controller.signal,
        });
        return response;
    } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(
                `Request to "${typeof url === 'string' ? url.substring(0, 80) : 'unknown'}...` +
                `" timed out after ${timeoutMs}ms`
            );
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Convenience wrapper for AI provider calls with a longer default timeout.
 */
export async function aiFetch(
    url: string,
    options: SecureFetchOptions = {}
): Promise<Response> {
    return secureFetch(url, { ...options, timeoutMs: options.timeoutMs ?? 15000 });
}

/**
 * Convenience wrapper for internal Supabase function-to-function calls.
 */
export async function internalFetch(
    url: string,
    options: SecureFetchOptions = {}
): Promise<Response> {
    return secureFetch(url, { ...options, timeoutMs: options.timeoutMs ?? 8000 });
}
