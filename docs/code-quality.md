# Code quality and release checks

This guide records the November 2, 2026 readability review and the checks needed to keep later changes reviewable. Repository checks and hosted release acceptance are separate: a green build does not establish real-provider authentication, production database ownership behavior, or patient-workflow acceptance.

## What the review verified

Measured against `b7820b0`, before this cleanup:

| Finding            | Verified baseline                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting         | `.prettierrc` was empty and CI had no format check. Across 234 application-source/shared-package TS, JS and CSS files, 2,711 lines exceeded 160 characters and 1,405 exceeded 240.     |
| Large modules      | `apps/api/src/db/schema/workflow.ts` had 1,485 lines and `apps/api/src/services/workflow.service.ts` had 1,203. Formatting increases these counts without adding behavior.             |
| Workspace state    | The main `WorkflowWorkspace` function had 34 state hooks; its file had 42 including the form component. Its longest line was 5,475 characters.                                         |
| API lint           | The API's `lint` command duplicated `tsc --noEmit`; web and marketing already used ESLint.                                                                                             |
| Explicit `any`     | TypeScript syntax inspection counted 68 in application/shared source, all in the API: 20 in workflow service and 18 in patient delivery service. Plain text counts also include prose. |
| Error handling     | `WorkflowError` and `AccessError` already exist. Legacy database/service paths still throw message-coded plain errors, and `app.ts` repeats their HTTP mapping.                        |
| Verification files | Tracked `docs/verification` files totaled 21.95 MB, including 19.94 MB of PNGs. The two build/browser logs totaled about 2 KB.                                                         |

The first cleanup establishes formatter and lint enforcement, gives tenant parameters and internal helpers descriptive names, narrows ten explicit `any` annotations in the two services (68 down to 58 across source), and removes an unused legacy validator. This does not complete the larger module or database-row typing work.

## Everyday conventions

Use `pnpm format` to format supported source/configuration files and `pnpm format:check` to verify them. Prettier owns indentation, wrapping, quotes and punctuation. The configured 100-character print width is a formatting target; SQL and other indivisible strings can remain longer. Generated migrations, generated output and archived documentation/evidence are excluded according to `.prettierignore`.

Use `pnpm lint` for code rules and `pnpm typecheck` for compiler checks. Keep those commands distinct. API rules check unused declarations, consistent braces/equality, and mishandled promises; framework lint continues to check React/Next behavior. Fix the underlying issue before considering a targeted, explained exception. Adding `void` to a promise only signals intentional detachment; it does not handle a rejected promise.

Naming should explain the domain and the role of the value:

- Prefer `tenant`, `patient`, `documentVersion`, `deliveryIntent`, `selectedRequirement` and `requestPayload` in substantial functions. Short loop indices and conventional request/response names remain reasonable in a small scope.
- Name helpers for their action: `recordDeliveryEvent`, `ensureDeliveryFollowUp`, `presentRequirement` and `patientDisplayName` reveal more than `event`, `attention`, `projection` and `display`.
- Include units where values could be confused: `timeoutMs`, `retryAfterSeconds`, `sizeBytes`, `amountCents`. Distinguish timestamps (`expiresAt`) from local calendar dates (`appointmentDate`). Keep boolean names meaningful, such as `isLoading`, `hasPermission` or an established domain predicate.
- Keep public API properties, event names, error codes and SQL identifiers stable. An internal naming cleanup is not permission to rename a wire contract or database column. Use a separate compatibility/migration plan when those must change.

An ESLint naming pattern cannot determine whether a clinical or operational name is sensible. Review the meaning and scope; avoid mechanical repository-wide abbreviation replacement.

## Types and errors

Use concrete record shapes for helpers that require a small, known set of fields, and generics when collection helpers should retain their input type. External input starts as `unknown` and becomes a domain type only after validation. The database boundary still needs deliberate row types and typed projections.

