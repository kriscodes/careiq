# Development and deployment

## Requirements

- Node.js 22.23 or later in the Node 22 LTS line.
- pnpm 11.22.0 (the version declared in the root package.json).
- PostgreSQL 18: the schema uses the built-in `uuidv7()` function.
- A Clerk application with Organizations enabled.

Run commands from the repository root unless stated otherwise.

## Local setup

1. Run `pnpm install --frozen-lockfile`.
2. Copy `apps/api/.env.example` to `apps/api/.env` and fill in database and Clerk credentials.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in Clerk credentials from the same Clerk application.
4. For a new development database, run `pnpm --filter ./apps/api db:migrate` with a migration-capable database role.
5. Run `pnpm dev`. API: http://localhost:3000. Web: http://localhost:3001.
6. Sign in, then select or create a Clerk organization. CareIQ creates the corresponding practice through `/api/v1/me` before loading tenant data.

Local application servers use the database selected by `DATABASE_URL`; local servers do not imply a local database. Use synthetic demo data.

## Configuration

| Application | Variable | Purpose |
| --- | --- | --- |
| API | `DATABASE_URL` | PostgreSQL connection string. Never expose it to the browser. |
| API | `DATABASE_SSL_MODE` | `verify-full` (default) verifies trusted database certificates; use `require` for Render internal PostgreSQL connections, which use self-signed certificates. `require` encrypts without certificate verification. `disable` is for local PostgreSQL without TLS. SSL/certificate query parameters in `DATABASE_URL` are rejected; configure TLS only through `DATABASE_SSL_MODE`. |
| API | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Backend Clerk authentication. |
| API | `CORS_ORIGINS` | Comma-separated exact web/marketing origins; trailing slashes are normalized. Local default: `http://localhost:3001,http://localhost:3002`. Explicit origins are required in production. |
| API | `PORT` | Listening port, default 3000; hosting providers may supply it. |
| Web | `NEXT_PUBLIC_API_URL` | API origin, locally `http://localhost:3000`. |
| Web | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Frontend/server Clerk configuration. |
| Web | `NEXT_PUBLIC_INTERVIEW_MODE` | Reviewer bar and static architecture notes. Defaults on in development unless exactly `false`; defaults off in production unless exactly `true`. Set it in the build environment for hosted interview demos. |

Next.js embeds `NEXT_PUBLIC_*` values during the build. Rebuild after changing them. Configure Clerk domains and redirect URLs for the hosted web address. Keep secrets in ignored local files or hosting environment settings.

The interview flag changes only the visibility of reviewer tools. It is not an authorization boundary or a mock-data mode. A production interview build requires `NEXT_PUBLIC_INTERVIEW_MODE=true` during `pnpm build`; changing it only when starting an already-built web service does not update that build.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Unit tests cover API input validation. The optional `tenant-isolation.test.ts` suite runs when `TEST_DATABASE_URL` names a migrated disposable local `careiq_review` or `careiq_test` database. It needs a test administrator able to create roles, then executes checks under a temporary role without RLS bypass. Fixtures and the role are rolled back. Example: `TEST_DATABASE_URL=postgresql://...@127.0.0.1:55432/careiq_review pnpm --filter ./apps/api test`. They do not prove authentication, RLS, or hosted browser behavior. `GET /health` executes a database connectivity check and returns 503 if it fails.

## Database migrations and isolation

The API owns Drizzle migrations under `apps/api/drizzle`. Generate changes with `pnpm --filter ./apps/api db:generate`; inspect the SQL and journal before applying. Run migrations as a controlled deployment step before starting the new API version. Do not run schema migration commands automatically on every API request or startup.

The runtime database role must not be a superuser or have `BYPASSRLS`. Both tenant tables use forced RLS. Each tenant operation sets `app.practice_id` inside its transaction. A composite foreign key also prevents appointments from referring to another practice's patient.

Migration replay repairs: 0004 now replaces the already-existing patient policy; 0005 is a retained no-op because appointments are not created until 0006. Appointment RLS is applied in 0008/0010. Existing journal identifiers/timestamps are preserved. Migration 0013 makes missing/empty tenant context return no rows rather than fail while casting an empty UUID. The historical repairs affect fresh replay; already migrated databases receive the new 0013 migration.

