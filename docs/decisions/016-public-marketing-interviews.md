# ADR-016: Public marketing and discovery interview requests

**Status:** Accepted

## Context

CareIQ needs a public website for founder-led discovery interviews before the product is available. The authenticated patient/appointment application must remain independently deployable. Interview contact details are business-contact data, not patient or practice-owned records.

## Decision

Add `apps/marketing` as a static-export Next.js App Router application using the same frontend versions, Tailwind setup, system typography and CareIQ visual tokens as `apps/web`. Keep the small token/control styles as a documented local adaptation; do not import another application's implementation or refactor the staff application. The repository previously had no implemented shared package. `packages/interview-contract` now shares stable role values, limits and dependency-free validation between marketing and API.

Informational pages never fetch the API. A browser submits only contact fields, a bounded retry key and honeypot to one exact public Express POST route. Register it and its preflight before Clerk, body parsing for authenticated routes, and tenant middleware. Existing product endpoints retain their authentication and tenant boundaries. No public reads, Next.js POST route, Server Action, email automation or scheduling integration are added.

Persist into a dedicated `marketing_interview_requests` table with PostgreSQL 18's existing UUIDv7 default. No practice foreign key or tenant context applies. The API uses one parameterized Drizzle insert with `ON CONFLICT (submission_key) DO NOTHING`, without `RETURNING`. A response only acknowledges completion; it contains no record ID or contact details. A new key represents a new submission, so email is not globally unique. The browser keeps the key for retries of the same payload in memory only.

Migration 0014 removes inherited default ACLs on this new table and creates a narrowly privileged non-login submission group. Grant its membership to the actual runtime role only through the checked operator script after verifying that role is not privileged or an owner. The group can insert and select only the submission-key column required by PostgreSQL's conflict target; it cannot read contact columns or update/delete records. Existing tenant policies and privileges are untouched. Owner/operator access remains a separate trusted operation.

Public request logs contain only server-created request IDs, outcome/status and duration. No clinical audit records are created; the current repository's domain audit system is planned, not implemented. There is no analytics, newsletter or localStorage persistence. Privacy notice copy describes this implementation and distinguishes hosting-level technical logging from application logs.

## Consequences

The site works without Clerk, an organization, API availability or database access. Missing submission configuration disables the form. Copy and public configuration are build-time inputs; there is no CMS.

The initial bounded in-memory limiter resets on restart and is per process, so deployment should use one API instance until a shared limiter is deliberately introduced. Trust no proxy by default; deployment must identify verified immediate proxy addresses/ranges before configuring trust. CORS is an origin interoperability rule, not bot protection.

Before public launch, the owner must supply a monitored privacy contact, approve data-handling/retention and operator practices, verify actual runtime grants and hosting proxy behavior, and complete a hosted smoke test. See [marketing guide](../marketing.md). No existing hosted service or domain is moved.
