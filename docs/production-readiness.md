# Production-readiness follow-up — October 6, 2026

October 16 workflow implementation and verification are recorded in [the workflow review guide](workflow-implementation.md) and [current verification](verification/workflow/verification.md). Earlier results below remain historical.

Status: local safeguards are implemented; release acceptance remains open. Work uses the existing `/Users/kristian/Documents/Server/CareIQ` checkout, preserves prior dirty marketing changes and stays uncommitted. No CareIQ clone/fetch/pull, commit, push, deployment, hosted migration, store registration or native release was performed.

## Implemented

- API production startup rejects incomplete live authentication, redirect/webhook/origin settings and plaintext database transport. It checks the restricted database role, inherited privileges, exact policies/constraints/triggers and authorization helper bodies before listening. Migration 0018 pins helper search paths. The migration runner checks files/journal/applied checksums before SQL, serializes operators and requires an exact database confirmation for remote targets. See [API production checks](api-production-release.md).
- Web validates its API origin before attaching tokens, requires live production configuration, blocks design-gallery routes/assets in production, redacts provider diagnostics and exposes recoverable retry/sign-out states. Invitation links retain only safe intended routing through authentication and required account steps. Native association files are served publicly only at their two exact paths; absent files remain 404.
- Mobile foreground/background changes cancel stale work and require a fresh matching identity/session/organization before protected screens reopen. Password/code fields clear on inactivity; invitation confirmation remains retryable. Production native config requires owner-approved release metadata and disables iOS arbitrary HTTP, Android cleartext/backups and development-client schemes. HTTPS app links are restricted to `/join`. See [mobile production checks](mobile-production-readiness.md).
- The mobile website association generator prepares reviewed local AASA/assetlinks files from real owner-supplied IDs and signing fingerprints. It validates without writing with `--check`, preserves different existing files and supports certificate rotation. It publishes nothing.
- Published scoped dependency upgrades and version-preserving backports address the reviewed exploit cases. Exact patch/post-image integrity and compatibility tests are included. See [patch provenance and limits](../patches/README.md).
- `.github/workflows/readiness.yml` provides future checks-only CI: disposable PostgreSQL migration replay, lint/types/tests, browser harness, builds/exports and an independent unsuppressed dependency audit. Immutable action references, minimal repository permissions and frozen installs are used. It has no deployment job and has not run remotely.

## Verified locally

The final consolidated workspace run passed lint, typecheck and all 212 tests with zero skips (API 119, web 49, mobile 33, marketing 8, shared 3). An additional 16 dependency regressions, 8 association tests and 24 browser checks passed; see the scope distinctions below and [machine-readable evidence](production-readiness-evidence.json).

| Scope | Verified result |
| --- | --- |
| API/database | 119 tests, zero skipped; TypeScript/build and restricted review catalog verification pass. All 19 migrations replayed twice on fresh isolated PostgreSQL 18.6; second run is a no-op. |
| Web | 49 tests, lint/types and the isolated production webpack build pass. All 24 browser checks pass: 18 simulated actual-component transitions, 3 read-only real Clerk/Next render checks and 3 production HTTP/CSP checks. See [web verification](web-production-readiness.md). |
| Mobile | 33 tests, lint/types, Expo Doctor 21/21 and iOS/Android/web JavaScript exports pass. Isolated synthetic-config prebuild generates both native projects with release transport settings inspected. |
| Mobile association generator | 8 tests pass; no real signing/domain association files fabricated. |
| Marketing/shared | Marketing 8 and shared 3 tests, lint/types and production builds pass. Build output is isolated from existing development servers. |
| Dependency backports | 16 exploit/compatibility/integrity tests pass. |
| Production dependency audit | Still fails: two high advisories for node-forge and braces, no critical or moderate findings in the latest verified audit. Published patched versions remain unavailable; findings are not suppressed. |

Synthetic live-shaped `.invalid` configuration in tests/builds checks validation and compilation. It is not real provider configuration and cannot authenticate users. Expo JavaScript export and `--no-install` prebuild do not compile, sign or install a native app. Browser harnesses use synthetic identity/API data and do not prove provider email/password/MFA or invitation delivery.

