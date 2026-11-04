# Schedule data and availability verification — October 31, 2026

Implementation is local in the canonical checkout. No commit, push, hosted migration, deployment, or review-database mutation was performed by this verification run.

## Verified results

- Full API regression suite: **393 passed, 0 failed, 0 skipped**. [Complete output](api-tests.log).
- API TypeScript check passed after adding the release preflight checks.
- Focused web workflow API and schedule suite: **16 passed, 0 failed, 0 skipped**, covering complete pagination, overnight boundary visits, later-day evidence/history dependencies, aborts, denied access, synthetic availability, and revoked-action permissions.
- The existing full release-verifier integration passed with the actual restricted runtime role, including the newly required availability-helper catalog checks.
- Fresh migrations and a second migration run both verified the complete **47-entry** ledger.

The API suite ran with Node 22.23.4 and PostgreSQL 18.6 in a separate disposable container, bound only to `127.0.0.1:55453`, with database `careiq_test`. All fixture records were synthetic. The disposable test container was stopped and automatically removed after verification. The existing review container and its data were not accessed. Negative route tests intentionally used an unavailable loopback audit destination; their expected audit-fallback warnings are included in the log. Service and database audit integration ran against the disposable database.

## Scheduling contract

`loadWorkflowSchedule` loads at most seven consecutive visible dates and an appointments-only previous boundary date, draining authorized appointment pages before returning. The boundary read retains overnight visits starting before the visible week. It rejects missing read grants, inconsistent location/time-zone responses, incomplete or cycling cursors, and cancellation. It preserves later-day document/request/work/template dependencies and related history cursors, preferring newer record revisions. Weekly capabilities are the intersection of all date responses; an explicit revoked capability overrides an older record action grant.

`GET /api/v1/locations/{locationId}/workflow/availability` returns up to 96 suggestions on a single practice-local day, at 15-minute candidate intervals, with integer durations from 5 through 480 minutes. It uses configured provider rules, date bounds, available/unavailable exceptions, and active appointment conflicts. Nonexistent and ambiguous local start times are omitted. Excluding the current appointment requires appointment update authority and an appointment in the current authorized location. Appointment saves recheck the same rules and retain the database exclusion constraint as the final concurrency guard.

## Protected conflict projection

Migration `0046_provider_availability_busy` adds one scalar boolean helper for conflicts hidden by other-location row policies. It validates the active practice, member, current location assignment, and active provider assignment before checking practice-wide occupancy. An excluded appointment must belong to the caller's current location. Positive intervals are bounded to 24 hours. The helper returns no patient fields, record identifiers, or other-location labels.

The function has a fixed `pg_catalog,public,pg_temp` search path, schema-qualified protected reads, no PUBLIC execution, and an explicit clinical-runtime execution grant. Release preflight checks its exact signature and reviewed body, scalar boolean return, definer status, search path, grants, runtime separation from its owner, and the owner's ability to read through forced row policies.

The restricted-role database test proves that an appointment in another location is invisible to direct `SELECT` while its occupied slot is still excluded. It also proves denial for detached providers, foreign-practice providers, wrong practice/location/user context, and cross-location appointment exclusions. Catalog tests reject missing, changed, publicly executable, broader-return, and incorrectly owned helpers.

## Local activation prerequisite

The reviewed migration must be applied through the project's owned local runner before using real API slot suggestions or the shared booking validator. This verification applied it only to the disposable test database. The full implementation remains subject to the repository's local-only scope.
