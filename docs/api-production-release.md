# API production release checks — October 6, 2026

These safeguards are implemented in the canonical checkout. Local verification passed; no hosted database migration, remote deployment or commit was performed. Production configuration and hosted/device acceptance remain separate release requirements.

October 18 integration: the current 36-migration history through `0035` is preserved byte-for-byte and verified on isolated databases. See [PR #10 verification and operator handoff](verification/pr-10-main-2026-10-18/README.md). The dated counts below describe the October 6 baseline; no hosted migration or deployment is inferred.

October 20 hosted promotion: API and web are live on main `4557ba1`; the current backup was restored and rehearsed before the hosted 16 → 43 migration, restricted runtime checks and deployed production preflight. See [Render deployment repair and verification](verification/render-production-2026-10-20/README.md). Dated baseline counts below remain historical.

## Startup and configuration

`NODE_ENV=production` now fails before listening unless Clerk live keys, a valid Clerk frontend hostname, exact hosted HTTPS browser/native origins, signed-webhook configuration and a fixed invitation redirect on an allowed browser origin are present. Founder approval accepts explicit Clerk user IDs; custom staff roles accept explicit organization role keys. Empty founder approval continues to disable practice creation.

Database transport must be encrypted. `verify-full` remains the default. The existing reviewed provider-internal `require` mode permits encryption without full certificate verification; it is not equivalent to verified external TLS. Plaintext production connections are rejected. PostgreSQL URL schemes/targets are validated and connection-target/credential query overrides are rejected before connecting. Proxy trust remains explicit narrow IP/CIDR configuration; intake and native authentication remain explicit opt-ins.

Key syntax cannot establish that the secret/public keys belong to the same production instance, that OAuth/MFA/email are correctly configured, or that organization permissions are right. Those require deliberate provider configuration and authenticated acceptance. New-practice onboarding also requires Clerk **Organization slugs** enabled and the creator role configured as `org:admin`; see [provider and environment setup](practice-access-implementation.md#provider-and-environment-setup). Startup and `release:verify` do not inspect those live provider settings. Existing development identities/mappings must not be inferred from display names or carried into production by simply switching keys.

All authenticated sessions now require the configured frontend issuer and valid user/session identifiers in addition to Clerk SDK signature, activation, issued-at, expiry, token-category and authorized-party checks. The issuer comes from the configured public key, never an unverified token.

## Private files and cursor custody — October 18 hardening

Production additionally requires `CAREIQ_PRIVATE_STORAGE_DIR` to be an absolute, pre-provisioned owner-only directory outside the application checkout. Startup and `release:verify` inspect the directory without creating or changing it. Symbolic directory aliases, group/other access and a different filesystem owner are rejected. Private object reads reject symbolic links, hard-linked files, nonregular objects and group/other-readable permissions; new writes remain exclusive and owner-only. Preserve existing objects and review their custody/permissions before promotion; this code does not silently chmod or move production data.

Set `CAREIQ_WORKFLOW_CURSOR_SECRET` to at least 32 cryptographically random bytes encoded as hexadecimal, supplied privately and consistently across the API fleet. Syntax checks cannot establish entropy or secret-manager custody. Rotation invalidates outstanding cursors; document that expected behavior and do not fall back to a process-generated production key.

When `CAREIQ_AUDIT_DATABASE_URL` is configured, production also requires a separate `CAREIQ_AUDIT_CURSOR_SECRET` and an absolute owner-only `CAREIQ_AUDIT_EXPORT_DIR` outside the checkout. The optional audit feature remains unavailable without its separate reader; no owner/runtime credential fallback is added. Export reads and exclusive writes share the hardened document-file controls, and every download requires a currently verified dedicated reader. Its directory is checked before reader activation and on every export file access, and plaintext audit-database transport is rejected in production at configuration and reader creation. See the nonsecret names in [API environment example](../apps/api/.env.example).

These checks prevent development defaults and unsafe filesystem permissions from being accepted as release settings. They do not provision a durable volume, certify encryption/backup/retention, activate scanning or implement email delivery. The operator must verify those properties in the intended environment. Keep the existing quarantine and unavailable-provider states until accepted integrations are running. Storage guidance: [OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html); key custody: [OWASP secrets management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).

## Restricted database release verifier

Production startup checks database metadata in a read-only transaction before serving requests. It checks PostgreSQL 18+, direct restricted login, transitive role memberships, database/schema/table ownership and excessive grants. All predefined `pg_*` memberships are denied for API runtimes, including monitoring, server file/program, signal and checkpoint roles. Narrow custom groups remain subject to the same transitive ownership and column/table privilege checks.

The verifier checks expected tables; forced RLS; exact policy expressions, commands and roles; append-only audit access; clinical write limits; actor-only draft policies; narrowly writable metadata; and protected marketing contact columns. It verifies security-invoker helper bodies against the reviewed migration, pinned search paths, exact public-table composite foreign keys/check constraint definitions, and the activation trigger’s event, function and definition. It does not query patient, contact or draft rows.

Migration `0018_runtime-release-guards.sql` pins the three location/rollout helper search paths to `pg_catalog, public, pg_temp`. A runtime-created temporary table can no longer impersonate the real practice, enrollment, assignment or location tables. It changes no records, assignments, ownership or practice modes. Existing practices remain in their current mode; explicit legacy-to-location mapping/activation review still applies.

With a deliberately selected restricted runtime `DATABASE_URL` and corresponding TLS mode:

```sh
pnpm --filter @careiq/api db:verify
```

This catalog-only command can run on the isolated local runtime without production Clerk keys. A failing check exits nonzero and changes no grants or schema. Required schema assets must ship with the API: both runtime verification and migration commands read `apps/api/drizzle` relative to source or compiled output.

With reviewed production environment values and the production runtime credential:

```sh
NODE_ENV=production pnpm --filter @careiq/api release:verify
```

This additionally checks production configuration. It is a preflight, not deployment or provider/device certification. It cannot read the migration ledger through the restricted login; ledger verification belongs to the separate operator migration step.

## Migration/release procedure

Keep operator/migration credentials separate from the runtime login. The migration command validates every SQL file against a contiguous ordered journal, obtains a nonblocking advisory lock and checks every applied ledger timestamp and SHA-256 hash before applying SQL. Afterward it requires the complete matching ledger. Changed applied SQL, missing/reordered history, extra/future entries and tables without a ledger fail closed. Database failures are logged with a stable operation and safe code, without raw SQL parameters or credentials. Lock waits are bounded to 10 seconds and individual statements to five minutes; failures require review rather than weakening these limits.

All non-loopback connections require an exact reviewed database name:

```sh
pnpm --filter @careiq/api db:migrate --confirm-database "$REVIEWED_DATABASE_NAME"
```

Use the operator’s private `DATABASE_URL`; production migrations also require encrypted transport. The confirmation does not prove a backup is recoverable. Before any hosted migration, restore a current backup into isolated PostgreSQL, verify historical ledger checksums against the release, rehearse migrations twice and review grants/mappings. If a historical checksum differs, stop and reconcile the actual applied migration history; do not rewrite the SQL or ledger to silence the check.

After migration, use the checked clinical-runtime grant with the intended non-owning login; add marketing submitter membership only when intake is deliberately enabled. Run restricted `db:verify`, then production `release:verify`. Confirm API/web compatibility and preserve the additive schema, audit history and retry records during application rollback. Do not revert enforced location practices to legacy authorization or restore an owning runtime to make an old application start.

Disposable CI uses a loopback PostgreSQL 18 database named `careiq_test`, operator `DATABASE_URL`, matching `TEST_DATABASE_URL`, `DATABASE_SSL_MODE=disable` and `NODE_ENV=test`. Run `db:migrate` twice, followed by API tests, typecheck and build. A shared target guard admits only loopback `/careiq_test` with no query overrides or fragment. Integration tests create/clean their own restricted logins and synthetic fixtures; they refuse the live local review database and any hosted target. They prove restricted release checks without production keys. Never direct the integration suite at a hosted development or production database.

## Verified evidence and limits

- All 19 migrations applied to a newly created empty database in the dedicated loopback PostgreSQL 18.6 container; the second run verified as a no-op. Only the generated rehearsal database was removed afterward. The same journal is complete on `careiq_test` and `careiq_review`.
- All 119 API tests passed, zero skipped, with typecheck and build passing. Tests include actual restricted-role metadata checks, transitive non-inheriting audit privileges, twelve controlled catalog corruption cases and raw RLS denial despite forged temporary access tables.
- Restricted review `db:verify` passed. The owner-selected existing development identity was explicitly approved locally; the API was restarted through the ownership-safe runner. API, web, marketing and Expo previews remain ready. No production founder identity was approved.
- One 60-second JWT was issued for the selected account’s existing active development session. The unchanged Clerk SDK verified its real signing keys in an ephemeral native-opt-in harness. Native bearer verification passed; browser Origin, Cookie, fetch metadata and invalid-signature requests were rejected. No identity, session, organization or invitation was created; no token or provider ID appears in the report.
- The real review API’s native gate remained off. The backend-issued token lacked browser `azp`, so its real `/me` and onboarding state probes returned 401. No draft save occurred.
- A separate browser integration check issued exactly one 60-second, single-use sign-in ticket for the selected verified development account and consumed it through the installed Clerk frontend SDK in a fresh incognito headless Chrome on `http://localhost:3101`. The genuine frontend JWT’s `azp` matched that browser origin; real `/api/v1/me` and `/api/v1/onboarding/state` both returned 200 for the selected account, including verified email and explicit founder eligibility. The account had no draft or submitted setup; checks stayed read-only to avoid a concurrent draft change. Only this new temporary session was revoked and verified revoked; the pre-existing active session remained active. The browser context was destroyed. Tokens, tickets, provider IDs and browser storage were not exported or retained. Sanitized evidence is in the private ignored `.local-review/browser-ticket-proof.json`.

Native transport checks identify a bearer transport without browser headers, not a physical device or device attestation. Clerk permits `azp` to be absent in session tokens; this branch remains an explicit opt-in. Offline JWT verification does not establish immediate session revocation: expiry/clock-skew bounds and foreground token refresh must be tested with the provider. Membership/location authorization continues to verify current provider membership and local activation separately.

Remaining external acceptance: correct production keys/providers and email delivery; signed webhook delivery/replay; deliberate production founder/user/organization mapping; hosted admin/member/two-practice/retry tests; backup restoration and operational controls; and installed iOS/Android login, MFA/recovery, callbacks, invitation cold/warm starts, expiry/revocation and foreground behavior. Backend-issued-token and browser ticket integration proof do not test password/MFA UI, invitation delivery or installed-device transport. The draft save/restore path was not exercised with the real provider session. Keep native authentication off until those device checks pass. Real patient use remains outside the owner’s current synthetic/demo hosting decision.

See [security hardening](security-hardening.md), [practice access implementation](practice-access-implementation.md) and [local review](local-review.md). Primary authentication references: [Clerk session claims](https://clerk.com/docs/guides/sessions/session-tokens), [session verification](https://clerk.com/docs/guides/sessions/verifying), [existing-session token issuance](https://clerk.com/docs/reference/backend/sessions/get-token), and [short-lived sign-in tickets](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token).


## Practice Home / personal account lifecycle release

The local October 30 follow-up adds migrations `0043_account_closure_requests` and `0044_personal_account_archive` (45 total journal entries). Apply the normal checked migration ledger before starting the updated API; its restricted release verifier now checks account tables and actor policies. The authenticated account guard must remain ahead of staff and patient portal routes. Provider self-deletion must be disabled for new users and reviewed existing-user overrides so it cannot bypass owned-practice closure checks. This is applied in Development only; production rollout remains separate. See [verification and acceptance boundaries](verification/practice-home-2026-10-30.md) and [operator restoration](personal-account-restoration.md).

## Scheduling availability follow-up — October 31, 2026

The local Today/Appointments implementation adds `0046_provider_availability_busy` (47 journal entries). Apply it through the normal checked migration ledger before starting the updated API. The availability endpoint and booking validator use its scoped boolean projection to detect provider conflicts across locations while keeping those appointment records inaccessible. The restricted release verifier checks the helper's reviewed body, signature, scalar return, search path, execution grants and owner access through forced row policies. Local isolated migration, restricted preflight and 393 API tests passed. No hosted migration or deployment was performed. See [activation and evidence](verification/today-appointments-2026-10-31/README.md) and [database details](verification/today-appointments-2026-10-31/data-and-availability-verification.md).

## Managed PostgreSQL owner and availability follow-up — October 31, 2026

Apply additive migration `0047_managed_owner_availability` with the normal checked runner before starting this release (48 journal entries). Earlier migrations remain byte-for-byte unchanged. The follow-up initializes existing owners under each practice's forced row policies and preserves saved specific-location restrictions. Its private `careiq_availability_reader` role is NOLOGIN, non-superuser and NOBYPASSRLS, with only the scheduling and authorization columns required by the boolean helper. One SELECT-only, practice-scoped appointments policy targets that role; the API cannot assume it and receives no extra record access. The operator needs the existing role-management and object-ownership capabilities; the API continues using its separate restricted login.

The complete migration sequence and repeat pass were rehearsed with a non-superuser/non-BYPASSRLS owner on isolated PostgreSQL 18.6, including existing synthetic practices, saved narrowing and runtime isolation. See [managed-owner migration verification](verification/managed-owner-release-2026-10-31.md). This rehearsal does not certify production identity-provider account settings; disable provider self-deletion and review existing-user overrides before exposing account closure in production.
