import assert from "node:assert/strict";
import test from "node:test";
import { invitationOrganizationHint, safeDestination } from "../src/lib/access-flow";
import { clearAuthDestination, invitationContinuationUrl, readAuthDestination, rememberAuthDestination, sessionTaskDestination } from "../src/lib/auth-intent";

test("join and verified-shape organization resume hints never accept arbitrary destinations or authority", () => {
  for (const safe of ["/join", "/join?accepted=1", "/join?confirm=org_abc123"]) assert.equal(safeDestination(safe), safe);
  for (const attack of ["/join?returnTo=https://other.invalid", "/join?confirm=org_a&role=org:admin", "/join?confirm=org_a#extra", "/join?confirm=org_a/..", "/join?__clerk_ticket=secret", "/join?confirm=practice_123", "/join?accepted=1&redirect_url=//other.invalid"]) assert.equal(safeDestination(attack), "/");
  assert.equal(invitationOrganizationHint("org_abc123"), "org_abc123");
  assert.equal(invitationOrganizationHint("org_a&role=admin"), undefined);
  assert.equal(sessionTaskDestination("/join?confirm=org_a"), "/session-tasks?returnTo=%2Fjoin%3Fconfirm%3Dorg_a");
  assert.equal(sessionTaskDestination("//other.invalid"), "/session-tasks?returnTo=%2F");
});
test("account switching carries only the provider ticket and known status on the current origin", () => {
  assert.equal(invitationContinuationUrl("https://app.careiq.invalid/join?__clerk_ticket=synthetic&__clerk_status=sign_in&redirect_url=https://other.invalid&role=org:admin"), "https://app.careiq.invalid/join?__clerk_ticket=synthetic&__clerk_status=sign_in");
  assert.equal(invitationContinuationUrl("https://app.careiq.invalid/sign-in?__clerk_ticket=synthetic&__clerk_status=unknown#callback"), "https://app.careiq.invalid/?__clerk_ticket=synthetic");
});
test("provider-owned account steps persist only a constrained route hint, never a ticket or token", () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try {
    rememberAuthDestination("/join?confirm=org_abc");
    assert.equal(readAuthDestination(), "/join?confirm=org_abc");
    assert.equal(readAuthDestination(), "/join?confirm=org_abc"); // A required step reload preserves intent.
    assert.equal(readAuthDestination("/join"), "/join");
    clearAuthDestination();
    assert.equal(readAuthDestination(), "/");
    rememberAuthDestination("/join?__clerk_ticket=secret&token=secret");
    assert.equal(values.size, 0);
  } finally { if (previous) Object.defineProperty(globalThis, "sessionStorage", previous); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
