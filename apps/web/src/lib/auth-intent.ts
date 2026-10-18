import { safeDestination } from "./access-flow";

const key = "careiq.account-return";
/** Store only a whitelisted route hint for a provider-owned required account step. */
export function rememberAuthDestination(destination: string) {
  try {
    const safe = safeDestination(destination);
    if (safe === "/") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, safe);
  } catch { /* Required task URLs also carry this hint when storage is unavailable. */ }
}
export function readAuthDestination(value?: string) {
  try {
    const destination = safeDestination(value || sessionStorage.getItem(key));
    return destination;
  } catch { return safeDestination(value); }
}
export function clearAuthDestination() { try { sessionStorage.removeItem(key); } catch { /* A route hint is optional. */ } }
export function sessionTaskDestination(destination: string) {
  return `/session-tasks?returnTo=${encodeURIComponent(safeDestination(destination))}`;
}
/** A signed-out account handoff retains Clerk's ticket, never an arbitrary redirect. */
export function invitationContinuationUrl(value: string) {
  const incoming = new URL(value);
  const url = new URL(incoming.pathname === "/join" ? "/join" : "/", incoming.origin);
  const ticket = incoming.searchParams.get("__clerk_ticket");
  const status = incoming.searchParams.get("__clerk_status");
  if (ticket) url.searchParams.set("__clerk_ticket", ticket);
  if (status && ["sign_in", "sign_up", "complete"].includes(status)) url.searchParams.set("__clerk_status", status);
  return url.href;
}
