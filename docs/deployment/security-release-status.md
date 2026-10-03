# Security release status — October 3, 2026 UTC

## Deployed and verified

[PR #5](https://github.com/kriscodes/careiq/pull/5) merged to main as `fe77a653bd4991f42775d331ba2553635d802b7d`. Render shows that commit live for API and WEB. It deploys admin-create/member-view authorization, tenant-scoped durable retry protection, metadata-only audit writes, input limits and bounded pagination. The earlier PR #3 dependency, database-pool and response-header fixes remain included.

The reviewed release passed 103 tests, lint, type checks, production builds, all 16 migrations and migration replay on PostgreSQL 18.6, with no reported production dependency vulnerabilities. GitHub Actions run 37146456289 passed for reviewed head `12e9266b4bbe4833740261df4d5bc77fd856770c`.

| Component | Evidence |
| --- | --- |
| DB | Confirmed hosted database `careiq_n8yp`; migrations 0014 and 0015 applied, 16 total; rerun was a no-op. No reset performed. |
| API | Code deploy `dep-db0mc37f3r2c73b8b240`; restricted-connection deploy `dep-db0mgr8u01pc73b13mk0`. Live shell query confirms `current_user=careiq_api` and superuser/createdb/createrole/bypassrls are all false. `/health` returns 200 with database connected. |
| WEB | Deploy `dep-db0mc37f3r2c73b8b200`, commit `fe77a65`, live. Administrator synthetic patient and appointment creation passed; appointment and patient persisted after refresh. Switching to the second existing practice showed zero patients/appointments and cleared the first practice's selected details. |
| MARKETING | Existing patched static deployment remains live on `codex/deploy-marketing`. Intake and indexing remain disabled. No successful live intake/retry/deletion test is claimed. |

The first environment save did not persist the restricted URL. A live identity check caught the owner login still in use. The owner refreshed the restricted credential, the field was entered using the browser's form controls, its saved value was checked privately, and another deployment plus live SQL verification confirmed the correction. No credentials are included in this report. Preserve `DATABASE_SSL_MODE=require` for the current internal Render connection; it is encryption without full certificate verification, not a claim of verify-full validation.

## Backup and migration evidence

A fresh native export from 20:08 UTC (archive completed 20:09:24 UTC) was restored into isolated PostgreSQL 18.6 with networking disabled and no published ports. Before migrations it contained 2 practices, 1 patient, 1 appointment and 14 migration entries. The owner confirmed those records are synthetic. Forced patient/appointment RLS was present. Migrations 0014–0015 and both checked runtime grants were rehearsed on the restore before production changes. Restricted-role checks deny audit reads, patient deletion and reading marketing email fields; tenant-scoped reads did not cross practices.

Render Hobby currently provides 3-day PITR and 7-day native logical-export retention. This exercise verifies one provider-native export restoration. Independent encrypted storage, daily scheduling, failure alerts, 35-day expiration and restoration with a current external deletion/hold ledger are **not configured or verified**. The owner has no AWS account yet. See [backup and retention](../backup-retention.md).

## Authentication and DNS

The approved `app.careiqlabs.com` hostname is registered in Render, verified, and has an issued HTTPS certificate. Namecheap now contains its CNAME plus the five exact Clerk production CNAMEs. Existing apex/www, Google MX, SPF, DKIM and DMARC records were preserved. Clerk verified frontend API, account portal and all three email records.

A separate Clerk production instance was created with owner approval. The running API/WEB still use development Clerk configuration until production provider configuration, user/practice mappings and end-to-end sign-in are tested. Google production OAuth credentials remain a setup dependency. Do not switch keys merely because DNS is verified. Existing mappings are not automatically transferred between Clerk instances.

## Synthetic/demo-only decision and remaining work

The owner explicitly declined a paid HIPAA upgrade for now and chose synthetic/demo use while comparing costs. Render is Hobby with HIPAA disabled. No BAA signature, HIPAA workspace enablement or real-PHI launch approval occurred. See [hosting comparison](hosting-options.md).

- Complete production Clerk provider configuration and map approved users/organizations to the right practices.
- Finish hosted member-write-denial, deliberate cross-practice API request and same-key retry acceptance. The automated suite covers these cases; the signed-in browser checks above do not replace those live cases.
- Configure independent backups, alerts, expiration, recovery-key handling and a second restore exercise using that independent storage.
- Validate practice-specific retention inputs and approved defaults; implement durable external holds/deletion ledger, complete customer exports and safe replay after restoration. No clinical purge is enabled.
- Marketing: mailbox `kristian@careiqlabs.com` is confirmed tested and Kristian is the intended reviewer. Adopt the review/deletion procedure, verify trusted proxy configuration, configure API CORS/intake and marketing build variables, then test submission/retry/deletion before indexing.
- Review applicable customer/vendor agreements and appropriate PHI hosting before any real patient information.

No remaining item has been proven technically impossible. Some depend on owner accounts, provider configuration, agreements and practice-specific legal decisions; others remain implementation and acceptance work. Native backup restoration and a healthy release must not be described as complete production readiness.
