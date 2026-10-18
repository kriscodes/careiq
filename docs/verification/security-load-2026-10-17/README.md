# Security, login stability and capacity review — October 17, 2026

The implemented local security and regression checks pass. Real findings were repaired; hosted operating acceptance and the unsuppressed dependency audit remain open. This review does not establish that information can never leak or that every future feature is secure.

## Repairs applied

- The login form waits for the actual browser authentication SDK. Loading/failure states offer stable manual recovery; passive sign-in/sign-up requests no longer toggle enabled controls. Deliberate submissions still lock once, and MFA/invitation/recovery rules remain intact.
- One-time patient-link exchange now serializes before resolving the unused grant, preventing two concurrent sessions. Form-completion links cannot reserve/upload/complete legacy collection files; the restricted database fulfillment helper independently enforces the purpose.
- A staff download callback no longer tries to change headers after sending the response. Signing validates drawn PNG resource bounds before decoding and limits PDF page expansion before allocation.
- Adult-self signing retains a protected immutable policy-decision reference/hash bound to the exact request/source/scope. New form links truthfully record patient_request_link with link_possession assurance; no email delivery or independent identity is inferred.
- Database queues, checkout deadlines, SQL/lock/idle-transaction deadlines and configuration overrides are bounded. Saturation returns safe retryable 503 responses. Idle and checked-out disconnects are logged safely, failed clients are evicted and later scoped work recovers. The separate protected audit-reader pool uses the same failure handling.
- Dependency statistics let existing practice/location page indexes stop after 51 authorized rows. No authorization policy was relaxed. Local environment files are owner-only and ignored; API/web development defaults bind to loopback.

Forward-only migrations 0033–0035 are registered and applied to the isolated review/test databases. Applied migration files were not rewritten. The entire 36-migration history replayed on a new empty database, repeated without ledger changes and passed restricted-runtime release verification; only the task-created replay database was removed. The separate 100-practice benchmark database/login/private state were also removed. Shared/hosted databases were not migrated.

## Verified boundaries

| Check | Result and interpretation |
| --- | --- |
| Full API suite | 218 passed, zero failures/skips; actual isolated database and HTTP checks included. |
| Full web unit / language suites | 73 / 5 passed, zero failures/skips. |
| Full synthetic component browser suite | 53 passed, zero failures/skips/retries; affected auth, forms, workflow, audit and localization scenarios. |
| Builds/static checks | API build/types, web optimized build/types and ESLint passed. Web build used reserved synthetic credentials/origin. |
| Adversarial tenant API/file matrix | 494 HTTP requests across 12 practices / 24 location contexts: 96 allowed and 398 negative; separate restricted SQL foreign reads/forged relations/raw audit checks. |
| 100-practice database isolation/catalog | 112 checks passed, including pooled connection reuse, rollback context clearing and known foreign patient/document/version/request IDs. |
| Independent dependency audit | Still non-green: 2 high findings (node-forge, braces), despite 16 passing reviewed backport regressions; reported fixed registry versions unavailable. No ignore/suppression was added. |

Counts above describe different suites; focused results inside those suites are not added again. Principal/API/browser fixtures are synthetic. The HTTP matrix runs real handlers under a trusted test authentication fixture, while the lifecycle case uses the actual installed Clerk provider with blocked external traffic. Neither proves a successful real password/MFA session.

## Capacity finding

The synthetic metadata dataset represents 100 practices, 100,000 patients, 300,000 appointments, 100,000 documents and 200,000 immutable versions. On the shared 8 GiB development computer, matched Node 22 before/after runs had zero errors. Patient/document page plans improved from roughly 16 ms to under 1 ms. The mixed service/DB workload achieved about 22 operations/second, with after p95 ~736 ms at 10 concurrent callers and ~2977 ms at 50. Existing exact counts and the 56-statement dated front-desk snapshot remain measured hotspots. Increasing concurrency did not scale throughput linearly.

This is evidence about this bounded metadata workload, not a 100-practice hosted SLA. Real PDF bytes/rendering/storage, provider/network authentication, email/scanner/workers and multi-replica traffic were excluded. Choose actual daily volume, active staff concurrency and latency targets, then run sustained acceptance on the intended hosting tier. See the [full performance report](database-performance.md) and [owner-controlled checklist](../../security/owner-security-checklist.md).

## Local login and remaining acceptance

The identified original web server on 3001 was still running Next 16.3.3; it was refreshed to the installed 16.4.1 and now binds 127.0.0.1. Its existing environment/API 3000 target was preserved; the shared database behind that original API was not migrated or tested. The owned isolated review uses API 3100 / web 3101. Its current sign-in address is http://localhost:3101/sign-in.

Public Clerk script/environment probes returned 200 without session or secret. Administrator policy prevented inspection of the user's existing browser; no workaround or personal-profile attachment was used. Actual owner/staff password/MFA/login recovery and hosted two-practice acceptance therefore remain open.

Real email delivery/workers, trusted scanning, isolated hostile-PDF processing, external storage/key/backup/retention controls, independent signer identity/certificates where required, unsupported signer roles and installed-device/provider acceptance retain their documented gates. No deployment, commit, push, real patient message or real-data activation occurred.

## Evidence

- [Verification totals](verification-summary.json), [API tests](api-tests.json), [web units](web-unit-tests.json), [browser results/capture hashes](web-browser-results.json).
- [API findings and adversarial coverage](api-adversarial-results.json), [auth lifecycle](auth-lifecycle.md), [database performance/isolation](database-performance.md).
- [Fresh migration replay](migration-replay.json), [benchmark cleanup](cleanup.json), [local filesystem/process/public-protocol checks](local-security-checks.json), [final loopback HTTP smoke checks](local-http-smoke.json), [dependency audit](dependency-audit.json).
- Synthetic [desktop recovery screen](auth-sdk-unavailable-desktop.png) and [mobile recovery screen](auth-sdk-unavailable-mobile.png); no real account/session/patient data.
- [Forms implementation boundary](../../forms-studio-implementation.md), [API/release procedure](../../api-production-release.md), [owner-controlled actions](../../security/owner-security-checklist.md).
