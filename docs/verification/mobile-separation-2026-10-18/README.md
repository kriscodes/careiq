# Mobile separation and retained release verification — October18,2026

Mobile is removed from the active canonical CareIQ checkout and preserved for a separate repository to be created later. No new repository, remote, commit, staging, push, release tag, hosted deployment or hosted database operation was performed. All prior uncommitted file/audit/marketing/dependency hardening remains included.

## Source and dependency boundary

- The active workspace explicitly lists API, authenticated web and marketing, plus the existing shared packages (six projects including the root). `apps/mobile` is absent, not merely ignored by an audit.
- All62 tracked mobile source files,16 matching shared i18n files and15 dependency/security references were verified before extraction. An independent reviewer checked all93 hashes/byte sizes and source commit equivalence. The owner-only outside-checkout handoff is `/Users/kristian/Documents/Server/CareIQ-mobile-handoff-2026-10-18`; private ignored original state is separate and must never be uploaded wholesale. No standalone mobile project is claimed ready.
- Pruned506 package identities, added none, and changed no retained direct application dependency field/version. Frozen install passes for all six projects. Mobile-only overrides, Expo release-age exceptions and unused node-forge/query-string patches are removed only after verified preservation. The qs/esbuild/brace-expansion protections and required braces backport remain.
- Removed stale nested web workspace/lock files pinned to the old Next16.3.3 graph. Commands launched from the web directory now find the canonical root workspace and current security policy.
- Removed mobile scripts, Expo CI/build requirements, its preview supervisor and8082 browser-origin grant. The currently running owned API was safely refreshed and an actual preflight confirms8082 receives no allow-origin grant. Other previews and data are preserved.
- Retained backend native-auth/tenant/location contracts and security tests, web exact-path association hosting/generator/tests, and shared translations for future mobile clients. Native authentication remains gated. Website association commands now use `web:associations`, `web:associations:check`, `web:associations:test`.

See [ADR-018](../../decisions/018-mobile-repository-separation.md) and [mobile recovery/future setup](../../mobile-separation.md). The future repository still needs mobile-only manifests/lock, adapted shared-package tooling, deliberate contract/localization ownership and separate signing/provider/device acceptance.

## Final retained verification

| Check | Result |
| --- | --- |
| Full `pnpm release:check` | PASS, exit0,91.7seconds; includes lint/types, all retained units, security/association cases, both required browser suites and the unsuppressed production audit. |
| Workspace units | 314 passed, zero failures/skips:224API,73web,9marketing,3contract,5localization. |
| Retained security / association tests | 16 /8 passed, zero skips. Mobile-specific source/security checks are preserved with the handoff rather than silently counted as current passes. |
| Component / actual API paperwork browser | 53 /2 passed, zero failures/skips. Actual handlers/private PDFs/restricted test DB are used; identity-provider seam remains synthetic. |
| Production builds / actual production HTTP | API, web and marketing builds pass;3 production HTTP/CSP/preview-boundary cases pass. |
| CI and target guards | Both YAMLs pass static review;12 guard cases prove unsafe/missing test DB targets stop before suites. Both workflows and release checks require actual API/restricted-DB browser cases. No remote Actions run is claimed. |
| Clean production-only install | PASS offline/frozen in a fresh disposable local manifest/lock copy;178 installed package directories, no Expo/React Native/node-forge/braces directories. Lifecycle scripts are disabled for inventory. Temporary install removed. This is not a deployed Linux-image acceptance test. |
| Raw production audit | **PASS, zero findings in every severity**, exit0. No ignores, renamed packages or invented versions. |
| Full raw development audit | **Still exit1: one HIGH `braces` finding**, zero other severities. It is retained through Next ESLint tooling; its reviewed backport and exact controls remain tested. |
| Actual local service/origin cleanup | Five health/route/unauthenticated probes pass; retained3101 origin granted and retired8082 not granted. API/web/marketing supervisors are owned and ready;8082/3191/3192 are closed. |
| Database | All36 SQL files unchanged from HEAD; no new schema migration. Owned local API refresh repeats/checks existing isolated ledgers, without resetting data. |

The production audit becomes clear by removing the actual unused application/dependency closure. The full development finding remains visible and is not reclassified as fixed. The existing required production-audit semantics are unchanged.

## Vendor and production limits

Independent inspection of the shared Next16.4.1 package found no identified compiled node-forge/micromatch/braces package metadata or matching identities in the inspected code. It did find **different** recursive brace-expansion/minimatch logic in compiled glob/static-serving helpers with stripped upstream version metadata. A bounded96MiB/1.5second child reproduced a glob stack overflow from a4500-depth developer/build input with filesystem traversal disabled. Identified callers use local CLI/build/configured patterns; no public CareIQ request path to that input was found. The static-serving copy has no identified noncompiled Next caller in this inspected slice. These are bounded findings, not a universal absence/reachability or CVE/version certification. No speculative framework fork or security-rule removal was introduced. See the independent review for exact hashes/probe and limits.

Use a clean checkout and root frozen install for promotion; review/invalidate stale hosted build caches and inspect actual runtime contents rather than assuming a previous cached node_modules tree is the clean inventory tested here. Current hosted source/configuration, startup private-volume/cursor requirements, live identity/mappings, backup/ledger/runtime checks, scanner/email workers, real tenant/operating acceptance and vendor/practice decisions remain outside this local extraction proof. The earlier [production handoff](../release-hardening-2026-10-18/README.md) records those remaining controls; its combined-workspace dependency/mobile counts are historical after this split. No production-readiness or real-data approval is inferred.

The existing Software Kanban records reflect the owner decision:14 unfinished mobile items move to Phase Later with their status/history preserved. The completed source implementation remains Done for its historical scope and is recoverable. Current implementation, mobile audit/authentication, deployment and handoff notes are updated/read back; broader production release cards remain open.

## Evidence

- [Source handoff](source-handoff.json), [independent archive/coupling/vendor review](review.json), [shadow-workspace recovery](shadow-workspace-removal.json).
- [Dependency report](dependencies.md), [before](dependencies-before.json), [after](dependencies-after.json), [exact dependency delta](dependencies-delta.json), [security/install receipts](dependencies-tests.json).
- [Complete release run](release-check.json), [clean production install](production-install.json), [API build/owned refresh](api-scope-refresh.json), [loaded local scope/cleanup](final-local-checks.json).
- [CI and builds](ci-handoff.md), [release target guard](ci-release-guard.json).
- [Aggregate/source hashes](verification-summary.json), [Notion readback](notion-reconciliation.json), [commit message](commit-message.txt).
