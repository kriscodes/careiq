export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryHint?: "read" | "idempotentWrite" | "write") {
    super(message);
  }
}
export class ScopeChangedError extends Error {
  constructor() {
    super("Your active account or practice changed. Please try again.");
  }
}
function tokenWithCancellation(getToken: () => Promise<string | null>, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ScopeChangedError());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    // The provider call itself is not abortable. Detach its eventual result from this request.
    void Promise.resolve().then(getToken).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export type Api = <T>(path: string, options?: {
  method?: "GET" | "PUT" | "POST" | "PATCH";
  body?: unknown;
  binaryBody?: ArrayBuffer;
  binaryResponse?: boolean;
  envelope?: boolean;
  key?: string;
  ifMatch?: string;
  signal?: AbortSignal;
}) => Promise<T>;
// No response, bearer token, or clinical record is persisted or logged.
export function createApi({
  origin,
  getToken,
  getScope,
  register
}: {
  origin: string;
  getToken: () => Promise<string | null>;
  getScope: () => string;
  register: (controller: AbortController) => () => void;
}): Api {
  return async <T,>(path: string, options: Parameters<Api>[1] = {}) => {
    if (!path.startsWith("/api/v1/") || path.includes("..")) throw new Error("Invalid API route.");
    const retryHint = (options.method ?? "GET") === "GET" ? "read" : options.key ? "idempotentWrite" : "write";
    const scope = getScope();
    const controller = new AbortController();
    const unregister = register(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25000);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort);
    if (options.signal?.aborted) controller.abort();
    try {
      const token = await tokenWithCancellation(getToken, controller.signal);
      if (!token) throw new ApiError("UNAUTHENTICATED", 401, "Sign in again to continue.");
      if (scope !== getScope() || controller.signal.aborted) throw new ScopeChangedError();
      const response = await fetch(`${origin}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": options.binaryBody ? "application/octet-stream" : "application/json",
          ...(options.ifMatch ? { "If-Match": options.ifMatch } : {}),
          ...(options.key ? {
            "Idempotency-Key": options.key
          } : {})
        },
        ...(options.binaryBody ? { body: options.binaryBody } : options.body !== undefined ? {
          body: JSON.stringify(options.body)
        } : {}),
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (options.binaryResponse && response.ok) {
        const bytes = await response.arrayBuffer();
        if (scope !== getScope() || controller.signal.aborted) throw new ScopeChangedError();
        return bytes as T;
      }
      const payload = (await response.json().catch(() => {
        throw new ApiError("INVALID_RESPONSE", 503, "The service response could not be read. Please try again.");
      })) as {
        data?: T;
        error?: {
          code?: string;
          message?: string;
        };
      };
      if (scope !== getScope() || controller.signal.aborted) throw new ScopeChangedError();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError("INVALID_RESPONSE", 503, "The service response could not be read. Please try again.");
      if (!response.ok) throw new ApiError(payload.error?.code ?? "API_UNAVAILABLE", response.status, payload.error?.message ?? "Unable to complete this request. Please try again.");
      if (!("data" in payload)) throw new ApiError("INVALID_RESPONSE", 503, "The service response could not be read. Please try again.");
      return (options.envelope ? payload : payload.data) as T;
    } catch (error) {
      if (timedOut) throw new ApiError("REQUEST_TIMEOUT", 408, "", retryHint);
      if (error instanceof ApiError) throw new ApiError(error.code,error.status,error.message,error.retryHint ?? retryHint);
      if (error instanceof TypeError || error instanceof Error && error.name === "AbortError") throw new ApiError("NETWORK_ERROR",0,"",retryHint);
      throw error;
    } finally {
      clearTimeout(timeout);
      unregister();
      options.signal?.removeEventListener("abort", abort);
    }
  };
}
export function userMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof ScopeChangedError) return error.message;
  if (error && typeof error === "object" && "longMessage" in error && typeof error.longMessage === "string") return error.longMessage;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && !error.message.includes("fetch")) return error.message;
  return "We couldn’t connect. Check your connection and try again.";
}
