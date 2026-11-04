# PR #10 operator handoff — October 18, 2026

This is a local merge resolution and verification handoff, not a deployed release. At the user's request, no merge commit or push is performed. The canonical checkout is `/Users/kristian/Documents/Server/CareIQ`, on `dev`, with the merge of `main` pending.

## Source and commit handoff

- Reviewed PR: https://github.com/kriscodes/careiq/pull/10.
- Feature head before reconciliation: `f86726d6a95b9b347447f4895e0e8409058a7598`.
- Integrated main: `7dcc5109f8f0068f4aac94c9b2afa5429708409c`.
- Local recovery reference: `codex/pr-10-before-main-20261018`.
- The 54 conflict paths were resolved case by case and staged without a commit. Additional verification/test/documentation files are included in the final reviewed staging state. See [merge receipt](merge-resolution.json) and [verification](README.md).

Review the staged diff and Git status, then create the pending merge commit on `dev` with the supplied message. A normal subsequent push updates PR #10. Keep the merge parents; do not replace `main`, force-push, reset the database or overwrite either history. The remote PR remains at its existing head until the user pushes. Current hosted-service branch/automatic-deployment settings have not been verified.

## Before hosted promotion

1. Confirm the intended environment, actual database name, provider settings, PostgreSQL 18+ and a recoverable current backup. Restore that backup into an isolated environment and rehearse the reviewed migration history, including an unchanged repeat. Fresh-empty replay in this review does not replace a production-data restore rehearsal.
2. Load operator credentials privately for the migration process, with the reviewed encrypted transport. Run the ordinary ledger/hash-checked migration command with the exact approved database name:

```sh
NODE_ENV=production pnpm --filter @careiq/api db:migrate --confirm-database "$REVIEWED_DATABASE_NAME"
```

The expected full history is 36 entries through `0035`. The runner applies only missing entries and verifies existing checksums/order. Stop on a mismatch or lock timeout and reconcile the actual history; do not edit applied SQL, reset the database or change ledger hashes to make it pass. All 16 SQL files common to the two branches are byte-identical, and all 36 feature-branch SQL files were preserved. [Database/lock proof](merge-database-lock.json).

3. Apply the checked [clinical runtime grant](../../../apps/api/src/db/grant-clinical-runtime.sql) to the intended non-owning API login. Provision/verify a separate protected audit-reader login using the [audit grant](../../../apps/api/src/db/grant-audit-reader.sql) when enabling the audit console; it must not inherit the clinical runtime or privileged roles. Do not replace the application's restricted credential with the migration owner.
4. Switch to the restricted runtime environment and run:

```sh
pnpm --filter @careiq/api db:verify
NODE_ENV=production pnpm --filter @careiq/api release:verify
```

Use matching reviewed production Clerk keys, HTTPS origins, verified webhook secret and invitation redirect. Real provider/session/role configuration requires its own acceptance. Preserve explicit location/member mappings; do not turn a legacy practice into a location practice by assigning every person every location.
5. Configure durable private file storage, stable cursor secrets, approved scanning/worker boundaries, separate audit credentials and a fleet-wide connection budget. The implemented local filesystem pipeline is not an activated cloud storage/retention service; missing/failed scanning keeps uploads quarantined. Automatic email provider delivery and durable reconciliation workers remain unfinished.
6. Confirm both Render services' tracked branch, build filters, Auto-Deploy and migration/pre-deploy settings before promoting. Repository CI is checks-only. Apply the reviewed database/configuration prerequisites, deploy/verify the API, then deploy/verify the matching web version. API startup verifies schema/privileges but never runs migrations. Both CI workflows keep the raw audit gate visible; the two-high advisory result remains a release disposition item.

## Hosted acceptance and failure handling

Verify actual owner/staff login, MFA/recovery, approved and denied location access, two-practice patient/document isolation, a clinical save/reload, immutable form completion/copy access, revoked membership/library access, retries and protected audit evidence. Record the exact environment, deployed commit and protected evidence location without credentials, tokens or patient bodies. Local synthetic identities and export builds do not establish real-provider or installed-device acceptance.

If preflight/migration/startup verification fails, stop promotion and preserve the previous working service. Keep additive schema, audit/retry facts and private files during application rollback; do not weaken RLS or restore an owning runtime to start an older application. Follow [API release checks](../../api-production-release.md), [backup/retention](../../backup-retention.md), [security operations](../../security-hardening.md) and [owner-controlled actions](../../security/owner-security-checklist.md). Real-patient launch and release/signing/retention decisions remain separate owner and practice approvals.