Replacing `any` with `as SomeRow`, `as unknown as SomeRow`, or an unconstrained generic cast does not prove the data has that shape. Do not improve an annotation count by hiding the same uncertainty. Existing untyped database rows are follow-up work; new code should avoid adding more. `eslint-suppressions.json` now records 224 existing explicit-any annotations across 32 API source/test/benchmark files (233 after the initial cleanup; nine obsolete allowances were removed during strict test typechecking). ESLint fails when a per-file count grows or a suppression becomes stale. This limits counts, not individual identities: removing one annotation could allow another in the same file, so review is still necessary. Remove obsolete allowances with `pnpm exec eslint apps/api --prune-suppressions`; do not regenerate or enlarge the baseline to accept new debt.

Reuse `WorkflowError` and `AccessError` where their semantics fit. The clinical list/create handlers now share `routes/clinical-failure.ts`; legacy tenant and appointment failures use `AccessError.code` instead of matching `Error.message`. Regression tests cover known codes, response compatibility and redaction of unexpected errors. Preserve status codes, stable client error codes, safe public messages, retry headers and workflow failure-audit behavior. Unknown errors must remain generic to clients. This is a behavior-sensitive refactor and needs failure-path tests.

## Coverage policy

The release coverage runner uses c8 and includes untested files in each target's declared source scope. The executable source of truth for targets and thresholds is [`coverage-policy.json`](../coverage-policy.json); reports belong under ignored `coverage/`, not in source control. Review line, statement, function and branch results separately. A headline line percentage alone can hide missing failure paths.

**API coverage combines unit and database integration tests.** It is not a unit-only percentage. Web and marketing Node tests also do not measure all component/browser behavior; Playwright remains a separate required check. Do not present a combined or partial result as complete application coverage.

Release coverage requires an explicitly configured isolated loopback `careiq_test` database. Its test reporter rejects failed, skipped, TODO or undiscovered suites. The ordinary developer test command may skip database suites without that setup; that result is not release evidence. The API now checks both source and test files: `pnpm typecheck` runs the normal compiler and the dedicated `apps/api/tsconfig.test.json`. Test fixture errors are fixed without disabling checks or excluding difficult test files.

Start enforced thresholds from measured results, then raise them as meaningful tests are added. Do not lower thresholds, narrow the source include list, exclude difficult files, or add coverage-ignore comments merely to make a build pass. A policy change needs review and an explanation. Changed business logic needs tests for success, invalid input, denied access and relevant concurrency/idempotency behavior even when aggregate coverage remains above its floor. Changed executable lines now have an additional **80%** gate through `pnpm coverage:changed`. Supply the actual reviewed base in `COVERAGE_BASE_SHA`; CI uses the pull-request/merge-group base or previous push SHA, and manual readiness runs require an explicit input. Formatting and erased TypeScript-only changes are ignored by syntax comparison; executable business changes count. Source/test/config and report hashes reject stale or missing coverage. A missing base fails closed, including a first branch push with no valid previous SHA; use its pull-request check or an explicit manual base.

## Deployment check matrix

“Existing” below describes the pipeline before this cleanup. The final validation record must identify which new gates ran successfully on the candidate commit.

| Check                              | Existing coverage                                                            | Requirement or remaining gap                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible toolchain/install     | Pinned Node/pnpm, frozen lockfile, pinned Actions revisions                  | Keep these pins and review updates.                                                                                                                                         |
| Formatting, lint and types         | Web/marketing ESLint and workspace types; API compiler only                  | Enforce formatter and real API/shared lint as well as types.                                                                                                                |
| Tests and coverage                 | API/web/marketing/shared tests; no coverage floor                            | Enforce measured source-inclusive coverage and reject skipped release tests. Keep unit and integration evidence identifiable.                                               |
| Database changes                   | Fresh migration plus immediate replay on disposable PostgreSQL               | Add production-like non-superuser object-owner rehearsal; test upgrades as well as empty databases. Retain restricted-runtime functional tests.                             |
| Browser/API behavior               | Synthetic browser suite and real local API/restricted-database browser tests | Keep both. Provider-backed authentication and authorized hosted acceptance remain separate.                                                                                 |
| Production builds                  | API/shared/web/marketing builds with reserved configuration                  | Build the exact candidate revision; reserved fixtures do not validate deployed secrets or provider settings.                                                                |
| Dependencies                       | Production dependency audit and repository regression checks                 | Retain hard failures. Review development-tool exposure separately; production-only audit is not a full dependency audit.                                                    |
| Secrets and static security checks | Security regression tests; hosted scanning settings not established here     | Verify repository secret scanning/push protection and dependency update alerts; add appropriate static analysis without treating it as functional proof.                    |
| Promotion controls                 | Workflow files execute checks; hosted settings are outside this patch        | Require checks/review in GitHub branch rules and verify the deployment service waits for those exact checks/revision.                                                       |
| After deployment                   | Recorded public smoke checks and manual protected acceptance                 | Verify deployed commit, health, database connectivity, headers, unsigned denial and critical authorized workflows; watch errors and retain a rollback decision.             |
| Recovery                           | Prior dated backup/restore evidence exists                                   | Rehearse recovery on the relevant schema. A code rollback does not automatically reverse a migration; use compatible additive migrations and a reviewed data-recovery plan. |

