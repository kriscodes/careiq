import { apiRequestUrl } from "../web-config";
import { translate, type RetryHint } from "../../../../../packages/i18n";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryHint: RetryHint = "read") {
    super(message);
    this.name = "ApiError";
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string } };
type ApiRequestOptions = RequestInit & { timeoutMs?: number };

export async function apiRequest<T>(path: string, token: string, options: ApiRequestOptions = {}): Promise<T> {
  let destination: string;
  try { destination = apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, path); }
  catch { throw new ApiError(0, "CONFIGURATION_ERROR", translate("en", "common.error.unavailable")); }
  const { timeoutMs = 30_000, signal, ...requestOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const saving = !["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase());
  const retryHint: RetryHint = saving ? new Headers(options.headers).has("Idempotency-Key") ? "idempotentWrite" : "write" : "read";
  const retryMessage = translate("en", `common.retry.${retryHint}`);

  try {
    signal?.throwIfAborted();
    const headers = new Headers(requestOptions.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    const response = await fetch(destination, {
      ...requestOptions,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (timedOut) throw new Error("Timed out while reading response");
    signal?.throwIfAborted();
    if (!body) throw new ApiError(response.status, "INVALID_RESPONSE", translate("en", "common.error.invalidResponse", { retry: retryMessage }), retryHint);
    if (!response.ok) {
      const error = (body as ApiErrorBody).error;
      throw new ApiError(response.status, error?.code ?? "REQUEST_FAILED", response.status >= 500 ? translate("en", "common.error.server", { retry: retryMessage }) : error?.message ?? translate("en", "common.error.server", { retry: "" }).trim(), retryHint);
    }
    return body as T;
  } catch (error) {
    if (timedOut) throw new ApiError(0, "REQUEST_TIMEOUT", translate("en", "common.error.timeout", { retry: retryMessage }), retryHint);
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK_ERROR", translate("en", "common.error.network", { retry: retryMessage }), retryHint);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
