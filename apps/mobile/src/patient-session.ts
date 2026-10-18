/** Restricted link initialization is independent of the signed-in staff account. */
export function patientLinkToken(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); const token = new URLSearchParams(url.hash.slice(1)).get("token") ?? url.searchParams.get("token"); if (token && !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("invalid"); return token; }
  catch { throw new Error("This secure link is unavailable. Contact your care team for a new link."); }
}
export function createPatientSessionInitializer<T>(exchange: (token: string) => Promise<unknown>, request: (signal?: AbortSignal) => Promise<T>) {
  let token: string | null = null;
  let exchangePromise: Promise<unknown> | null = null;
  return async (url: string | null, getInitialURL: () => Promise<string | null>, signal?: AbortSignal): Promise<T> => {
    const initial = url ?? await getInitialURL(); signal?.throwIfAborted(); const next = patientLinkToken(initial);
    if (next && next !== token) { token = next; const earlier = exchangePromise; exchangePromise = (earlier ? earlier.catch(() => undefined) : Promise.resolve()).then(() => exchange(next)); }
    if (exchangePromise) await exchangePromise;
    signal?.throwIfAborted();
    return request(signal);
  };
}
