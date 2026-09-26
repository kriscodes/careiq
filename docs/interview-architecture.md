# Interview architecture notes

This is the source-backed companion to **v0.1 — Interview Design**. The reviewer panel presents an illustrated request flow. It does not instrument requests, measure latency, expose payloads, or demonstrate isolation by itself.

The scope is a complete, small workflow: authenticated staff select a practice, create/read patients, create/read appointments, and see persisted results isolated by practice. See the [design baseline](design/interview-v0.1.md), broader [architecture](architecture.md), and [development guide](development.md).

## The real request path

```mermaid
sequenceDiagram
    actor Staff
    participant Web as Next.js / React
    participant Clerk
    participant API as Express / TypeScript API
    participant DB as PostgreSQL via Drizzle
    Staff->>Web: Sign in and select an organization
    Web->>Clerk: Obtain session token
    Clerk-->>Web: Token for authenticated session
    Web->>API: GET /api/v1/me + bearer token
    API->>API: Verify identity and active organization
    API->>DB: Find or provision mapped practice
    API-->>Web: Current practice
    Web->>API: Patient or appointment request + bearer token
    API->>API: Derive practice from verified organization
    API->>API: Validate request input
    API->>DB: Begin transaction; set local app.practice_id
    DB->>DB: Enforce RLS and relational constraints
    DB-->>API: Authorized rows / committed result
    API-->>Web: JSON result or controlled error
    Web-->>Staff: Current practice data and feedback
```

Clerk middleware verifies request authentication. The web workspace requests tokens for the organization that opened it, so a practice switch cannot reassign an in-flight form to another organization. The application does not accept a browser-supplied practice ID as its tenant authority. `/api/v1/me` provisions a practice when the authenticated Clerk organization has no mapping; subsequent patient/appointment middleware resolves that mapping. The diagram describes normal behavior, not the outcome of any particular demo request.

## Implemented panel narrative

`apps/web/src/components/InterviewNotes.tsx` defines the reviewer bar and the six static explanation steps. `PracticeWorkspace.tsx` opens them in `InterviewModal.tsx`. `apps/web/src/app/page.tsx` controls visibility through `NEXT_PUBLIC_INTERVIEW_MODE`: on by default in development unless `false`, off in production unless `true` at build time. This flag changes presentation only.

| Step | Explanation | Source |
| --- | --- | --- |
| 1. Staff action | React collects the patient or visit details and obtains a Clerk token. The shared API client sends the token as a bearer credential. | `apps/web/src/lib/api/client.ts` |
| 2. Verified identity | Clerk verifies the session. Protected routes require a signed-in user and an active organization. | `apps/api/src/index.ts`, `apps/api/src/middleware/tenant-context.ts` |
| 3. Resolved practice | CareIQ maps the verified organization to an internal practice. `/me` can provision the mapping before tenant-scoped reads. | `apps/api/src/services/practice.service.ts` |
| 4. Validated operation | The API checks required names or the appointment patient ID and timestamp. Appointment creation also looks up the patient within the tenant transaction. | `apps/api/src/index.ts`, `apps/api/src/validation.ts`, `apps/api/src/services/appointment.service.ts` |
| 5. Isolated transaction | Drizzle executes inside a transaction with local `app.practice_id`. PostgreSQL policies restrict rows; relational constraints preserve patient/practice consistency. | `apps/api/src/db/with-tenant.ts`, `apps/api/drizzle/0013_tenant-context-empty.sql`, `apps/api/src/db/schema/appointments.ts` |
| 6. Updated workspace | The API returns created/listed records or a controlled error. The UI updates only the current practice workspace. | API route handlers and web workspace components |

The bar says **Interview demo · Developer notes** and **v0.1 — Interview Design · Outside the staff application**. The dialog is titled **Behind the front desk**, with **DEVELOPER NOTES · INTERVIEW DEMO** and **Illustrated architecture — not live telemetry**. It discloses that the running application saves real records and asks reviewers to use synthetic data. Do not label these steps as live events or add invented durations. Do not expose session tokens, credentials, database URLs, patient payloads, or full error objects in the notes.

## Why these boundaries exist

**Next.js and a separate API.** The web app presents forms and records; the API owns tenant resolution, validation, and data operations. Other clients could use the same versioned endpoints. This slice does not require microservices.

**Clerk identity and CareIQ practice mapping.** External identity handles sign-in and the active organization. CareIQ keeps an internal practice ID for domain relationships. This currently establishes the practice boundary; granular staff roles and CareIQ membership administration are not implemented.

**Transaction-scoped context.** `withTenant` opens a transaction and calls `set_config('app.practice_id', practiceId, true)`. The final `true` makes the setting transaction-local, so a pooled connection does not retain that tenant context for a later transaction. Tenant-scoped queries must use the provided transaction, not the global database client.

