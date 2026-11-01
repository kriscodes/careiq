# Render release restore rehearsal — October 20, 2026

Result: **passed**. This rehearsal changed only a new isolated local PostgreSQL database. No hosted database, application settings, identity records or existing local review container were changed.

## Source and backup

- Backup: `2026-10-20T22_47Z.dir.tar.gz`, 6,531 bytes.
- SHA-256: `3dc5900c2101fc9e3ccc50ada4c82c5614231c1023df4b8c2e9b8ba4279766c6` (matched before restore).
- Current reviewed source: `d8585a2a2b6b7e260607dca0f64dee60bff609e2`; coordinator verified GitHub comparison to deployed main `4557ba1c39243012944ce162854371e9fdbc1df6` has no changed files.
- Baseline `7dcc510` has 16 migrations. Its complete SQL files and journal prefix are unchanged in the current release.
- PostgreSQL: 18.6, official installed image. Migration/verifier runtime: official Node 22.23.2; current TypeScript sources compiled afresh into a private directory, without changing repository outputs.

## Verified outcomes

| Check | Outcome |
| --- | --- |
| Native archive restore | Passed, single transaction, exit on error; restored under the real object-owner name `careiq_owner`. |
| Restored baseline ownership | 7 tables including ledger; all owned by `careiq_owner`. |
| Actual baseline ledger | 16 entries; every timestamp, order and SHA-256 matches the reviewed release. |
| Role and ACL clone | Catalog snapshot from 2026-10-20T22:53:25.490Z: 5 CareIQ role attributes, 8 memberships, 59 relation ACL entries, 1 column ACL entry and 6 schema ACL entries. |
| Upgrade | Actual reviewed migration runner as non-superuser/non-BYPASSRLS `careiq_owner`: 16 → 43, exit 0. |
| Repeated migration | Same actual runner: exit 0; no additional entries; completed 43-entry ledger remains identical to the full reviewed manifest. |
| Runtime membership check | Original checked `grant-clinical-runtime.sql`, supplied on standard input to `psql -X -v ON_ERROR_STOP=1 -v runtime_role=careiq_api` as `careiq_owner`: exit 0. The exact baseline clone already had this membership, so this was an idempotent local check and did not demonstrate a need for new permissions. |
| Restricted verifier | Current `verify-release.js --database-only`, direct cloned `careiq_api` login: exit 0. Full PostgreSQL/schema/RLS/grant/helper checks passed. |
| Final ownership | 88 tables across public, drizzle and audit; all owned by `careiq_owner`. |

## Isolation and evidence boundaries

The database and tooling ran on an internal-only Docker network. Tooling shared the database network namespace and connected to literal `127.0.0.1`; no port was published. Only generated local passwords were supplied; dotenv was disabled and repository source mounts were read-only. Local database TLS was disabled solely within this isolated namespace. Production TLS and actual hosted grants need their own verification.

The native archive omits ACLs and cluster role memberships. Those were supplied from the separately captured current hosted catalog rather than guessed from historical SQL. Provider-specific `render_conn` and `render_mgmt` were nonprivileged NOLOGIN placeholders: their provider-managed capabilities were not reproduced. CareIQ role flags/memberships and explicit application ACLs were cloned; the runtime verifier found no unsupported effective `careiq_api` privileges.

No application/patient/contact/audit row SELECTs, row totals, row sampling or external messages were performed. Restoring the full archive necessarily replays its stored data; raw content was not printed. Successful restoration and catalog checks do not prove clinical record completeness or authenticated workflows. No optional delivery, scanning, audit-reader, native-authentication or notification worker was activated.

Backup, raw restore/tooling output, catalog snapshot and local-only credentials remain under the private release directory; all directories are mode 0700 and files mode 0600. The existing `careiq-auth-review-db` was not started or modified. The task-owned disposable PostgreSQL container, its anonymous data volume and internal network were removed after successful verification. The private backup, catalog snapshot, report and raw logs remain preserved.

## Hosted follow-through

The final hosted migration, restricted runtime verification, production preflight and live deployment results are recorded in [the deployment record](README.md). The existing clinical runtime membership was retained; no separate membership grant was executed.
