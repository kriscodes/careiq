# Web production readiness

The web app keeps the approved white/sage authentication and three-step practice setup. Production builds and startup require live Clerk key mode and a remote HTTPS API. No deployment, hosted configuration change or provider account creation is part of these checks.

## Implemented safeguards

- Reviewer UI and `/design-preview` are development-only. Proxy rejects the gallery, HTML and PNG assets before Clerk, including encoded path aliases; a production flag cannot re-enable them.
- Clerk runs for actual application routes. Its strict production Content Security Policy supplies a fresh nonce to dynamically rendered Next HTML. The configured API origin is the only added connection origin; embedding and unsafe evaluation are blocked. The SDK continues to own bot challenges, social sign-in and unsupported authentication factors. See [Clerk CSP guidance](https://clerk.com/docs/guides/secure/best-practices/csp-headers).
- API destinations are validated before transmitting a bearer token. Remote HTTP, embedded credentials, query strings and fragments are rejected. Fetch omits cookies, refuses redirects and uses no browser cache or referrer. Production also rejects loopback API origins. Development permits HTTP only on loopback.
- Custom authentication errors map known provider codes to fixed friendly copy. Unrecognized provider diagnostics stay out of the UI. Password recovery uses generic unknown-account copy while reporting real network/rate failures, and failed sign-out remains visible and retryable. Account error pages support the installed Next `retry` callback.
- `/join` provides the browser fallback when an invitation app link opens without an installed mobile app. Clerk handles provider tickets; CareIQ never treats the ticket or an organization query as membership proof. Account switching retains only the current origin, safe entry path, provider ticket and known status. Authentication and required account tasks preserve only whitelisted internal destinations. A small session-storage hint contains only a constrained route, never tickets, tokens, passwords, codes or setup data.
- Accepting a listed invitation requires a matching verified email. Its internal organization resume hint must match fresh API access before completing CareIQ enrollment. Pending, revoked or unassigned access cannot dispatch clinical requests. Approved owner setup and explicit clinical location assignment remain API-authoritative.
- Exact `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` files bypass Clerk only for public association handling. Missing generated files return 404. Existing owner-generated files serve JSON with a one-hour cache; no signing IDs, certificates or association contents are fabricated. Start the web service from `apps/web` so its `public` directory is the configured app directory. See [mobile production readiness](mobile-production-readiness.md) for generation and actual device acceptance.
- Form labels are distinct from linked hints, password-manager and one-time-code attributes are preserved, and the help dialog restores keyboard focus. Setup and invitation retry payloads stay frozen after an uncertain submission; clinical screens conceal records when backgrounded and recheck access on return.

## Local checks and CI

The actual package name is `web`. Run from the repository root:

```sh
pnpm --filter ./apps/web lint
pnpm --filter ./apps/web typecheck
pnpm --filter ./apps/web test
pnpm --filter ./apps/web test:browser
```

The default browser suite starts an ephemeral loopback harness. It bundles the real React screens with explicitly test-only Clerk and API fixtures. Every API request remains local, unhandled API calls fail, and non-loopback browser requests are blocked. Fixture code lives only under `tests/browser`; production imports never reference it. Install the Playwright Chromium runtime in CI, or use `PLAYWRIGHT_CHANNEL=chrome` for an existing local Chrome. No provider credentials are required for these tests.

Two optional projects require explicit isolated loopback URLs:

```sh
CAREIQ_WEB_TEST_URL=http://localhost:3101 pnpm --filter ./apps/web test:browser --project=live
CAREIQ_WEB_PRODUCTION_URL=http://127.0.0.1:3103 pnpm --filter ./apps/web test:browser --project=production
```

The live project checks actual Next/Clerk rendering, account-page navigation, safe join return intent, password controls, dialog keyboard handling and a 320px viewport. It blocks every non-GET/HEAD/OPTIONS browser request and never submits credentials or codes. The production project uses HTTP assertions against an isolated production Next server: preview page/assets 404, matching nonce/CSP/security headers and absent association files 404. It does not log in or claim a successful hosted authentication flow. Trace, video and automatic screenshots are disabled for every project.

A credential-free production build uses reserved `.invalid` hosts and synthetic valid-shaped live-mode keys:

```sh
NODE_ENV=production \
CAREIQ_LOCAL_REVIEW_DIST_DIR=.next-production-check \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsucmVsZWFzZS5pbnZhbGlkJA \
CLERK_SECRET_KEY=sk_live_release_configuration_fixture \
NEXT_PUBLIC_API_URL=https://api.release.invalid \
pnpm --filter ./apps/web exec next build --webpack
```

These values are fixtures, not credentials. Use the same environment when starting that isolated output, from `apps/web`, with `next start --hostname 127.0.0.1 --port 3103`. They must never be supplied to a deployed service. The separate output protects existing `.next` developer and `.next-local-review` review processes. Real production uses the owning environment's live application keys, HTTPS API and approved domain; the API still verifies authorized browser origins.

## Acceptance evidence

On 2026-10-06, 49 Node tests, web lint/typecheck and an isolated Next 16.3.6 webpack production build passed. All 24 Chromium browser checks passed: 18 isolated actual-component transitions, 3 read-only actual Next/Clerk checks at port 3101, and 3 production HTTP checks at port 3103 using the reserved fixtures. The production HTML contained fresh matching Next/Clerk nonces, strict-dynamic, no unsafe-eval and the configured API origin. Reviewer HTML/PNG assets, encoded aliases and missing association files returned 404. The temporary production server was stopped after verification. Mocked transitions prove component behavior, local production HTTP checks prove the generated server guards, and read-only actual-Clerk rendering proves the page/SDK integration. They do not prove actual signup, email delivery, password reset, MFA/recovery, provider ticket redemption or a signed-in browser-to-API session. Separate actual-account browser ticket integration subsequently passed against the real loopback API, as recorded in [the API evidence](api-production-release.md). That check redeemed one 60-second ticket, received 200 for `/me` and onboarding state, and revoked only its temporary session. It does not prove password/MFA, draft submission or invitation/device acceptance. No synthetic fixture should be reported as that evidence.
