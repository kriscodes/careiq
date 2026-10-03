# Security release status — October 3, 2026 UTC

## Release 1: no production migration required

[PR #3](https://github.com/kriscodes/careiq/pull/3) merged to `main` as `82d93cb`. It contains the idle-pool crash fix, web framing/security headers, patched Next.js/qs dependencies, a CI workflow and release documentation. GitHub verification succeeded for the reviewed commit. Live HTTPS checks at 07:04 UTC confirmed the web now returns the new CSP/framing/content-type/referrer headers and no powered-by header. API `/health` returned 200 with database connected. The API health response does not expose a release ID, so its exact running commit remains unverified without Render access. Main-branch CI also passed after merge.

Marketing dependencies and the shared verification workflow were merged separately in [PR #4](https://github.com/kriscodes/careiq/pull/4) to `codex/deploy-marketing` as `d0748b5`, after both GitHub verification runs passed. Intake and indexing are still disabled. Fresh public JavaScript on both the Render marketing origin and careiqlabs.com reports Next.js 16.3.6; the disabled form and noindex state were preserved. The web runtime also reports 16.3.6.

## Release 2: complete clinical-security implementation

[Draft PR #5](https://github.com/kriscodes/careiq/pull/5), on `codex/security-fixes`, adds administrator/member capabilities, validation, bounded pagination, in-memory client retry attempts, durable tenant-scoped idempotency and append-only clinical audit events. Migration 0015 and checked clinical-runtime/audit-reader grants are included. See [the complete rollout procedure](../security-hardening.md).

All 103 local tests passed without skips, and the branch GitHub verification run passed.

This release must not be promoted until the production migration and restricted runtime role are verified. The available local database configuration points at `careiq_dev`; it is not the recorded production database. Production credentials and current Render service configuration were not accessible in this task. The browser connection could not initialize/verify its administrator policy, and no alternate browser-control workaround was used.

## Owner actions and unresolved account work

- **Completed:** the owner confirmed `kristian@careiqlabs.com` is set up and tested on October 3, 2026. Kristian is the intended reviewer/contact. Intake remains disabled pending production configuration, review/deletion procedures and a hosted submission check.
- The owner has signed back into Render and Clerk. A fresh browser check still failed during browser app-server initialization, so dashboard access is not restored for this task. Once the connection works, verify production database identity, migration credentials, restricted runtime connection, service branches and deployment settings. Do not paste secrets into Git, documentation or chat.
- Prepare Clerk production authentication, including organization/user mapping and domain/provider configuration. A publishable development key is public configuration, not a secret leak, but it is not a completed production setup.
- Review and adopt the proposed [backup and retention procedure](../backup-retention.md), then verify the actual production settings and restore evidence. Configure required CI checks/hosting deployment gates if desired.
- Complete the hosted administrator/member and two-practice walkthrough after release 2 is deployed.

The custom marketing apex and www are already reachable over HTTPS; www redirects to apex. Older DNS/certificate-pending statements in the original marketing handoff are historical. Marketing intake and indexing remain intentionally disabled. There is no evidence from this work that these remaining steps are technically impossible; they require working account access and the owner decisions above.
