# Release hardening and production checks — October 18, 2026

Local hardening is verified in the canonical `Server/CareIQ` checkout, starting from merge commit `11df334`. **The release is not ready to publish:** two upstream HIGH findings remain in both raw audits, and actual hosted identity/operations/device acceptance remains open. This task made no commit, push, release tag, deployment, hosted database migration or provider/session change. Changes are unstaged for review.

## Changes applied

- Extended the version-preserving braces backport to direct compile/expand/stringify submodule entry points, with bounded exploit controls, actual parent-resolution checks and registry-tarball/patch/post-image integrity evidence. Genuine fixed node-forge/braces versions remain unpublished. No findings are suppressed or renamed.
- Removed a newly found development-only esbuild MODERATE advisory with a genuine scoped 0.25.12 override on legacy `@esbuild-kit/core-utils`. Existing tsx/web esbuild versions and the global qs 6.16.0 pin are preserved.
- Production now rejects development/default document paths, missing stable cursor keys, unprovisioned or unusable private directories, unsafe audit export/key settings and plaintext protected-audit transport. Private volumes must be owner-owned mode 0700 outside the application checkout with effective read/write/traverse access. Preflight does not provision or chmod a production directory.
- Document and audit-export file access rejects final symlinks, hardlinks, nonregular objects and group/other-readable files. New writes remain exclusive mode 0600. Audit retries preserve the original snapshot and compute parse/hash from the same bytes. Export downloads require a currently verified separate audit reader, including after configuration/privilege changes. Independent review findings were repaired and rereviewed.
- Marketing contact submissions reject redirects and omit referrers. The real HTTP307 regression proves the alternate destination receives no contact POST.

Configuration names and operator requirements are in the [API release guide](../../api-production-release.md) and blank [API environment example](../../../apps/api/.env.example). These prerequisites are now enforced; an older production configuration may intentionally fail until the operator prepares the private volume and secret settings.

## Final local verification

| Scope | Result |
| --- | --- |
| API/database tests | 224 passed, zero failures/skips; includes actual restricted SQL/HTTP tenant/document/audit/retry checks. |
| Web / mobile / marketing | 73 / 56 / 9 passed; source checks pass. |
| Shared contract / localization / mobile associations | 3 / 5 / 8 passed. |
| Dependency security controls | 22 passed, zero skips; package provenance/post-image and vulnerable-versus-patched controls pass. |
| Component / production HTTP / actual local Next-Clerk browser | 53 / 3 / 3 passed. Component cases include stable button/pointer state and duplicate-submit prevention. Real read-only render checks do not establish password/MFA acceptance. |
| Paperwork browser through actual API and restricted test DB | 2 passed; unsigned and adult-self signing flows, frozen answers, exact PDF/source/library hashes, retry and foreign-practice denial. Identity-provider seam is synthetic; API responses are not stubbed. |
| Exported marketing browser | 11 assertions pass, including responsive layouts, disabled intake/indexing, privacy/404 and keyboard behavior. |
| Builds | API, web and marketing production builds pass; iOS/Android/web preview JavaScript/static exports and online Expo compatibility pass. Native binaries/device acceptance is separate. |
| Restricted local DB / production rejection | Clinical and separate audit-reader catalog verification and the complete 36-entry local ledger pass. Six compiled production startup cases correctly stop on missing/unsafe storage, cursor or audit transport. Release assets are present. |
| Cleanup / service smoke | All six preserved local service probes pass; owned3191/3192 servers are closed; no generated browser practices or roles remain. |
| Raw dependency audits | Production and full audit still exit1 with **2 HIGH**, zero critical/moderate/low. No passing overall release gate is claimed. |

All36 SQL files are unchanged from the starting commit. This hardening pass needs **no new schema migration**. The fresh-empty/repeat replay from [the earlier October18 review](../pr-10-main-2026-10-18/migration-replay.json) is retained dated evidence for unchanged SQL, not rerun here or presented as a hosted backup restoration. The October17 100-practice benchmark is likewise earlier evidence; actual hosting-tier/daily-load acceptance remains open.

