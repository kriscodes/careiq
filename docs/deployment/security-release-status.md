# Security release status — October 3, 2026 UTC

## Release 1: no production migration required

[PR #3](https://github.com/kriscodes/careiq/pull/3) merged to `main` as `82d93cb`. It contains the idle-pool crash fix, web framing/security headers, patched Next.js/qs dependencies, a CI workflow and release documentation. GitHub verification succeeded for the reviewed commit. Live HTTPS checks at 07:04 UTC confirmed the web now returns the new CSP/framing/content-type/referrer headers and no powered-by header. API `/health` returned 200 with database connected. The API health response does not expose a release ID, so its exact running commit remains unverified without Render access. Main-branch CI also passed after merge.

Marketing dependencies and the shared verification workflow were merged separately in [PR #4](https://github.com/kriscodes/careiq/pull/4) to `codex/deploy-marketing` as `d0748b5`, after both GitHub verification runs passed. Intake and indexing are still disabled. Exact hosted marketing revision awaits verification.

## Release 2: complete clinical-security implementation

The source on `codex/security-fixes` adds administrator/member capabilities, validation, bounded pagination, in-memory client retry attempts, durable tenant-scoped idempotency and append-only clinical audit events. Migration 0015 and checked clinical-runtime/audit-reader grants are included. See [the complete rollout procedure](../security-hardening.md).

This release must not be promoted until the production migration and restricted runtime role are verified. The available local database configuration points at `careiq_dev`; it is not the recorded production database. Production credentials and current Render service configuration were not accessible in this task. The browser connection could not initialize/verify its administrator policy, and no alternate browser-control workaround was used.

## Owner actions and unresolved account work

- Create or test `kristian@careiqlabs.com`, receive an external test message and send a reply. Confirm regular monitoring for interviews and privacy/deletion requests. Intake remains disabled pending confirmation.
- Restore authorized Render and Clerk access so production database identity, migration credentials, restricted runtime connection, service branches and deployment settings can be verified. Do not paste secrets into Git, documentation or chat.
- Prepare Clerk production authentication, including organization/user mapping and domain/provider configuration. A publishable development key is public configuration, not a secret leak, but it is not a completed production setup.
- Confirm backup/restore and the operating process for data retention, request review and deletion. Configure required CI checks/hosting deployment gates if desired.
- Complete the hosted administrator/member and two-practice walkthrough after release 2 is deployed.

The custom marketing apex and www are already reachable over HTTPS; www redirects to apex. Older DNS/certificate-pending statements in the original marketing handoff are historical. Marketing intake and indexing remain intentionally disabled. There is no evidence from this work that these remaining steps are technically impossible; they require working account access and the owner decisions above.
