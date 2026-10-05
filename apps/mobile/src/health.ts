export async function checkHealth(
  origin: string,
  signal?: AbortSignal,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<"available"> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 10_000);
  try {
    // Public readiness probe only: never attach an auth token or cookies.
    const response = await (options.fetcher ?? fetch)(`${origin}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error();
    const body: unknown = await response.json();
    if (
      controller.signal.aborted ||
      !body ||
      typeof body !== "object" ||
      !("status" in body) ||
      body.status !== "ok" ||
      !("service" in body) ||
      body.service !== "careiq-api" ||
      !("database" in body) ||
      body.database !== "connected"
    )
      throw new Error();
    return "available";
  } catch {
    throw new Error(
      "Connection unavailable. Check the API address, network, and API/database service, then try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
