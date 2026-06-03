export class AppError extends Error {
  code: "AUTH_EXPIRED" | "SYSTEM_BUSY" | "SERVER_ERROR" | "NETWORK_FAILURE" | "UNKNOWN";
  originalError?: unknown;

  constructor(
    code: "AUTH_EXPIRED" | "SYSTEM_BUSY" | "SERVER_ERROR" | "NETWORK_FAILURE" | "UNKNOWN",
    message: string,
    originalError?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Wraps a Supabase edge function call with typed error handling.
 * Returns the parsed data on success, or throws an AppError with a user-friendly message.
 */
export async function secureApiCall<T>(
  supabase: any,
  functionName: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: payload ?? {},
    });

    if (error) {
      const status = error.status || 500;
      const message = error.message || "Something went wrong";

      if (status === 401 || status === 403) {
        throw new AppError("AUTH_EXPIRED", "Session expired. Please log in again.");
      }
      if (status === 429) {
        throw new AppError("SYSTEM_BUSY", "System is busy. Please try again.");
      }
      throw new AppError("SERVER_ERROR", message);
    }

    return data as T;
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (err instanceof TypeError && err.message === "Network request failed") {
      throw new AppError("NETWORK_FAILURE", "No internet connection. Please check your network.");
    }

    throw new AppError("UNKNOWN", "An unexpected error occurred. Please try again.");
  }
}

export async function secureCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err instanceof AppError) throw err;

    if (err?.status === 429 || err?.statusCode === 429) {
      throw new AppError("SYSTEM_BUSY", "Traffic is high right now. Please wait a moment and try again.");
    }
    if (err?.status === 401 || err?.statusCode === 401) {
      throw new AppError("AUTH_EXPIRED", "Your session has expired. Please log in again.");
    }
    if (err?.status === 403 || err?.statusCode === 403) {
      throw new AppError("AUTH_EXPIRED", "You don't have permission for this action.");
    }
    if (err instanceof SyntaxError || err?.message?.includes("JSON")) {
      throw new AppError("SERVER_ERROR", "The server returned an unexpected response. Please try again.");
    }
    if (err?.message?.includes("Network") || err?.message?.includes("fetch")) {
      throw new AppError("NETWORK_FAILURE", "Connection lost. Check your internet and try again.");
    }

    throw new AppError("UNKNOWN", err?.message || "Something went wrong. Please try again.", err);
  }
}