Test migration replay on a disposable PostgreSQL 18 database, never by resetting the shared development database. Run the migration runner twice to confirm the second run is a no-op. Verify A/B read, update, delete, mismatched tenant insert, cross-practice patient reference, and empty-context cases using a role without RLS bypass.

The older `src/db/test-*-rls.ts` utilities require existing fixture practices and write persistent records. They are manual diagnostics, not the unit suite, and must only target a disposable database. They are not sufficient proof of the entire security boundary.

## Render deployment

Use the repository root as the working directory for both services so the workspace lockfile is used.

| Service | Build command | Start command |
| --- | --- | --- |
| API | `pnpm install --frozen-lockfile && pnpm --filter ./apps/api build` | `pnpm --filter ./apps/api start` |
| Web | `pnpm install --frozen-lockfile && pnpm --filter ./apps/web build` | `pnpm --filter ./apps/web exec next start --hostname 0.0.0.0 --port "$PORT"` |

Set the API environment variables, the hosted web origin in `CORS_ORIGINS`, and the hosted API origin in the web build environment. Use `/health` as the API health path. Run `pnpm --filter ./apps/api db:migrate` as the controlled pre-deploy migration step with migration credentials. Runtime credentials should have only the permissions needed to operate the application.

### Database TLS on Render

For a Render API service connecting to PostgreSQL through its **internal URL**, set `DATABASE_SSL_MODE=require` in the API service's environment. Render's internal connections use self-signed certificates and do not support certificate verification. This setting requires encryption without verifying the certificate. See [Render's internal connection guidance](https://render.com/docs/postgresql-creating-connecting#ssl-modes-for-internal-connections).

Keep `DATABASE_SSL_MODE=verify-full` for external endpoints with certificates trusted by Node.js. Use `disable` only for local PostgreSQL without TLS. When the migration command uses the same internal database URL, give it the same `DATABASE_SSL_MODE=require` setting.

CareIQ already supports these modes; no runtime code change is needed. Remove SSL query parameters such as `sslmode` from `DATABASE_URL`: the API rejects them so they cannot override `DATABASE_SSL_MODE`.

If a deployed API logs `DEPTH_ZERO_SELF_SIGNED_CERT` after successfully building and starting:

1. Confirm that `DATABASE_URL` is the Render database's internal URL.
2. Set `DATABASE_SSL_MODE=require` on the API service, save the environment change, and redeploy.
3. Check `/health`. Once the database connection succeeds, it should return HTTP 200 with `"database":"connected"`. If it still fails, inspect the new database error before making further changes.

A successful build and startup followed by this certificate error points to database TLS configuration. Earlier repository-access or Node-version warnings are not the cause of this certificate error.

## Interview demo acceptance

1. Sign in and select Practice A.
2. Create a synthetic patient; confirm the appointment dropdown includes that patient immediately.
3. Schedule an appointment, refresh, then sign out/back in; confirm it persists.
4. Switch to Practice B; confirm A's patients and appointments disappear.
5. Create B's data and switch back to A; confirm isolation in both directions.
6. Repeat in the hosted environment and verify the runtime database role and RLS tests.

The static architecture panel is implemented in the separate interview reviewer bar. It is labeled “Illustrated architecture — not live telemetry,” discloses that application actions save real records, and does not display patient payloads, credentials, or fabricated timings. Open it during the walkthrough to explain the flow; use tests and the A/B demonstration as separate evidence.

The [v0.1 design specification](design/interview-v0.1.md) includes visual and keyboard acceptance checks. The [interview architecture notes](interview-architecture.md) map the explanation to source files and document scope limits. Browser-local timezone labels must match displayed and submitted appointment dates. Patient search and date navigation operate on the current practice's loaded records.

Live tracing, role-specific authorization, provider availability/conflict prevention, audit history, clinical workflows, and EHR integrations are not implemented by this slice. Local builds and unit tests do not establish production readiness or healthcare compliance. Record checks for the final integrated build in [verification](verification.md); previous results do not certify subsequent changes.

## Public marketing application

See [marketing setup, content, API contract and launch guide](marketing.md) and [marketing verification](marketing-verification.md). `pnpm --filter @careiq/marketing dev` runs on port 3002 independently of Clerk, the API and database. Its static build publishes `apps/marketing/out`; the interview form posts to the existing API only when configured. Migration 0014 and checked runtime-role membership are prerequisites for enabling submissions.
