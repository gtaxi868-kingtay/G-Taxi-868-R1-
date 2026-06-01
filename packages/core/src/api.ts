export class AppError extends Error {
  constructor(
    public code: "AUTH_EXPIRED" | "SYSTEM_BUSY" | "SERVER_ERROR" | "NETWORK_FAILURE" | "UNKNOWN",
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export async function secureApiCall<T>(fn: () => Promise<T>): Promise<T> {
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