**Database enforcement.** Patients and appointments use forced row-level security. Policies compare each row's practice ID with the transaction context for reads and writes. Migration 0013 treats a missing or empty context as no matching practice. An appointment also has a composite foreign key to `(patient_id, practice_id)`, preventing a patient/practice mismatch at the relational boundary.

RLS must run under a database role without superuser or `BYPASSRLS` privileges. The policy files and UI demonstration are not substitutes for verifying the deployed role and applying migrations.

## Current API surface

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Checks database connectivity; returns 503 on failure. It is not a full authentication or tenant-isolation test. |
| `GET /api/v1/me` | Requires authentication and an active organization; resolves or provisions its practice. |
| `GET /api/v1/patients` | Lists patients within the resolved practice. |
| `POST /api/v1/patients` | Creates a patient with required first/last name and optional email/phone. |
| `GET /api/v1/appointments` | Lists appointments within the resolved practice. |
| `POST /api/v1/appointments` | Creates a scheduled appointment for a patient in that practice. |

The API assigns the practice ID. Appointment timestamps are stored with timezone support. The v0.1 UI presents them in the browser's visibly labeled local timezone. A practice-specific timezone is not yet modeled.

## Demonstrated capability versus remaining work

| Area | Current implementation | Remaining boundary |
| --- | --- | --- |
| Authentication | Clerk session and active organization | Granular role permissions and membership administration |
| Patients | Create/list; UI search over loaded records | Edit/delete, pagination, richer validation and record lifecycle |
| Appointments | Create/list; UI day/week navigation | Rescheduling/cancellation, provider availability, duration, conflict prevention, reminders |
| Isolation | Tenant middleware, transaction context, RLS, composite patient relationship | Verify migrations and runtime role in each deployed environment |
| Time | Timestamp persistence and browser-local presentation | Practice timezone, explicit ambiguous daylight-saving time handling |
| Reviewer notes | Static, source-backed explanation | Sanitized live tracing or measured timings if a later design requires it |
| Operations | Connectivity health check and controlled error logging | Domain audit history, background jobs, EHR integrations, and production operational controls |

The UI must not offer actions or status transitions that have no corresponding API behavior. It must not imply that an open appointment time is conflict-free. “Scheduled” reflects the stored appointment status; it does not mean that a provider, room, or external calendar accepted the booking.

## Local and interview runbook

Use the full [development and deployment guide](development.md) for prerequisites and environment variables. The essential local sequence, from the repository root, is:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The usual web URL is `http://localhost:3001`; the API is `http://localhost:3000`. Configure the environment files before starting. Run migrations for a new database using the guide's controlled procedure. Never reset a shared database to rehearse the demo.

The live application writes to the configured database, even when both servers run locally. Use two authorized Clerk organizations and clearly synthetic patient names for the walkthrough. The standalone HTML mockup has fictional, in-memory records and does not exercise authentication, API writes, or RLS.

1. In Practice A, add a synthetic patient and schedule an appointment at a clearly noted local date/time.
2. Refresh and sign out/back in to show persistence.
3. Switch to Practice B, confirm A's records are absent, add B's own records, then return to A.
4. Open the separately labeled architecture notes. Explain the trusted organization mapping and the transaction/database enforcement boundary.
5. Point to independent verification results. A clean-looking screen cannot establish security; tests should include deliberately forged cross-practice requests/inserts and a non-bypass database role.

## Validation and deployment handoff

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` after integration. The database isolation suite is optional unless a migrated disposable `TEST_DATABASE_URL` is configured. A passing ordinary unit run must not be described as a database-isolation run.

For the browser, verify sign-in, organization switching, patient creation/search, scheduling, persistence, pending/error states, timezone display, centered dialogs, and keyboard behavior. For hosting, additionally confirm build-time public API/Clerk settings, permitted web origins, Clerk domains/redirects, migration state, `/health`, and the runtime database role, then repeat the authenticated two-practice walkthrough.

The [verification record](verification.md) separates the earlier database baseline from checks on this design integration. Type checks, lint, API unit tests, and the production build passed; signed-in browser and hosted acceptance remain pending. Record later results with the environment and date. Neither the v0.1 label nor successful builds establish production readiness or healthcare compliance.

## Architecture decision references

- [API-first platform](decisions/002-api-first-platform.md)
- [Multi-tenant SaaS](decisions/004-multi-tenant-saas.md)
- [Authentication and authorization](decisions/005-authentication-authorization.md)
- [Tenant data isolation](decisions/007-multi-tenant-data-isolation.md)
- [Database access layer](decisions/008-database-access-layer.md)
- [API architecture and versioning](decisions/011-api-architecture-and-versioning.md)
- [Deployment and infrastructure](decisions/015-deployment-and-infrastructure-architecture.md)

ADRs describe decisions and intended direction. Use the source mapping and explicit remaining-work table above when discussing what the interview slice actually implements.
