export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    backoffFactor?: number;
}

export async function withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
): Promise<{ success: boolean; data: T | null; error: Error | null }> {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        backoffFactor = 2
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await operation();
            return { success: true, data: result, error: null };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(`[RetryWrapper] Attempt ${attempt + 1} failed: ${lastError.message}`);

            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(backoffFactor, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    return { success: false, data: null, error: lastError };
}

// Fetch wrapper compatible with existing API patterns
interface ApiResponse<T> {
    success: boolean;
    data: T | null;
    error: string | null;
}

export async function fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    retryOptions: RetryOptions = {}
): Promise<ApiResponse<T>> {
    const result = await withRetry(async () => {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }, retryOptions);

    if (result.success && result.data) {
        // Handle Edge Function standard response wrapper if present
        const data = result.data as any;
        if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
            // It's already wrapped
            return data as ApiResponse<T>;
        }
        return { success: true, data: result.data, error: null };
    }

    return {
        success: false,
        data: null,
        error: result.error?.message || 'Network request failed'
    };
}
