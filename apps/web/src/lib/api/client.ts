export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string } };
type ApiRequestOptions = RequestInit & { timeoutMs?: number };

export async function apiRequest<T>(path: string, token: string, options: ApiRequestOptions = {}): Promise<T> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not configured");
  const { timeoutMs = 30_000, signal, ...requestOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const saving = !["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase());
  const retryMessage = saving
    ? "The save may have completed. Retry without changing the details to avoid creating a duplicate."
    : "Please try again.";

  try {
    const headers = new Headers(requestOptions.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      ...requestOptions,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (timedOut) throw new Error("Timed out while reading response");
    if (!body) throw new ApiError(response.status, "INVALID_RESPONSE", `CareIQ returned an unexpected response. ${retryMessage}`);
    if (!response.ok) {
      const error = (body as ApiErrorBody).error;
      throw new ApiError(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "CareIQ could not complete this request.");
    }
    return body as T;
  } catch (error) {
    if (timedOut) throw new ApiError(0, "REQUEST_TIMEOUT", `The request timed out. ${retryMessage}`);
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK_ERROR", `Unable to reach CareIQ. ${retryMessage}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
