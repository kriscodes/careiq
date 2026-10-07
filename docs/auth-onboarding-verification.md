# Authentication/onboarding verification — October 6, 2026

This is the earlier implementation baseline. The [production-readiness follow-up](production-readiness.md) supersedes its test counts, migration count, dependency audit and founder-approval status. Historical evidence below is retained.

All work below was performed in `/Users/kristian/Documents/Server/CareIQ`. No fresh repository clone, fetch/pull, push, remote deployment or hosted database migration was performed. The checkout remains uncommitted for review, with earlier dirty marketing work preserved.

## Automated checks

| Scope | Result |
| --- | --- |
| API/database | 109 tests passed, no skips; typecheck and build passed. Includes real PostgreSQL restricted-role RLS, actor draft isolation, idempotent pending/complete reconciliation, browser/native signed-token policy and marketing regression coverage. Final state/draft HTTP errors also have readable copy and provider-detail redaction checks. |
| Web | 37 tests passed; lint, typecheck and Next 16.3.6 webpack production build passed. Includes redirect/invitation handling, saved setup state, cancellation/location scoping and safe Clerk continuation headers/cookies. |
| Mobile | 19 tests passed; lint and typecheck passed. Includes account/scope cancellation, access rules, setup validation, foreground authorization and definitive refusal/retry behavior. |
| Marketing | 8 tests passed; lint, typecheck and webpack production build passed. |
| Shared contract | 3 tests passed; lint/typecheck/build checks passed. |
| Total | 176 tests passed across the five packages; no skipped API/database tests. |
| Expo | SDK compatibility check passed; Expo Doctor 21/21 passed; final iOS, Android and web exports succeeded with 17 routes. |
| Install | Frozen-lockfile install passed under Node 22.23.2 and pnpm 11.22.0. Only reviewed build scripts are allowed; informational browser-tabs-lock/core-js install scripts are explicitly skipped. |

Native JavaScript/asset export is not a compiled installed app. Full Xcode, CocoaPods and the Android SDK are unavailable on this machine; no native binary/device run was claimed. Actual native login/MFA, callbacks, invitation cold/warm starts and expiry/revocation remain separate acceptance tasks.

## Database and runtime

All 18 migrations through `0017_onboarding-drafts.sql` applied to empty isolated `careiq_test`; the immediate second run was a no-op. The same journal applied to `careiq_review`. PostgreSQL 18.6 runs in the dedicated labeled `careiq-auth-review-db` container on `127.0.0.1:55434`. No other local database/container was modified.

The live review API connects as `careiq_review_runtime`, which has no superuser, RLS-bypass, ownership, role/database creation or replication rights. Checked clinical-runtime group grants passed. The API health endpoint returns HTTP 200 and `database: connected`; unauthenticated `/me` and onboarding state return 401. The onboarding response says “Sign in again to continue.”

Runtime safeguards reject remote/unrelated database URLs, production Clerk keys, mismatched test applications, inherited application secrets/configuration and unconfirmed founder overrides. Stop/restart checks the exact supervisor arguments, recorded start time and process group before signaling; a mismatched ownership check sent no signal. Both loopback address families are checked for occupied ports. Existing user development processes on ports 3000/3001 were left running. Eleven focused runner safeguards passed without spawning or signaling a process. Setup/start/restart require Node 22.13+ before any restart can stop a service, and failed startup/readiness returns nonzero; the pinned runtime is 22.23.2.

Review servers use API 3100, web 3101, marketing 3102 and Expo 8082. Next review output is isolated in `.next-local-review`. Private credentials, ownership records and logs live in ignored `.local-review/`; the database volume survives stop/restart. See [local review](local-review.md).

## Browser and design review

Actual custom web sign-in/sign-up and mobile browser sign-in render HTTP 200 with no page errors. Web sign-in fits 320px without horizontal overflow. Web and native galleries expose all 34 design states. Representative mobile setup screens fit 390, 360 and 320px widths; product page backgrounds remain white.

The review found and fixed an exact same-URL Clerk/Next rewrite self-proxy issue on the loopback server. The fix preserves verified Clerk request/auth headers and HttpOnly cookies; different origins/paths/query rewrites, redirects and 401/403/500 responses are untouched. Authentication is still evaluated by Clerk.

Final mobile setup requires the accessible owner authority checkbox and offers friendly searchable time-zone choices while retaining the IANA API value. The final browser report confirms checked false → true and creation disabled → enabled only after confirmation, with no overflow at 390, 360 or 320px. Returning from background cancels/discards protected state and requires a fresh token/access check before protected content renders. Server drafts survive interruption.

Saved implementation screenshots and browser reports are in [implementation review](design/auth-onboarding/implementation-review/). The original design set's 34-by-3 screen rendering, narrow widths and simulated owner/invite/retry flows are recorded separately in [design verification](design/auth-onboarding/verification.json); that is design validation, not live authentication acceptance.

## Dependency audit

Compatible fixes removed the new `qs`, `proxy-addr`, `source-map-js` and `brace-expansion` findings. The last uses a published compatible 5.0.12 workspace constraint; the Next/eslint-config-next security baseline was reconciled to 16.3.6.

`pnpm audit --prod` still reports four upstream mobile/tooling advisories: two high and two moderate, with no critical findings. The release gate remains failing; no findings were suppressed.

| Package | Remaining result | Registry/compatibility check |
| --- | --- | --- |
| node-forge 1.4.0 | High — [maintainer advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Listed 1.4.1 patch was not found in the configured registry. |
| braces 3.0.3 | High — [maintainer advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Listed 3.0.4 patch was not found in the configured registry. |
| decode-uri-component 0.2.2 | Moderate — [maintainer advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Listed 0.4.3 patch was not found; current parent requires 0.2.x. |
| uuid 7.0.3 | Moderate — [maintainer advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | 11.1.1 exists; Expo's xcode parent requires 7.x. A major override/parent upgrade has not been verified. |

The audit task in Notion remains In progress/Blocked with the current findings. Local design/code review does not close release acceptance.

## Remaining acceptance and Notion

Designs and the draft/state API implementation are Done. Local web/mobile code implementation and documentation/local environments have their own evidence; the existing broader owner/invitation/native acceptance tasks stay In progress until live checks are performed. The design page has the interactive prototype, three platform boards, six smaller screen-export archives and implementation handoff. Saved design source and documentation also live in this repo.

At this baseline, founder approval was deliberately empty. During the production-readiness follow-up, the owner supplied their existing sign-in identity; that verified identity is now explicitly approved only in private local review configuration. The private `owner.env` setting allows that confirmed identity to exercise real practice creation against this isolated database without modifying original environment files. No identity, external invitation or clinical assignment was created by automated browser review. Native bearer authentication and marketing intake remain disabled.
