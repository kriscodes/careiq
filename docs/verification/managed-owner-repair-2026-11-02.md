# Managed helper ownership repair — November 2, 2026

Status: **implemented and verified locally after explicit user approval**. The working tree is based on `b7820b0`; this repair is not committed, pushed, deployed or applied to a hosted database. Dates use America/Los_Angeles. This record supersedes the previously unresolved ownership failure status; it does not clear the separate static-analysis or hosted acceptance gates.

## Problem and resulting behavior

The former release rehearsal applied migrations through a non-superuser, non-BYPASSRLS owner and reproduced 28 failures. Older SECURITY DEFINER helpers could not see the rows required to establish patient-token identity, portal scope, audit identity or delivery suppression under the existing row policies. The normal superuser-owned CI database concealed that difference.

Additive migration `0049_managed_helper_ownership.sql` gives 13 existing helpers five private owners. Each role has NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, NOCREATEROLE and NOREPLICATION, with explicit table/column/function grants and 67 role-specific policies. Ordinary runtime identities cannot inherit or assume these roles. Temporary ownership-transfer permissions end inside the migration transaction; the migration owner retains administrative membership with inheritance and SET ROLE disabled.

Existing helper bodies, table ownership, ordinary runtime grants and all 49 historical SQL files remain unchanged. The original function authorization, expiry, revocation, purpose, request binding, consent, immutable evidence and audit logic remains in effect. Fixed helper bodies and exact caller permissions govern the private bootstrap reads.

Independent review tightened the audit writer policy beyond the initial experiment: patient-token callers may validate only their own patient identity, or an established clinical location scope. A positive own-patient audit write passes; attributing the same token to another patient in the same location is rejected. Portal subject/session context remains trusted input from the authenticated API; SQL does not itself verify the identity provider's cryptography.

## Catalog checks

`managed-owner-release-check.ts` validates the explicit inventory in `managed-owner-policy.ts`. It checks:

- All five roles and their attributes; direct and indirect runtime reachability; role memberships and their inheritance/SET options.
- Only the 13 reviewed function objects may be owned, in the current database. Other object classes, shared objects and ownership in another database are rejected.
- Raw function bodies against their versioned migration definitions; result/language/default arguments, SECURITY DEFINER, search path and other execution properties; exact entry-point EXECUTE grants and grant options.
- Exact table, column, schema, database and function grants, including effective privileges inherited from PUBLIC. Duplicate or missing grant entries are rejected.
- Exact policy names, commands, private roles, predicates and permissiveness. Historical RLS modes are preserved: existing forced policies stay forced; audit tables retain their original enabled RLS and are not owned by private helper roles.

The existing clinical and notification policy checks recognize only fully validated private policies. They do not ignore arbitrary policy names or loosen the existing runtime policy comparisons.

## Verification

| Rehearsal                                                    | Result                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh restricted-owner installation and unchanged replay     | 50 migrations; all 91 application tables owned by the restricted migrator; **464/464 API tests passed**                                                                                                                                                                       |
| Existing 49-migration database upgraded to 50, then replayed | **464/464 API tests passed**; existing synthetic patient/practice/location records, all prior helper bodies and 49 ledger hashes preserved                                                                                                                                    |
| Ordinary CI ownership, all workspaces                        | **614/614 tests passed**: 464 API, 131 web, 9 marketing, 7 i18n, 3 contract                                                                                                                                                                                                   |
| Focused permission and tampering regressions, included above | **61 passed**, including cross-patient/location/practice denial, token expiry/revocation, purpose restrictions, forbidden helper-role assumption, PUBLIC/direct privilege changes, altered function body/defaults/search path, policy changes and unexpected object ownership |
| Changed executable-line coverage                             | **2,155 / 2,276 = 94.68%**, minimum 80%; provenance matches final source/test/configuration                                                                                                                                                                                   |
| API source coverage                                          | Lines/statements **74.48%**, branches **80.22%**, functions **92.88%**; all workspace coverage floors pass                                                                                                                                                                    |
| Real-API browser flows under restricted ownership            | **3/3 passed**: unsigned/signed patient forms, immutable PDFs, library access, foreign-copy denial and insurance evidence/audit handling; fresh 50-migration database and all 91 table owners verified                                                                        |
| Release tooling                                              | **108 tests passed**                                                                                                                                                                                                                                                          |
| Compiler and style                                           | API source/test typechecking, API production compilation, workspace lint, formatting and repository hygiene pass                                                                                                                                                              |

All test runs above have zero failures, skips and TODOs. The two ownership rehearsals use separate disposable PostgreSQL 18.6 containers bound only to loopback; each container and its volume is removed in `finally`. The runner does not accept an external database URL. No existing local review database or hosted data was used.

Run `pnpm test:managed-owner` to repeat both rehearsals. Machine-readable test summaries are ignored local artifacts at `.tmp/managed-owner/fresh/tests.json` and `.tmp/managed-owner/upgrade/tests.json`. Coverage reports and provenance remain under ignored `coverage/`.

The journal contains exactly one new entry; all first 49 entries and their SQL bytes match Git HEAD. SHA-256 of the new migration:

```text
7de11385f22d8f4da502fb46aab62583b02f96b9a0e59a604a3cebe216162cf8
```

Independent source review found no remaining concrete blocker within the approved repair scope. Focused static-analysis evidence is recorded separately in [release-security-analysis.json](release-security-analysis.json). This is not a claim that the whole repository is free of vulnerabilities; the prior 65 CodeQL findings remain a separate release blocker.

## Promotion and rollback limits

Local approval covers implementation and verification only. Publishing code, applying migration 50 to a hosted database and deploying services require a separate release decision. Existing hosted settings are unchanged by this repair.

Do not assume the previous 49-migration binary is a valid rollback target after applying migration 50. Its ledger checks and private-policy inventory would reject the new schema. Before hosted promotion, prepare and rehearse a rollback artifact that understands migration 50, or an explicit forward-fix recovery plan. A provider code rollback does not undo database ownership or policy changes. No down migration, hosted rollback or backup restoration was performed here.

The separate CodeQL findings, automatic Render-to-GitHub post-deployment event integration and a hosted recovery exercise remain open. See [release verification](../deployment/release-verification.md).

## Design references

- [PostgreSQL 18 role membership](https://www.postgresql.org/docs/18/role-membership.html): membership, inheritance and SET ROLE are distinct controls.
- [PostgreSQL 18 row policies](https://www.postgresql.org/docs/18/sql-createpolicy.html): private policies combine with existing policies; precise roles and predicates matter.
- [PostgreSQL 18 function security](https://www.postgresql.org/docs/18/sql-createfunction.html): SECURITY DEFINER ownership, search path and EXECUTE permissions define the helper boundary.
