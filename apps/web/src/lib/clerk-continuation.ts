/** Keep Clerk’s authenticated request headers while continuing the exact same route.
 * An absolute self-rewrite can become an external proxy on a loopback-only Next server.
 */
export function normalizeClerkContinuation<T extends Response>(response: T, requestUrl: string): T {
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (response.status === 200 && !response.headers.has("location") && rewrite && new URL(rewrite, requestUrl).href === new URL(requestUrl).href) {
    response.headers.delete("x-middleware-rewrite");
    response.headers.set("x-middleware-next", "1");
  }
  return response;
}
