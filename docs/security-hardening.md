# Security hardening and release operations

This document describes the implemented source and the work required to activate it safely. It does not certify the deployed configuration. See [release status](deployment/security-release-status.md) for what is actually live.

## Access rules

The owner selected the following baseline on October 2, 2026 (Pacific): Clerk organization administrators can read and create patients and appointments; ordinary organization members can read only. A member remains read-only even if a conflicting create permission is attached to that standard role. Custom roles require verified Clerk permissions named `org:patients:read`, `org:patients:create`, `org:appointments:read`, or `org:appointments:create`.

The API enforces access before calling a clinical service. `/api/v1/me` returns `data.capabilities.patients` and `data.capabilities.appointments`, each with `read` and `create` booleans. The web application uses those server-provided capabilities for its controls and read-only notice; missing capabilities fail closed. User and organization changes remount the workspace and clear pending request attempts.

`CORS_ORIGINS` also supplies Clerk's `authorizedParties` allowlist. Keep the exact working product origin in this variable before deploying. CORS alone is not authentication. Marketing CORS origins do not authorize public access to clinical endpoints: valid Clerk authentication, active organization and required permission are still necessary.

Production Clerk setup remains an account operation. Create/configure the production instance, domain records, OAuth providers, organization membership and matching API/web credentials together. Development users, organization IDs and practice mappings must be deliberately reconciled; replacing keys alone can disconnect users from their existing practice mapping. Do not remap organizations by matching a display name. Test sign-in, sign-out, redirects, admin creation, member write denial and two-practice isolation before cutting over.

## Safe clinical retries

Patient and appointment POSTs accept an optional `Idempotency-Key` UUIDv4 for older-client compatibility. The current web client supplies one. An attempt retains its key in component memory when the same normalized payload is retried after an uncertain result. Editing the payload creates a new key; successful submissions reset it. Tokens, keys and patient drafts are not saved to browser local storage or URLs.

Migration `0015_clinical-security.sql` creates `clinical_request_keys`. A request key is scoped to practice and operation. A transaction-level advisory lock serializes concurrent retries. The stored SHA-256 hash covers a canonical, normalized payload; the table stores a resource ID, not a duplicate patient/appointment response. Same key and payload returns the previously created resource. Changed payload returns HTTP 409 `IDEMPOTENCY_KEY_REUSED`. Resource creation, retry record and audit event commit atomically.

This protects retries of one attempt, not intentional duplicate requests with new keys. It does not prevent schedule conflicts. A page reload loses its in-memory key; an uncertain submission should be checked in the directory/calendar before starting a new attempt. No automatic key purge is included because removing keys weakens retry guarantees. Define retention alongside future record deletion and archival work.

## Clinical audit records

Migration 0015 also creates `clinical_audit_events`: practice, actor user ID, action, optional resource ID and server timestamp. Successful creates, retry reads and list reads are recorded inside the same tenant transaction. A failed audit insert fails the clinical transaction. No patient names, contact fields, appointment reasons, access tokens, credentials or raw request bodies are copied into these audit rows.

The API login receives INSERT only on audit records. It cannot read, update, delete or truncate them. Both new tables enforce forced RLS. A dedicated operator audit login may join `careiq_audit_reader` through the checked grant script. That credential can deliberately choose any authorized practice context; it is a platform operator credential, not a tenant-restricted staff account.

Example operator review, with an approved practice UUID:

```sql
BEGIN READ ONLY;
SELECT set_config('app.practice_id', '<approved-practice-uuid>', true);
SELECT actor_user_id, action, resource_id, occurred_at
FROM clinical_audit_events
ORDER BY occurred_at DESC
LIMIT 100;
COMMIT;
```

This is the first clinical audit implementation, not the entire future forensic architecture in ADR-010. List operations record a list event plus read events for queried resource IDs, including the pagination look-ahead row, without patient payloads. Database mutation triggers, denied-access event storage, an audit review UI, auditing of operator audit reads, immutable external archival and automated retention enforcement remain future work. Existing records have no retroactive audit history. The API table's append-only ACL cannot stop a database administrator from changing schema or data; operational access controls and backups remain necessary.

## Input, paging and browser protections

API limits are first/last name 120 characters each, email 254, phone 40 and appointment reason 1000. Invalid types, malformed email, oversized fields and unexpected control characters are rejected. Reason text permits tabs/newlines. Optional blank/null contact fields are normalized. Patient IDs and timezone-qualified appointment timestamps are validated.

Clinical list routes accept `limit` (default 100, maximum 100) and `offset` (0–1,000,000). Legacy requests without an explicit `limit` receive HTTP 409 `CLIENT_UPDATE_REQUIRED` if more records exist than fit in one page, so older browser tabs cannot silently show an incomplete directory/calendar. Otherwise, responses preserve `data: []` and add `meta: { limit, offset, hasMore, nextOffset }`. Database queries request at most 101 rows, including the look-ahead row. Tenant-leading sort indexes support the queries. The web client follows pages and deduplicates IDs so existing directory/calendar behavior does not silently lose records. It still loads the full working set; server-side search/date windows are a future scalability improvement. Offset pages are not a transactionally consistent snapshot while records are changing.

