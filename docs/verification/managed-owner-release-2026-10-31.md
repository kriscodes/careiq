# Managed-owner migration rehearsal — October 31, 2026

The release adds `0047_managed_owner_availability` without changing any earlier migration bytes. The complete checked journal now contains 48 entries.

## Required behavior

The managed production owner has `CREATEDB` and `CREATEROLE`, but is neither superuser nor `BYPASSRLS`. Migration 45's original set-based seed consequently cannot see existing membership/location rows without a practice context. Migration 46's original function also inherits that owner's forced row policies, so it cannot project conflicts at another location; requiring a superuser function owner cannot succeed on that managed role.

Migration 47 reconciles active existing owners within each practice's ordinary row policies, preserves saved specific-location restrictions and original assignment attribution, and emits system initialization evidence only for newly created profiles. It restores the original actor and practice context afterward.

The availability helper now belongs to `careiq_availability_reader`: NOLOGIN, non-superuser, NOBYPASSRLS, without role memberships or schema/database creation. Column grants cover only the exact scheduling/authorization projection; patient identifiers and appointment content are excluded. One permissive, SELECT-only appointments policy permits this private reader to see the current practice's occupied intervals. Runtime identities cannot assume the role. The helper retains its exact reviewed body, scoped authorization checks, fixed search path and boolean-only return. The release verifier checks those boundaries, the role attributes, exact column grants and the owner-only policy.

## Rehearsal evidence

- Separate PostgreSQL 18.6 container, bound only to `127.0.0.1:55457`, with synthetic credentials and fixtures. Node 22.23.4 and the actual unchanged migration runner were used. No existing review/test database or hosted database was changed.
- Real non-superuser/non-BYPASSRLS `careiq_owner` with production-like database/role-management capabilities applied the first 45 journal entries. Three synthetic existing practices, active/suspended owners, active/closed locations and an earlier assignment were then inserted.
- The original migrations 45–46 applied as that owner and reproduced zero initialized profiles. A saved narrow profile was added as a preservation fixture; migration 47 then initialized the missing eligible owner, restored its active locations, retained original assignment attribution, left the narrow profile unchanged, skipped the suspended owner and recorded exactly one system event.
- The direct restricted `careiq_api` login passed the complete catalog-only database release verifier at all 48 entries.
- A separate fresh empty database applied all 48 entries as the non-superuser owner; an immediate repeat verified the complete unchanged ledger as a no-op. Restricted runtime verification passed again.
- Complete API regression suite on a separate fresh PostgreSQL 18.6 container using the existing CI migration-ownership model: **395 passed, zero failed, zero skipped**. This includes the final projection-policy and owner-seed checks.
- All 17 focused owner, release-verifier and availability tests passed with zero skipped. Actual other-location appointments remained invisible to direct runtime reads while their occupied slots were excluded. The added owner reconciliation regression runs the real block twice under a restricted non-superuser/non-BYPASSRLS login and checks saved narrowing, context restoration and idempotent evidence. API typecheck passed.

## Existing acceptance limit

A complete API suite against the non-bypass-owner database found 28 failures in older patient-token, patient paperwork/communication and delivery paths. Those older security-definer helpers already inherit the non-bypass object's owner under forced row policies; this release does not reassign or broaden them. Catalog verification alone does not establish their functional production acceptance. The existing production record keeps optional delivery and patient/real-record acceptance separate. These failures must not be represented as a passing managed-owner workflow suite, and activation of those paths requires a separate reviewed fix and acceptance.

The production identity provider's self-deletion setting and existing-user overrides must also be checked before account closure is exposed. Only Development configuration was established by earlier work. No provider account or setting was changed during this rehearsal.