Do not infer branch protection, deployment gating, secret scanning or provider activation from committed YAML. These settings require separate inspection and configuration. The initial readability cleanup did not change hosted settings. The separately authorized follow-up below records the live GitHub and Render configuration changes; no release was deployed.

## Refactor priorities and known acceptance limits

1. **Production database ownership behavior:** the original [release record](verification/e2e-release-2026-11-02.md#known-limits-retained) retained 28 failures under a non-superuser/non-BYPASSRLS owner. The [approved local repair](verification/managed-owner-repair-2026-11-02.md) now clears those failures in both fresh and upgrade rehearsals, with strict permission checks and no skips. Hosted migration/deployment and a migration-50-compatible rollback rehearsal remain separate release work.
2. **Workflow service:** separate read-model projections from command handlers, then group handlers by appointments, documents, requests and forms. Keep transaction scope, authorization, concurrency, idempotency and audit writing explicit. Extract one boundary at a time with existing integration coverage.
3. **Workflow workspace:** separate snapshot/schedule loading, selection/navigation state and modal/form behavior into focused hooks and components. Preserve cancellation, stale-response protection and access-denial resets; hook count alone is not a reason to combine unrelated state.
4. **Schema organization:** group related declarations while preserving exports, foreign-key dependencies and migration history. Do not edit applied migration bytes as a formatting exercise.
5. **Evidence storage:** preserve existing verification records and links. Put future routine screenshots, logs and coverage reports in CI artifacts with retention; commit only selected evidence that explains a decision or regression. Deleting current images does not remove their bytes from Git history.

Protected production workflows still need an authorized observed session. Actual password/MFA/reset/session rejection, invitation redemption, delivery/scanning/worker activation and real-patient acceptance keep the limits recorded in the linked release evidence.

## Validation record

Verified locally on November 2, 2026 against working changes based on `b7820b0`. These changes are not committed, pushed or deployed. The two existing workflow/job names are retained so this patch does not silently rename externally required checks.

Across the same 234 source files, lines over 160 characters fell from **2,711 to 214**; lines over 240 fell from **1,405 to 79**. Remaining long lines are primarily SQL, strings and other content that the formatter deliberately preserves. The main workflow component still needs the focused decomposition described above.

The final c8 12 run includes 222 executable source files. API coverage is combined unit/integration coverage; frontend and shared results are Node test coverage, with browser tests assessed separately.

| Scope                          | Lines / statements measured | Enforced minimum | Branches measured / minimum | Functions measured / minimum |
| ------------------------------ | --------------------------- | ---------------- | --------------------------- | ---------------------------- |
| API                            | 73.56%                      | 73%              | 79.83% / 79%                | 92.71% / 92%                 |
| Web, all source                | 15.62%                      | 15%              | 76.58% / 76%                | 73.08% / 73%                 |
| Web `src/lib`, additional gate | 84.45%                      | 80%              | 87.06% / 85%                | 89.74% / 85%                 |
| Marketing                      | 70.83%                      | 70%              | 75.49% / 75%                | 60.52% / 60%                 |
| i18n                           | 93.76%                      | 93%              | 71.92% / 71%                | 100% / 100%                  |
| Interview contract             | 98.88%                      | 98%              | 95.12% / 95%                | 100% / 100%                  |

These are baseline floors, not claims that 15% UI coverage is adequate. UI unit coverage is a clear improvement area. Raise floors as behavior-focused tests are added, alongside the separate changed-code gate. Formatting expanded previously compressed statements and changed line-coverage denominators; compare future measurements against this formatted baseline.

Validation completed:

- Application/shared tests: **551 passed**, zero skipped, failed or TODO (401 API, 131 web, 9 marketing, 7 i18n, 3 contract).
- Tooling tests: **86 passed**, including coverage guard failures, repository hygiene and the previously omitted Clerk email-script suites. Python local-review regressions: **11 passed**.
- All **49 migrations** verified on immediate unchanged replay in a task-owned loopback database. That temporary database was removed afterward; existing review databases were untouched.
- Workspace lint and type checks passed. API/shared/web/marketing production builds passed with reserved `.invalid` provider configuration; no production credentials were required.
- All **3 real-API/restricted-database browser tests passed**. The final browser fixture suite passed **245/245 without retries or skips**. Earlier runs exposed two issues fixed in this patch: UTC fixture dates now use an explicit UTC browser timezone, and settings tabs focus immediately so a deferred focus update cannot override the next navigation key. A new deterministic keyboard regression was verified to fail with the old behavior and pass with the fix. The final web production build, lint and types passed again afterward.

`pnpm repo:check` prevents new tracked logs and files larger than 1 MiB. Two existing tiny logs retain exact-path size allowances that cannot grow. This is a per-file guard, not a total screenshot budget; all existing evidence remains intact.

Coverage HTML, LCOV and JSON are generated under ignored `coverage/<workspace>/`. CI prints summaries. Automatic approval review rejected the optional upload of source-containing coverage artifacts to GitHub; no upload step was added. Use a reviewed artifact-retention policy before enabling that transfer.

The production dependency audit is a required gate and passed with **zero advisories**. Frozen-lockfile installation, the final formatting check and repository hygiene check also passed. The full development audit found two newly published moderate advisories. The new coverage dependency graph now uses patched `glob` and modern `minimatch` versions. **One development-only minimatch advisory remains in the existing ESLint/Next plugin dependency chain**: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). The legacy callable API cannot safely be forced to the modern major version globally. Its raw audit finding is retained; no advisory is ignored. The current ESLint 9 line also needs a planned supported-version/toolchain upgrade. These development-tool issues do not change the production audit result.