Protected API responses use `Cache-Control: no-store`; browser API requests also disable caching and have a 30-second timeout. Timing out a write does not prove that it failed to commit, which is why the retry key must be retained. The web sends framing restrictions, `nosniff` and a conservative referrer policy. Its CSP deliberately limits framing/object/base behavior without imposing an untested Clerk script-source policy.

Next.js and eslint-config-next are patched to 16.3.6; the workspace overrides `qs` to 6.16.0. Keep dependencies and lockfile together. The previously reported Next.js image-generation and qs advisories had no identified reachable path in the reviewed application; patching them removes the known vulnerable versions regardless.

## Controlled database rollout

1. Confirm the production database identity from the Render API service configuration. The local source checkout's `careiq_dev` connection is a different database from the recorded production `careiq_n8yp`; do not migrate whichever connection happens to be available.
2. Confirm a recent recoverable backup and migration history. Use a controlled maintenance window if index creation could block active writes. Rehearse migration and rollback behavior on a disposable copy. Never reset production.
3. Apply the migration runner from the complete reviewed release using separate migration/operator credentials. A production database through 0013 must receive both 0014 and 0015. Preserve its required TLS mode. Re-running the migration runner should be a no-op.
4. Prepare an existing dedicated non-owning API login with no superuser, BYPASSRLS, CREATEROLE, CREATEDB, replication, dangerous server-file/program rights, owner-role membership or audit-reader membership. Store its password in Render's secret environment settings, not Git or this document.
5. Apply the checked grant script to that login:

```sh
psql "$OPERATOR_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v runtime_role=actual_api_login \
  -f apps/api/src/db/grant-clinical-runtime.sql
```

6. If enabling marketing, run `grant-marketing-submitter.sql` with the same `runtime_role`. It grants only marketing insertion plus retry-key-column reads. The clinical and marketing scripts are tested together. They reject unsafe role/ownership/inherited/column-permission combinations instead of copying administrator permissions.
7. If audit review is needed, create/use a separate nonprivileged operator login and run `grant-audit-reader.sql` with `-v audit_reader_role=dedicated_audit_login`. Never give this membership to the API role.
8. Verify privileges and tenant behavior using the intended runtime login before switching Render `DATABASE_URL`. The runtime should read/insert its tenant clinical records, read/insert retry keys, insert audit rows, and be denied audit reads/updates/deletes and cross-tenant data access. Recheck effective membership after any later grant changes.
9. Coordinate a short maintenance window: deploy the API with the new schema and restricted runtime credentials, immediately deploy the new web UI, then require open browser tabs to refresh. Member writes now return 403. Older clients requesting an entire list receive an explicit refresh error when pagination is necessary. The new web fails closed if it reaches an older API without capabilities; do not restore traffic until both versions are verified together.
10. Verify health, anonymous denial, admin success, member denial, retry persistence, audit events and two-practice isolation with synthetic records. Keep marketing disabled until its separate acceptance checks pass.

If rollback is necessary, keep the application in maintenance or restricted access: the prior API removes the new admin/member enforcement, audit and durable retry guarantees. Preserve restricted runtime credentials when compatible and retain the additive tables, keys and audit rows. Do not drop them as a routine rollback. If runtime credentials must be restored during recovery, record that temporary exception and re-establish least privilege afterward. Never weaken TLS to make deployment succeed.

## Marketing and owner checklist

The intended mailbox is `kristian@careiqlabs.com`, monitored by Kristian. It was not confirmed operational during this work. Before enabling intake, create/test the inbox by receiving a message from another account and replying, and confirm who handles review, privacy requests, deletion, backups and retention. A separate privacy alias is optional; no mailbox has been created by this release.

After the mailbox is verified, configure marketing `NEXT_PUBLIC_PRIVACY_EMAIL`, `NEXT_PUBLIC_API_URL` and the canonical site URL, retain existing product CORS origins and add the intended marketing origins. Complete the migration and restricted grants, verify hosting proxy addresses for `TRUSTED_PROXY_CIDRS`, and enable API `INTERVIEW_REQUESTS_ENABLED=true`. Rebuild marketing and verify one synthetic submission, same-key retry and operator cleanup. The initial limiter remains per-process: use one API instance until a shared limiter is implemented. Only then enable public indexing. The form saves a request; it does not email, book a calendar slot or subscribe a newsletter automatically.

## Verification and release gates

Run frozen installation, lint, type checks, unit/HTTP tests, disposable PostgreSQL integration tests, production builds and `pnpm audit --prod`. GitHub Actions performs these checks, including two migration runs, on pushes and pull requests. Configure the `verify` job as a required branch check and enable an appropriate Render deployment gate through authorized account settings; merely adding a workflow does not configure those controls.

See [verification](verification.md) for actual local/CI results and explicit hosted gaps. A green build cannot establish production-role safety, working email, backup recovery or authenticated browser behavior.
