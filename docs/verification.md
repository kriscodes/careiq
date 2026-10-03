# Verification — September 21, 2026

## Historical baseline — before the v0.1 design integration

Completed on the earlier local checkout. These results are preserved as history and do not certify the subsequent UI changes:

- Frozen-lockfile workspace installation.
- API and web type checks and lint checks.
- API and Next.js production builds.
- Appointment input-validation regression tests.
- Full migration replay on an empty disposable PostgreSQL 18 database; second run succeeded without reapplying changes.
- Database integration tests under a temporary role without superuser or RLS bypass: own-practice positive reads, cross-practice read/update/delete denial, forged-tenant insert denial, cross-practice patient-reference denial, and empty-context read/write denial. Fixtures and the test role were rolled back.
- Local web returned HTTP 200; API health confirmed database connectivity; unauthenticated patient request returned HTTP 401.

Not verified by these checks:

- Signed-in browser walkthrough and visual review. Automated browser access was blocked by an unavailable admin policy check.
- Hosted deployment smoke test or hosted application of migration 0013. The configured shared database was not migrated during this review.
- The System Flow panel was not implemented at this baseline. Role-specific permissions, audit history, and clinical workflows were also outside these checks.

## v0.1 interview design integration

The integration adds the light front-desk workspace, centered dialogs, consistent dropdown styling, and a separate static architecture panel. The panel's label is “Illustrated architecture — not live telemetry.” This is explanatory UI, not a new source of runtime verification.

Completed against the integrated local checkout:

- `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed for API and web.
- `pnpm test` passed both API validation tests. The database isolation test was skipped because no disposable `TEST_DATABASE_URL` was configured for this UI-only pass; the earlier PostgreSQL results above remain historical.
- Focused component checks covered trimmed patient payloads, required names/email validation, pending controls, duplicate-submit protection, error retention, practice-scoped patient selection, and appointment time conversion. Date checks included impossible dates, leap dates, daylight-saving gaps, repeated autumn hours, and explicit UTC payloads. These were isolated checks, not a signed-in browser run.
- Inline mockup interaction checks passed for search, practice switching, selection, patient creation during booking, draft restoration, booking, and architecture notes. No `ResizeObserver` or JavaScript layout resizing was introduced.
- Local web returned HTTP 200 and included the v0.1 reviewer label. API health returned 200; unauthenticated patient access returned 401.
- The development response includes reviewer notes; the default production build's static page excludes them. Explicit flag overrides still need a browser smoke check.
- Source review confirmed reads and mutations request a token for the mounted organization. Practice changes remount the workspace and ignore late responses.
- Documentation links and `git diff --check` passed.

Still pending:
- [ ] Signed-in browser walkthrough: create/search patients, schedule visits, navigate dates, refresh persistence, and switch practices.
- [ ] Dialog centering, dropdown borders/chevrons, narrow layouts, keyboard focus, and pending/error states.
- [ ] Browser-local timezone labels and appointment date/time consistency.
- [ ] Reviewer flag overrides: explicit `false` off and explicit production build-time `true` on.
- [ ] Hosted smoke test, deployed migration state, runtime database role, and two-practice isolation demonstration.

Browser inspection was blocked by an unavailable admin-enforced security check. No bypass was used. Signed-in visual acceptance and hosted checks remain open. The configured shared database was not migrated, and this change was not deployed.

See [development and deployment](development.md) for reproducible commands, the [design specification](design/interview-v0.1.md) for UI acceptance, and [interview architecture](interview-architecture.md) for the implementation boundaries. These checks establish a tested baseline, not a guarantee of zero bugs.


## Pre-push review — September 22, 2026

Completed on the final v0.1 checkout before commit:

- Frozen-lockfile install, standalone API/web type checks, lint, and both production builds passed.
- All **7 tests passed, none skipped**: four database TLS configuration tests, two input-validation tests, and the tenant-isolation integration test.
- Replayed all 14 migrations on a fresh disposable PostgreSQL 18 database. A second migration run succeeded without reapplying changes.
- Ran the isolation suite under a temporary non-superuser, non-bypass role against that disposable database; all fixtures and the role were rolled back.
- Fixed a review finding where PostgreSQL URL query parameters could override the selected TLS mode. Conflicting SSL parameters now fail at startup with an actionable message that does not expose credentials.
- Read-only inspection of the database configured for the local API confirmed PostgreSQL 18, verified TLS connectivity, a non-superuser/non-bypass runtime role, and enabled/forced RLS on patients and appointments. This checks the local API configuration, not an independently verified Render environment.
- That configured database has migrations through **0012** (13 entries). **0013 remains to be applied through the deployment migration step.** No shared database schema or data was changed during the pre-push review.
- Scanned repository files for common credential patterns; no candidate secrets found. Environment files and build outputs are ignored by Git.
- Independent API and web source reviews found no remaining code blocker after the TLS fix.

Push target is the checkout's existing upstream, `origin/dev`. No Render deployment status or linked service configuration was available from GitHub during this review. Pushing the branch is not evidence of a successful deployment. Confirm the actual Render branch and service settings before treating the deployment as complete.

For the hosted interview build, verify `NEXT_PUBLIC_INTERVIEW_MODE=true`, the hosted API URL and Clerk public settings at build time, allowed CORS origin, verified database TLS settings, and controlled application of migration 0013. Complete the signed-in two-practice and visual walkthrough against the deployed URL. Browser inspection remains pending because the admin security check was unavailable during the UI work.


## Security remediation — October 3, 2026 UTC

These results supersede the historical source-level limitations above, without certifying production configuration:

- All 79 API tests passed on disposable PostgreSQL 18.6 with zero skips, including tenant isolation, admin/member permissions, real signed-token verification, safe runtime/reviewer grants, concurrent durable retries, audit metadata, marketing protections and recovery after a database connection is terminated. The final pagination-upgrade regression verifies that older browser tabs receive a refresh error instead of silently losing records.
- All 13 web tests, 8 marketing tests and 3 shared interview-contract tests passed: 103 tests total, no skips.
- Workspace lint, type checks and API/web/marketing production builds passed on patched dependencies. `pnpm audit --prod` reported zero known vulnerabilities.
- All 16 migrations replayed on an empty disposable database; a repeated migration run was a no-op. No production database was migrated.
- The no-migration hotfix passed GitHub CI before merge in PR #3 and again on main (`82d93cb`). Live web returned the new security headers; API health reported database connected. API health alone cannot verify its running commit.
- A scan of the reviewed repository and reachable Git history found no confirmed exposed credentials. This is not a guarantee that accounts or historical external systems contain no leaks.

Still pending: production database identity/role/migration verification; release 2 deployment; signed-in browser and two-practice walkthrough; Clerk production configuration; email receipt/reply testing; backup/restore and retention operations. Browser automation could not initialize its administrator policy, and no workaround was used. Marketing intake/indexing remain disabled. See [current release status](deployment/security-release-status.md) and the [rollout runbook](security-hardening.md).
