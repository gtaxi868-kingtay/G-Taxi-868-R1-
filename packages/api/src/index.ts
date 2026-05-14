import { type Environment } from '@gtaxi/config';
import { log } from '@gtaxi/bootstrap';

/**
 * Centralized API client for G-Taxi
 * Handles auth, errors, retries, timeouts
 */

export interface ApiRequestInit extends RequestInit {
  timeout?: number;
  retries?: number;
  skipAuth?: boolean;
  correlationId?: string;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
  correlationId?: string;
}

export interface ApiError extends Error {
  status: number;
  data?: any;
  correlationId?: string;
}

// Global API client state
let apiClient: ApiClient | null = null;

export class ApiClient {
  private baseUrl: string;
  private timeout: number = 30000;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string | null): void {
    this.authToken = token;
    log('debug', '[api] Auth token updated');
  }

  /**
   * Make an API request
   */
  async request<T>(
    path: string,
    init: ApiRequestInit = {}
  ): Promise<ApiResponse<T>> {
    const {
      timeout = this.timeout,
      retries = 3,
      skipAuth = false,
      correlationId = this.generateCorrelationId(),
      ...fetchInit
    } = init;

    const url = new URL(path, this.baseUrl).toString();
    const headers = this.buildHeaders(fetchInit.headers, skipAuth, correlationId);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        log('debug', `[api] ${fetchInit.method || 'GET'} ${path}`, {
          attempt: attempt + 1,
          correlationId,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            ...fetchInit,
            headers,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            lastError = this.createApiError(
              response.status,
              data,
              correlationId
            );

            // Don't retry on 4xx errors (client errors)
            if (response.status >= 400 && response.status < 500) {
              throw lastError;
            }

            // Will retry on 5xx
            if (attempt < retries - 1) {
              log('warn', `[api] Request failed, retrying...`, {
                status: response.status,
                attempt: attempt + 1,
              });
              await this.sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
              continue;
            }

            throw lastError;
          }

          const data = (await response.json()) as T;

          log('debug', `[api] Success`, {
            status: response.status,
            correlationId,
          });

          return {
            data,
            status: response.status,
            headers: Object.fromEntries(response.headers),
            correlationId,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          lastError = new Error('Network error');
        } else {
          lastError = error as Error;
        }

        if (attempt === retries - 1) {
          break;
        }

        log('warn', `[api] Request failed, retrying...`, {
          error: lastError.message,
          attempt: attempt + 1,
        });
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError || new Error('Request failed');
  }

  /**
   * GET request
   */
  async get<T>(path: string, init?: ApiRequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(
    path: string,
    body?: any,
    init?: ApiRequestInit
  ): Promise<ApiResponse<T>> {
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(
    path: string,
    body?: any,
    init?: ApiRequestInit
  ): Promise<ApiResponse<T>> {
    return this.request<T>(path, {
      ...init,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, init?: ApiRequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  // Private helpers

  private buildHeaders(
    headers?: HeadersInit,
    skipAuth?: boolean,
    correlationId?: string
  ): Record<string, string> {
    const result: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId || this.generateCorrelationId(),
    };

    if (this.authToken && !skipAuth) {
      result.Authorization = `Bearer ${this.authToken}`;
    }

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        result[key] = value;
      });
    } else if (headers) {
      Object.assign(result, headers);
    }

    return result;
  }

  private createApiError(
    status: number,
    data: any,
    correlationId: string
  ): ApiError {
    const error = new Error(
      data?.message || `API error: ${status}`
    ) as ApiError;
    error.status = status;
    error.data = data;
    error.correlationId = correlationId;
    return error;
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Initialize the API client
 */
export function initializeApi(env: Environment): ApiClient {
  if (!apiClient) {
    apiClient = new ApiClient(env.EXPO_PUBLIC_SUPABASE_URL);
    log('info', '[api] Client initialized', {
      baseUrl: env.EXPO_PUBLIC_SUPABASE_URL,
    });
  }
  return apiClient;
}

/**
 * Get the API client (must call initializeApi first)
 */
export function getApiClient(): ApiClient {
  if (!apiClient) {
    throw new Error('[api] Not initialized. Call initializeApi() first.');
  }
  return apiClient;
}

export type { ApiRequestInit, ApiResponse, ApiError };