## Existing account and local previews

The owner-selected existing development account has a verified primary email and is approved only in ignored private local review settings. No additional account is needed. Original environment files and the hosted CareIQ database remain unchanged.

One 60-second backend-issued token for that account's existing active development session passed real Clerk signing-key verification in an ephemeral native-opt-in harness. Browser transport headers and invalid signatures were rejected. The actual review API kept native access disabled; the token lacked browser `azp`, so real `/me` and onboarding-state requests correctly returned 401. No draft was saved and no identity, organization or invitation was created. That earlier probe is token-policy evidence. A separate genuine browser integration check below succeeded.

A single 60-second sign-in ticket was then consumed in a fresh isolated browser session for the same selected account. The genuine frontend token matched `http://localhost:3101`; real `/api/v1/me` and onboarding state returned 200 with verified-email/founder eligibility. No draft or submitted operation existed; the check stayed read-only. Only the newly created temporary session was revoked, its revocation verified and the browser context destroyed. The pre-existing session stayed active. No token, ticket or browser storage was retained. This proves frontend/API token integration; password/MFA, draft submission and invitation/device acceptance remain open.

Private local credentials, process ownership records and sanitized provider evidence remain in ignored `.local-review`. The supervised previews are:

- API: `http://localhost:3100/health`
- Web: `http://localhost:3101/design-preview`
- Mobile layouts: `http://localhost:8082/design-preview`
- Marketing: `http://localhost:3102`

The local database is isolated on 127.0.0.1:55434. Runtime credentials are restricted. User processes on 3000/3001 are preserved. See [local review](local-review.md).

## Checks and remaining release gates

Use the pinned Node 22.23.2/pnpm 11.22.0. Set a private `TEST_DATABASE_URL` to the isolated loopback database named `careiq_test` and `DATABASE_SSL_MODE=disable` before integration tests. Never use a hosted URL or the review database as an automated test target.

```sh
pnpm release:check
pnpm --filter @careiq/api db:verify
pnpm mobile:links --check
```

`release:check` refuses a missing `TEST_DATABASE_URL` before running, so required database tests cannot silently skip. It includes lint, types, workspace tests, security regressions, association tests, browser harness and the raw production audit. It intentionally remains nonzero while the audit fails. `db:verify` uses the separately selected restricted runtime URL and reads catalog metadata only. For release configuration preflight use `NODE_ENV=production pnpm --filter @careiq/api release:verify` with actual reviewed values. The association check requires the metadata listed in the mobile guide; missing values intentionally fail.

| Release gate | Remaining requirement |
| --- | --- |
| Dependency audit |Reviewed published upstream fixes and a passing raw production audit; no suppression or misleading package versions. |
| Production identity/configuration |Actual matching live Clerk keys, providers/MFA/email delivery, signed webhook delivery/replay, exact HTTPS redirects/origins and deliberate user/organization/founder mappings. Existing development identities are not assumed to exist in production. |
| Owner and invited-staff acceptance |Signed-in browser checks for creation/resume, invitation acceptance/delivery, intended practice, role/location assignment, two-practice denial and revocation. |
| iOS/Android release acceptance |Actual owner IDs/EAS project/Apple team/signing fingerprints/domain ownership; full Xcode/CocoaPods and Android SDK tools; compiled installed apps, cold/warm invitation links, auth/MFA/recovery, expiry/revocation, sign-out storage cleanup and accessibility. Keep the native API gate off until accepted. |
| Hosted database/operations |Owner-authorized backup restoration rehearsal, historical migration-ledger reconciliation, TLS/runtime preflight, hosted migration/application rollout and operational controls. No hosted changes are authorized in this task. |

Real patient production use remains outside the owner's current synthetic/demo hosting scope. The code checks do not establish that broader launch acceptance. Existing Notion owner/invitation/native tasks remain In progress; the audit task remains Blocked. Completed local design/implementation work retains its bounded Done status. No release tag or version note was created for these uncommitted changes.
