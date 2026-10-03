# Marketing implementation verification — October 2, 2026

Checks were performed in an isolated working copy containing the source checkout's existing uncommitted changes. Implementation changes were then applied back to `/Users/kristian/Documents/Server/CareIQ`. The final marketing build, workspace lint/typecheck, and complete test suite also passed directly in the source checkout. The pre-existing API TLS comments, health-before-Clerk behavior and development documentation edits were preserved. No framework/package-manager upgrades were made; the lockfile adds only the marketing and shared-contract workspace dependencies.

## Commands and outcomes

| Check | Outcome |
| --- | --- |
| `pnpm install --frozen-lockfile --offline --store-dir /Users/kristian/Library/pnpm/store` | Passed after initial metadata resolution; lockfile unchanged. |
| `pnpm lint` | Passed API, existing web, marketing and shared contract. |
| `pnpm typecheck` | Passed all four packages. |
| `TEST_DATABASE_URL=<confirmed disposable localhost URL> pnpm test` | Passed all API/contract/marketing checks. Final counts: API 39 (including 19 nested unsafe-role cases), marketing 8, contract 3; 50 total, no skips. |
| `pnpm --filter @careiq/marketing... build` | Passed; homepage, privacy, 404, icon, robots and sitemap exported. No API, database or Clerk environment variables supplied. |
| `pnpm --filter ./apps/web build` | Passed with synthetic public API/Clerk build settings; existing web source unchanged. |
| `pnpm --filter ./apps/api build` | Passed. |
| `DATABASE_URL=<confirmed disposable localhost URL> DATABASE_SSL_MODE=disable node --import tsx src/db/migrate.ts` (API directory), twice | All 15 migrations replayed successfully; second run no-op. |
| `git diff --check` | Passed. |

Initial Next builds through the package script encountered an execution-environment local-worker binding restriction. Directly invoking the installed compiler (`node node_modules/next/dist/bin/next build`, in each frontend directory) with permitted process access passed; subsequent documented pnpm build commands also passed. The initial web build without its required public API setting failed as expected; its configured synthetic build passed. No real Clerk or hosted API service was needed for build verification.

## Real persistence and permissions

Created a dedicated disposable PostgreSQL 18 Docker container bound only to `127.0.0.1:55439`, database `careiq_test`. No existing/shared/provisioned CareIQ database URL was used. Integration tests refuse non-local hosts and database names other than `careiq_test`/`careiq_review`.

The database tests use an actual separate LOGIN role with no superuser/BYPASSRLS privileges, the version-controlled operator grant script, real Drizzle writes and real HTTP requests. They verify committed insertion, concurrent key retries produce one row, same-email/new-key requests remain allowed, UUIDv7/defaults/constraints, denied contact reads/update/delete/truncate/RETURNING, and safe responses/logs. The role can read only the opaque submission-key column needed by PostgreSQL's conflict target.

Unsafe-role regressions reject superuser, BYPASSRLS, role/database creation, replication, table/schema/database owners, owner membership, inherited contact reads/deletion, access reachable only through SET ROLE, ADMIN-only membership that can restore INHERIT/SET, dangerous server-file/program roles, and column-only UPDATE/REFERENCES of retry keys. Fixtures roll back; no test roles survive.

Before migration, a synthetic default-grant role was granted broad rights on newly created tables. After migration, its marketing contact SELECT/UPDATE/DELETE were false while its existing patient SELECT remained true. This verifies ACL cleanup affects only the new table. The existing A/B tenant-isolation suite passed, including forged writes, cross-practice references and missing tenant context. Existing tenant forced RLS remains enabled.

## Built API boundary

Against the built local API with synthetic Clerk settings and the disposable database:

- `/api/v1/me` GET, `/api/v1/patients` GET/POST and `/api/v1/appointments` GET/POST returned 401 `UNAUTHENTICATED`.
- Interview GET and an unrelated public POST path returned 404; no public list/read operation exists.
- The actual public form also submitted successfully while the API had **no Clerk keys**, because this one route precedes Clerk middleware.
- HTTP tests cover malformed JSON, wrong content type/encoding, oversized/invalid/unknown fields, honeypot, rate-limit expiration/global quotas, default forwarding-header distrust, CORS normalization, disabled submission, committed success timing and generic database failures.

## Browser and static export

Used the in-app browser for desktop 1440px and mobile 390px inspection; checked privacy at 320px. No horizontal overflow. Verified mobile menu Enter/Escape, restored toggle focus, section links, visible input focus, validation focus on the first invalid field, and accessible status messages.

A synthetic browser request committed one row and showed the promised confirmation. Stopping the local API produced a recoverable error with values retained; restarting it and retrying succeeded. Exhausting the local limiter showed the rate-limit state with values retained. Test-only contact details were never sent to an external service. A no-JavaScript regression verifies the server-rendered form is disabled until hydration and explicitly uses POST, preventing native GET submission of details into URLs.

The final export was rebuilt with no submission configuration. Its form showed unavailable while all informational pages remained functional. A static-file preview returned 200 for `/`, `/privacy` and `/privacy/`, and custom-page HTTP 404 for a nonexistent path. Robots disallowed indexing; metadata was noindex; sitemap was non-indexing. Exported HTML/JavaScript scan found no database URLs, Clerk secret/config modules or database environment variables. Screenshots were saved with this task's outputs (desktop/mobile homepage, privacy, and synthetic rate-limit state).

## Not verified or performed

- Hosted runtime credentials, role ownership/membership, migration status, proxy addresses, DNS/TLS, Render routing/404 behavior and actual deployed CORS. These require an authorized hosted smoke test; local tests do not certify them.
- Signed-in staff-application browser flows (unchanged source). Its build/typecheck/lint and existing tenant tests passed.
- Distributed rate limiting: initial limiter is deliberately process-local and resets on restart.
- Production migration, deployment, DNS modification, email delivery, or paid provisioning. None performed.

Public launch remains blocked on a real monitored privacy contact and confirmed data-handling/retention/access operations, plus the deployment prerequisites in [marketing guide](marketing.md). Optional founder social/photo/application links are not blockers.
