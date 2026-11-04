# Render production deployment repair — October 20, 2026

The initial deployment repair brought both API and web live on main commit `4557ba1c39243012944ce162854371e9fdbc1df6` from [PR #11](https://github.com/kriscodes/careiq/pull/11). GitHub comparison against tested fix `d8585a2a2b6b7e260607dca0f64dee60bff609e2` returned no changed files. That repair was a hosted configuration and database promotion; application source was not changed for it. The later Google callback web fix is recorded below.

## Deployment evidence

| Service | Result | Render deployment |
| --- | --- | --- |
| Web | Succeeded, live; main `4557ba1` | [dep-dbbuo68n74is73c3beog](https://dashboard.render.com/web/srv-dau6ipqd0e5s73efagk0/deploys/dep-dbbuo68n74is73c3beog), October 20 at 15:32 PDT; live at 15:34 |
| API | Succeeded, live; main `4557ba1` | [dep-dbbv5heq1p3s73f2hlcg](https://dashboard.render.com/web/srv-darjgre0tbcc73brvbmg/deploys/dep-dbbv5heq1p3s73f2hlcg), October 20 at 16:01 PDT; live at 16:02:52 |

Both services use Node 22.23.2. Final Render project overview showed API/web Deployed and PostgreSQL Available.

## Configuration corrected

The variable names were correct. The original secret values were abbreviated display strings, rather than usable secret keys. A production Clerk key was created in the selected production instance and entered privately by the owner. An intermediate key-label entry and a trailing newline in the workflow secret were corrected before the final deployment. Secret values are excluded from this record.

| Service | Variable | Verified configuration |
| --- | --- | --- |
| API | `CLERK_PUBLISHABLE_KEY` | Live key for `clerk.careiqlabs.com` |
| Web | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Same live public key as API |
| Both | `CLERK_SECRET_KEY` | Same complete live secret from the selected production instance |
| Web | `NEXT_PUBLIC_API_URL` | `https://careiq-api-7ssz.onrender.com` |
| API | `CORS_ORIGINS` | Existing hosted HTTPS origins retained; localhost removed |
| API | `CAREIQ_PRIVATE_STORAGE_DIR` | `/var/data/careiq-documents` |
| API | `CAREIQ_WORKFLOW_CURSOR_SECRET` | Privately generated 32 random bytes as exactly 64 hexadecimal characters; no trailing newline |
| API | `CLERK_WEBHOOK_SIGNING_SECRET` | Actual signing secret from the new production webhook |
| API | `CAREIQ_INVITATION_REDIRECT_URL` | `https://app.careiqlabs.com/join` |
| API | `DATABASE_URL`, `DATABASE_SSL_MODE` | Existing restricted `careiq_api` internal connection retained, `require` mode retained |

The production Clerk webhook targets `https://careiq-api-7ssz.onrender.com/api/v1/webhooks/clerk`. Its six subscriptions are organizationMembership.created/updated/deleted and organizationInvitation.created/accepted/revoked. Registration and secret configuration were verified; no synthetic production organization events or identities were created to test delivery.

## Durable private storage

The owner attached a 1 GB Render disk at `/var/data`, priced in the dashboard at $0.25/month. A dedicated `0700` directory is provisioned at runtime. The guarded start command checks that `/var/data` is a real mounted filesystem, rejects symlinks, creates only the dedicated directory if absent, then verifies runtime ownership, exact `0700` permissions and access before normal API startup. It never changes permissions or ownership on existing objects.

Render start command:

```sh
node --input-type=commonjs -e 'const fs=require("node:fs");const root="/var/data",dir=root+"/careiq-documents";const fail=()=>{throw new Error("PRIVATE_STORAGE_PROVISIONING_REQUIRED");};if(process.env.CAREIQ_PRIVATE_STORAGE_DIR!==dir)fail();const mounted=fs.readFileSync("/proc/self/mountinfo","utf8").split("\n").some(line=>line.split(" ")[4]===root);const mount=fs.lstatSync(root);if(!mounted||!mount.isDirectory()||mount.isSymbolicLink()||fs.realpathSync(root)!==root)fail();process.umask(0o077);try{fs.mkdirSync(dir,{mode:0o700});}catch(error){if(error.code!=="EEXIST")throw error;}const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(dir)!==dir||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)fail();fs.accessSync(dir,fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK);' && pnpm --filter ./apps/api start
```

The final deployed production preflight inspected the actual directory successfully. Render disks prevent multiple-instance scaling and zero-downtime deploys; deployments briefly interrupt this API. See [Render persistent disks](https://render.com/docs/disks).

## Current backup, rehearsal and hosted database promotion

The hosted database is PostgreSQL 18.6, `careiq_n8yp`. Its initial ledger had 16 entries. All original SQL files and journal entries remained unchanged in the reviewed 43-migration release.

A current native logical export was created through Render Recovery and downloaded privately:

- Filename: `2026-10-20T22_47Z.dir.tar.gz`; 6,531 bytes.
- SHA-256: `3dc5900c2101fc9e3ccc50ada4c82c5614231c1023df4b8c2e9b8ba4279766c6`.
- Restore into a new isolated PostgreSQL 18.6 instance passed; all 16 applied timestamps/order/hashes matched the current release.
- Current hosted role and ACL metadata was cloned for rehearsal. Upgrade 16 → 43, unchanged repeat and the cloned restricted runtime verifier all passed. [Rehearsal detail](restore-rehearsal.md).

The actual hosted update used the unchanged migration runner and the separate existing `careiq_owner` connection with verified external TLS. The confirmed database name was `careiq_n8yp`. The runner verified historical hashes, applied the remaining 27 additive migrations, and verified all 43 entries. An unchanged hosted repeat passed as a no-op.

The existing `careiq_api` login already belonged to `careiq_clinical_runtime`. An attempted redundant membership grant was rejected by automatic approval review before execution and was not retried. No separate runtime membership grant was needed or performed; the reviewed migrations installed their normal schema, policies and group privileges. The actual restricted API credential then passed `db:verify` against the hosted database.

Object ownership and API/operator credential separation were preserved. The API's Render connection was not replaced by the owner credential. Temporary operator/runtime credential files were removed after verification. The current backup and private logs remain outside the repository with owner-only access; the task-owned local rehearsal container, data volume and internal network were removed. Existing local review infrastructure was untouched.

## Final checks

| Check | Observed result |
| --- | --- |
| Deployed `NODE_ENV=production pnpm --filter ./apps/api release:verify` | Passed in Render Web Shell, actual deployed environment |
| API `/health` | 200; status ok, service careiq-api, database connected |
| API unsigned `/api/v1/me` | 401 |
| Web `/sign-in` | 200; actual login form rendered in a fresh browser |
| Web `/sign-up` | 200 |
| Web `/design-preview` | 404 |

No broad application test rerun was needed because application source was unchanged; [PR #11 CI evidence](../pr-11-ci/README.md) applies to the identical source tree. The restore/upgrade/runtime and deployed production checks cover this configuration/database promotion.

## Google sign-in follow-up

The missing Google OAuth client ID and its intermediate trailing-space error were corrected in the production Clerk connection. Completing Google consent exposed a separate cold callback rendering defect. Manually resuming Clerk advanced to its required organization task; [PR #12](https://github.com/kriscodes/careiq/pull/12) contains the tested automatic callback fix. Both CI workflows passed and the PR merged as main `60eff886`; [web deployment dep-dbc3mfe8bjmc73d5etfg](https://dashboard.render.com/web/srv-dau6ipqd0e5s73efagk0/deploys/dep-dbc3mfe8bjmc73d5etfg) is verified live. The public sign-in bundle contains the callback fix and API health remains connected. A fresh Google sign-in for the intended work account returned directly to the required organization setup task. Organization setup and the owner-approved creation of Kristian's Care with Main Location completed on October 21; the owner subsequently approved and saved Main Location access. [PR #14](https://github.com/kriscodes/careiq/pull/14) fixed the session-refresh loading loop and is live on API/web as main `1c99f18`. The owner approved two Admin view permissions; Main Location’s real front desk and notification inbox returned 200 and the completed read-only workspace is verified. [Diagnosis, configuration and acceptance evidence](google-oauth.md).

## Practice selection follow-up

The selected team had no linked CareIQ practice, so the page repeated the chooser. The user requested a new practice and approved creation eligibility for the verified work account only. [Navigation fix and setup evidence](practice-selection.md).

## Acceptance boundary

Deployment repair is verified. The deployment repair did not manually create users or organizations or change founder eligibility, practice mapping, role assignment or legacy-to-location activation. The owner-approved Google account flow is recorded separately above. The intended work account's fresh Google return, normal practice creation, explicitly approved Main Location assignment and read-only front desk access are verified. The subsequent owner-approved onboarding and two application-wide Admin view permissions are recorded in the linked practice setup evidence. Signed webhook delivery/replay, provider email/MFA/recovery and installed-device acceptance remain separate. Optional delivery, notification worker, scanning, native authentication and protected audit-reader activation were not enabled. This record does not authorize real-patient use.
