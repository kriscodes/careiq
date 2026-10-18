# Authentication lifecycle and control stability verification

Verified locally on October 17, 2026 against the canonical CareIQ checkout. No real account, patient record, provider configuration, or external account state was changed. Browser checks use new isolated Chrome contexts, reserved `.invalid` identifiers and blocked external traffic. These checks do not use the personal browser whose administrator policy prevented inspection.

## Findings and fixes

The installed Clerk hooks may expose loaded, signed-out authentication state supplied by the server while the browser SDK is still loading. The unloaded sign-in proxy waits for the SDK before sending an action, but its status property remains the unloaded value. CareIQ previously mounted the credential form based only on the authentication-state flag. A real installed-provider regression reproduced an actionable **Sign in** button before SDK readiness; it failed before the fix and passed afterward.

`AuthScreen` now mounts its form inside `ClerkLoaded`. `ClerkLoading` displays account-loading status; a ten-second slow-loading threshold and `ClerkFailed` provide localized, explicit manual retry. Credential inputs do not mount during those states. There is no automatic reload loop. Late SDK readiness can still open the form normally.

Both sign-in and sign-up SDK fetch status previously disabled the custom form, including passive requests for the inactive flow. Only deliberate actions now lock the form. The existing synchronous action lock continues to prevent double submission, and controls unlock after completion/failure. MFA, invitation account switching, sign-out and session-task rules remain in place.

The known `.next-forms-build` generated output directory is excluded from web source linting. No dependency, CSP, origin, cookie, token-storage or provider configuration was weakened or changed by this fix.

## Evidence

| Check | Result |
| --- | --- |
| Real installed Clerk provider with server-preloaded signed-out state and unloaded SDK | Passed after fix; failed baseline with one actionable sign-in button instead of zero |
| Failed/slow SDK load | No credential inputs; stable manual retry button; no automatic navigation across 90 sampled frames; deliberate retry reloads once |
| Stationary hover while passive sign-in/sign-up fetch status changes | Passed; enabled and pointer cursor across all 90 sampled frames, entered password retained, no unsolicited submission |
| Deliberate pending sign-in | Passed; controls disabled and exactly one request/finalization despite duplicate click attempts |
| Restored pending MFA | Passed; provider completion shown without password resubmission or automatic finalization |
| English/Spanish failure recovery | Passed; translated recovery message and enabled retry; no credential inputs |
| Final full web browser suite | 53 passed across four files, zero failures/skips/retries; 1.3m |
| Full web unit suite | 73 passed, zero failures/skips |
| Localization unit suite | 5 passed, zero failures/skips |
| Full web ESLint | Exit 0 after excluding generated forms-build output |
| Web TypeScript | Exit 0 |

The final complete browser run after isolated benchmark cleanup passed all 53 tests across four files in 1.3 minutes, with zero failures, skips or retries. It includes all seven previous affected authentication flows and all five new regressions. An earlier browser `beforeEach` setup timeout did not reproduce in the cleared window; no assertions or timeouts were weakened. Both synthetic real-provider screenshots were captured and visually inspected: white backgrounds, readable recovery text and manual retry controls, no clipping or horizontal overflow at the 390px mobile viewport. Exact totals, file hashes and limitations are retained in `web-browser-results.json`.

The real-provider fixture includes an explicit signed-out SSR state with null identifiers; the installed shared TypeScript declaration omits the null variant, so its test-only expectation is documented at that boundary. It imports the actual Clerk React runtime resolved from the active Next integration, rather than mock hooks.

Active resolved versions: Next 16.4.1, React/ReactDOM 19.2.8, Clerk Next 7.8.3, Clerk React 6.14.8, Clerk shared 4.30.2. Unused package-store copies are not treated as active dependencies.

## Final browser and capture instructions

From the repository root, use the pinned Node 22 executable and installed test CLI:

```sh
CAREIQ_CAPTURE_AUTH=1 PLAYWRIGHT_CHANNEL=chrome '/Users/kristian/Library/Application Support/Herd/config/nvm/versions/node/v22.23.2/bin/node' apps/web/node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts apps/web/tests/browser/components.spec.ts --grep 'real Clerk preloaded|custom sign-in|MFA failure|password recovery|password reset|signup verifies|session refresh|signed-in invitation' --reporter=line
```

The real-provider case saves synthetic-only `auth-sdk-unavailable-desktop.png` and `auth-sdk-unavailable-mobile.png` in this directory when `CAREIQ_CAPTURE_AUTH=1`. It verifies mobile horizontal fit. A complete component browser run may also use this flag.

Real successful Clerk sign-in, restored real sessions and delivery-provider acceptance still require the normal approved end-to-end environment. The public script/environment probe being healthy does not prove a real user session succeeds, and historical script failures are not evidence of a current provider outage.
