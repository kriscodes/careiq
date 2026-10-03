# Security release — October 3, 2026 UTC

This first release fixes the database-pool crash and web framing protection without requiring a production database migration. It updates Next.js and its lint configuration to 16.3.6 and pins the transitive `qs` dependency to 6.16.0. The API pool now handles idle connection errors using sanitized logs; PostgreSQL removes the broken connection, and a later query can reconnect.

The web application sends `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`. This framing policy does not restrict Clerk's scripts or callbacks. It is not a complete script-source CSP.

## Verification

- Lint, type checks, API build and web production build passed.
- Nine API tests passed with no skips on disposable PostgreSQL 18.6, including a real idle-connection termination followed by a successful query, sanitized error logging, and existing tenant isolation.
- All 14 baseline migrations replayed on the disposable database; a second run succeeded without reapplying them.
- The production dependency audit reported zero advisories after the updates.
- The new GitHub Actions workflow installs the frozen lockfile, applies migrations twice to disposable PostgreSQL, runs lint/type checks/tests/builds, and checks production dependency advisories. Required branch checks and hosting deployment gates still depend on repository/Render settings.

## Remaining work from the audit

The complete clinical-security release is implemented in [draft PR #5](https://github.com/kriscodes/careiq/pull/5) and awaits a controlled production migration and runtime-role change. All 103 tests passed without skips, all 16 migrations replayed safely on disposable PostgreSQL 18.6, and GitHub verification passed. Its [rollout runbook](https://github.com/kriscodes/careiq/blob/codex/security-fixes/docs/security-hardening.md) covers grants, coordinated API/web deployment, browser refresh requirements, audit review and rollback limitations. It adds durable request retry keys, admin-only patient/appointment creation, bounded list responses, input validation and append-only clinical access/change events. The owner selected: administrators create records; ordinary members view records.

Production currently needs a verified non-owning runtime database login. A previous deployment inspection recorded `careiq_owner` with database ownership and role/database creation privileges. That historical finding is not a fresh verification of the current API credential. Do not substitute the separate local `careiq_dev` database for the production database.

Clerk production-instance setup and a hosted signed-in, two-practice walkthrough remain required. Existing public development publishable keys are not secret leaks. They do not replace a deliberate production authentication setup.

The marketing website works on `careiqlabs.com` and `www.careiqlabs.com`; www redirects to apex. Its interview form remains disabled. `kristian@careiqlabs.com` is the proposed monitored contact, but the owner still needs to set up or test that inbox. Keep intake and indexing disabled until mailbox, production schema/grants, API/CORS/proxy configuration, and hosted submission checks are complete.

## Deployment and rollback

This release changes no schema, secrets or clinical permissions. Existing Render services should rebuild the updated tracked branch with their current public and private configuration. A Git merge alone is not proof of deployment: verify the Render release, API `/health`, signed-out protected endpoints and web response headers.

To roll back this first release, redeploy the prior commit through Render. No schema rollback is needed. Do not apply this advice to a later release with new migrations; keep additive schema and audit records when rolling application code back.

The deployment browser was unavailable during preparation because its administrator policy could not be verified. No security bypass was attempted. Owner-only account settings and production credentials must be completed through restored authorized access.


## Observed release status and owner actions

- [PR #3](https://github.com/kriscodes/careiq/pull/3) merged to main as `82d93cb`; GitHub verification passed before and after merge. The live web now returns the new security headers, hides the powered-by header and reports Next.js 16.3.6 in its public runtime.
- [PR #4](https://github.com/kriscodes/careiq/pull/4) merged to the marketing deployment branch as `d0748b5` after passing GitHub checks. Both the Render origin and careiqlabs.com now serve Next.js 16.3.6. The disabled form, noindex and HTTPS behavior remain intact.
- The live API health endpoint returns 200 with database connected; anonymous clinical requests were denied. Its exact deployed revision and runtime database role cannot be independently verified without Render access.
- The complete DB/API/WEB permissions, durable retry and audit changes in PR #5 are **not deployed**. No production database was migrated in this task. Production credentials were unavailable, and the accessible local configuration points to the separate development database.

The owner needs to:

1. Set up/test `kristian@careiqlabs.com`: receive an external test email, reply, and confirm regular monitoring. This address is suitable for initial interview and privacy/deletion requests once operational. No email notifications are sent automatically by the intake form; submissions require operator review.
2. Restore authorized Render and Clerk access so the production database, restricted runtime login, migrations and authentication setup can be completed. Do not paste passwords or keys into chat, Git or documentation.
3. Confirm production organization/user mappings and the backup/restore, request-review, retention and deletion process. Complete the signed-in admin/member and two-practice acceptance checks after deployment.

No remaining issue is known to be inherently unfixable. The outstanding work depends on account access, the production rollout and mailbox/operational setup. Builds, tests and scans do not establish that every live workflow works or guarantee the absence of leaks.
