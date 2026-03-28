/**
 * callWithRetry.ts
 * Shared utility for critical edge functions (accept_ride, complete_ride)
 */
export async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      console.warn(`Attempt ${attempt + 1} failed, retrying in 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}