The first local storage test run exposed a changed synchronous invalid-key contract; that was corrected before final verification. A temporary zero-context patch format misapplied through pnpm and was caught by installed-file integrity tests; the standard contextful patch was restored, installed hashes and22 controls verified, and final API/browser/exports run afterward. The contextful patch contains required blank context prefixes that git reports as trailing whitespace inside the nested patch artifact. Application/source whitespace checks pass excluding that artifact; the warning is recorded rather than hidden or weakening source checks. See dependency receipts for details.

## Public hosted checks and remaining gates

Normal certificate-verified, credential-free probes found hosted API health200, unauthenticated patients401, allowed browser-origin preflight and no allow-origin grant for an untrusted origin. Marketing remains disabled for intake/indexing. These are public boundary checks, not authenticated tenant-isolation acceptance.

The product root returns200, but **`https://app.careiqlabs.com/sign-in` returns404** and public HTML references **Clerk test mode**. The deployed commit and actual Render branch/auto-deploy/predeploy settings are unknown. Local production guards and the reviewed sign-in route are not established as deployed. No account credentials, session/profile, patient payload or hosted settings were accessed or changed.

| Gate | Needed to complete it |
| --- | --- |
| Raw HIGH dependency gate | Genuine reviewed fixed releases or a separately reviewed compatible dependency replacement, then passing raw audits and compatibility checks. Current backports do not satisfy that criterion. |
| Matching hosted artifact/configuration | Reviewed deployment source/version, hosting gate settings, matching DB/API/web configuration and corrected sign-in route; the no-push instruction remains in force. |
| Production identity and two-practice acceptance | Privately configured matching live provider keys/settings, approved synthetic owner/staff accounts mapped to two practices/locations, real password/MFA/recovery, signed webhook replay/revocation and adversarial patient/document/retry tests. Do not post credentials in chat or infer mappings from names. |
| Hosted database/recovery | Current recoverable backup restored in isolation, actual ledger reconciliation and reviewed pending migrations, separate runtime/audit identities and production TLS/catalog preflight. Local ledger checks cannot establish the hosted state. |
| Files, scanning, email and operating controls | Owner-provisioned durable private storage/encryption/backup/retention, scanner/worker isolation and accepted failure alerts. Actual completion-email delivery and durable reconciliation workers remain unfinished; credentials alone do not implement them. |
| Native release/device checks | Full Xcode/CocoaPods and Android SDK plus real owner IDs/signing/domain metadata; installed signed iOS/Android login, links, background/revocation and accessibility acceptance. Keep native API access gated until accepted. |
| Capacity and practice signing/data policy | Actual hosting tier, fleet connection budget and daily/concurrent workload target; repeat sustained-load acceptance there. Practice approval of supported adult-self signing/record handling and real-data/vendor scope remains separate. |

The pending environment/test-account clarification was not treated as approval. Existing development/local-review configuration and missing local signing tools were inventoried without retaining values. Read-only public hosted checks do not establish settings held in a hosting secret store. See [operator prerequisites](operator-prerequisites.json), [owner controls](../../security/owner-security-checklist.md), [backup procedure](../../backup-retention.md) and the [earlier operator migration/rollback handoff](../pr-10-main-2026-10-18/operator-handoff.md).

The current implementation page and existing Software Kanban audit, promotion, signed-in acceptance, regression and handoff records are updated with these results and explicit blockers. No broad release/production card is marked Done from local checks.

## Evidence

- [Dependency changes and primary sources](dependencies.md), [fresh raw audits](dependencies-audit.json), [provenance and exploit controls](dependencies-controls.json), [test/repair/install receipts](dependencies-tests.json).
- [API final tests/build](api-checks.json), [DB and compiled production preflight](database-production-preflight.json), [independent final storage review](storage-review.json).
- [Web/marketing report](web-production-checks.md), [public hosted findings](web-hosted-readonly.json), [browser results](web-browser-checks.json), [marketing transport](web-marketing-transport.json).
- [Actual paperwork browser/API/DB cases](real-api-checks.json), [mobile/shared checks](mobile-shared-checks.json), [mobile exports](mobile-bundles-checks.json), [Expo diagnostics](mobile-doctor.json).
- [Local smoke and cleanup](final-local-smoke.json), [aggregate/source hashes](verification-summary.json), [Notion reconciliation](notion-reconciliation.json), [commit message](commit-message.txt).