## Follow-up release controls, November 2–3, 2026

The earlier validation counts above describe the initial readability cleanup. The follow-up adds controls requested afterward:

- GitHub [CareIQ required release checks](https://github.com/kriscodes/careiq/settings/rules/26421380) is active for `main` and `codex/deploy-marketing`. It requires `verify`, `quality`, `dependency-audit`, `managed-owner`, `release-gate`, `codeql` and `secret-scan` from GitHub Actions, with up-to-date branches and no bypass actors. Existing review rules remain intact.
- All three Render services now use **After CI Checks Pass**, verified from their saved settings. API and web deploy `main`; marketing deploys its independent branch. GitHub secret protection and push protection were already enabled and remain enabled.
- Each package build now invokes an exact-commit guard on Render. It reads `RENDER_GIT_COMMIT`, checks all seven successful GitHub Actions results for that SHA and fails on missing, pending, skipped, neutral or failed results. This also guards manual Render builds once the patch reaches the deployed branch. Local/CI builds do not wait on their own incomplete check. A direct check against current GitHub `b7820b0` correctly failed on `quality`.
- The new managed-owner job creates only a disposable loopback database, migrates with a non-superuser/non-BYPASSRLS owner, verifies table ownership and runs the complete API suite without allowing skips. It initially failed on the existing 28 failures. After explicit approval, the [local repair](verification/managed-owner-repair-2026-11-02.md) passes both fresh and upgraded ownership rehearsals without changing historical migrations.
- Strict API test typechecking, changed-code coverage, Gitleaks, CodeQL and public post-deployment/rollback verification are implemented. See the [release verification guide](deployment/release-verification.md) for exact commands, scanner findings and activation requirements.

These repository edits remain local and uncommitted under the repository instruction. They have not been pushed, deployed or applied to any hosted database. Required-check settings are active now, so unverified changes are blocked until the new workflows are published and their failures resolved. Post-deployment event wiring and a hosted staging rollback drill remain unverified; the local loopback rollback test does not establish hosted recovery.

The security gate still blocks on existing CodeQL findings. The subsequently approved local database repair clears the ownership failures; its current evidence is linked below. Passing the local ownership gate does not clear the remaining release requirements.

Follow-up verification: **553 application/shared tests passed** (403 API, 131 web, 9 marketing, 7 i18n, 3 contract), with no failures, skips or TODOs in the ordinary CI ownership model. Changed-code coverage is **1,187 / 1,304 executable lines, 91.03%**, above the 80% requirement. Current report provenance includes the final health-contract regression. All existing workspace coverage floors and strict API source/test typechecking passed. **108 tooling tests**, workspace lint, repository hygiene, formatting and API/web/marketing production builds passed; build identity and provider values were reserved local fixtures.

Before the approved repair, the separately isolated managed-owner run was **395 tests: 367 passed, 28 failed, zero skips/TODOs**. Eight downstream subtests cannot be reached while those failures remain; this explains the lower total than the ordinary API suite. All 49 migrations applied and replayed under the restricted owner, and all 91 public/audit tables had verified restricted ownership. The runner exits nonzero and cleans up its container. At that checkpoint no active repair migration or verifier exception had been introduced; the subsequent approved repair is recorded below.

The [security record](verification/release-security-analysis.json) records actual local CodeQL analysis: 65 findings in JavaScript/TypeScript and zero in Python/workflows; the final managed-owner runner delta was separately scanned with zero findings. The gate fails on these findings. Gitleaks checks history and candidate files with a synthetic detection regression. The repository's GitHub deployment-event history was empty at inspection, so automatic post-deployment triggering is not claimed; manual deployment/rollback verification is implemented and local fixtures pass.

## Approved ownership repair acceptance

The [November 2 local repair record](verification/managed-owner-repair-2026-11-02.md) supersedes the earlier 28-failure status. Migration 50 preserves the 49 historical SQL files and all existing helper bodies, assigns 13 helpers to five private roles, and adds exact catalog verification plus 61 permission regressions. Both fresh and seeded-upgrade restricted-owner runs pass **464/464 API tests**; the ordinary full suite passes **614/614**, with zero skips/TODOs. Changed-code coverage is **94.68%** (2,155/2,276), and all workspace floors pass.

The repair remains local and uncommitted. Existing 65 CodeQL findings and hosted post-deployment/recovery acceptance remain open. A rollback binary compatible with migration 50 must be rehearsed before hosted promotion; the previous 49-migration binary is not a compatible assumed fallback.

The three existing real-API browser cases also passed against a fresh restricted-owner database after all 50 migrations. They cover unsigned and signed patient forms, immutable PDFs/library access, foreign-copy refusal and insurance evidence/audit handling. The fixture database was removed; coverage provenance remained valid.

## Security remediation and migration-50 fallback acceptance

The [final November 2 remediation record](verification/rollback-security-remediation-2026-11-02.md) supersedes the earlier 65-finding and missing-fallback status. Candidate and fallback CodeQL analyses, with the final tooling delta rescan, now pass with zero findings and no suppressed rules. Final candidate checks pass 626 application/shared tests, 245 component browser cases and three real-API cases; changed-code coverage is 94.84%. The separate fallback passes 474 API and 133 web tests plus actual migration-50 production startup, strict negative checks and data-preserving restart.

The [rollback guide](deployment/local-rollback.md) records the pinned overlay, actual artifact and source/build hashes. Local preparation is complete; publication, exact-commit GitHub checks and hosted recovery acceptance remain required. Nothing was committed, pushed or deployed in this follow-up.
