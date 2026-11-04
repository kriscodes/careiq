# Staging migration-50 fallback checkpoint — November 3, 2026

This is a progress checkpoint, not release acceptance. As of `2026-11-04T05:15:10Z`, the exact fallback API/web builds are live; ordinary custom-domain smoke checks, running-service production/storage verification, a separate read-only 50-entry ledger check and the isolated production-backup restore rehearsal pass. The new synthetic staging account completed password sign-in, but its email remains unverified and founder readiness is false. Authenticated fixture creation, a refreshed API fallback baseline, candidate deployment, provider rollback and return-to-candidate remain pending. Production application services, database and marketing deployment remain unchanged.

The record uses November 3 in the operator's America/Los_Angeles timezone. Event timestamps below are UTC on November 4. The [staging runbook](../deployment/staging-rollback.md) remains the procedure for completing acceptance.

## Approved source and checks

All seven checks (`verify`, `quality`, `dependency-audit`, `managed-owner`, `release-gate`, `codeql`, `secret-scan`) passed for these immutable revisions. They must be rechecked immediately before promotion.

| Purpose | Full commit | Observed status |
| --- | --- | --- |
| Application candidate | [`947e219a2bf4c359c2abbf7f6647c744c39c2b1a`](https://github.com/kriscodes/careiq/commit/947e219a2bf4c359c2abbf7f6647c744c39c2b1a) | Exact-commit gate passes; push and PR checks green; not deployed in this checkpoint |
| Migration-50 fallback | [`af8ed1aca1ccc159fc73589e39a2d1b7cb6e543a`](https://github.com/kriscodes/careiq/commit/af8ed1aca1ccc159fc73589e39a2d1b7cb6e543a) | Exact-commit checks pass; initial staging API/web deployments live |
| Independent marketing candidate | [`f724af8e50945554627e4d313ce4c5c9555efc01`](https://github.com/kriscodes/careiq/commit/f724af8e50945554627e4d313ce4c5c9555efc01) | Exact-commit gate passes; review branch published; production marketing not promoted |

Application candidate push evidence: [verification](https://github.com/kriscodes/careiq/actions/runs/41766220666), [readiness](https://github.com/kriscodes/careiq/actions/runs/41766220759), [security](https://github.com/kriscodes/careiq/actions/runs/41766220821). Marketing evidence: [verification](https://github.com/kriscodes/careiq/actions/runs/41765872556), [readiness](https://github.com/kriscodes/careiq/actions/runs/41765872437), [security](https://github.com/kriscodes/careiq/actions/runs/41765872466). The gate snapshot was recorded at `2026-11-04T03:25:38.375Z`. These checks do not substitute for the hosted rollback drill.

## Actual staging resources

| Resource | Verified identity/configuration |
| --- | --- |
| Workspace | Care IQ Labs / `tea-d38er5juibrs739omsmg` |
| Blueprint | `exs-dblam2rbc2fs73dnckig`; CareIQ Staging; auto-sync disabled; source `docs/deployment/render-staging.yaml` on the application release branch |
| Project/environment | CareIQ Staging / staging; `evm-dblb2eqjnfac73ff6jd0` |
| API | `srv-dblb2eqjnfac73ff6jo0`; Virginia; `0.5c-512mb`; `/health`; automatic deployments off |
| Web | `srv-dblb2eqjnfac73ff6jsg`; Virginia; `0.5c-512mb`; `/`; automatic deployments off |
| API disk | `dsk-dblb2eqjnfac73ff6kk0`; `careiq-staging-documents`; 1 GB at `/var/data` |
| Database | `dpg-dbl9tgegekts73fos8qg-a`; Virginia; PostgreSQL 18; `careiq_staging_db`; restricted runtime login `careiq_api`; final external allowlist empty |
| Service source branch | `release/migration-50-fallback-2026-11-03` |
| Public service origins | `https://careiq-staging-api.onrender.com`, `https://careiq-staging-web.onrender.com` |
| Custom staging origins | `https://api-staging.careiqlabs.com`, `https://staging.careiqlabs.com` |
| Separate Clerk application | `app_3LckKlr4CB4zTK6ibK7QMpkU7jQ` |
| Clerk production instance/frontend | `ins_3Lckkmrkb2zLHUc1qKEZKXSTkGE` / `clerk.staging.careiqlabs.com` |

Provider service metadata independently confirmed the region, environment, source branch, disabled automatic deployments, plan, health paths and disk configuration. The running process's production configuration, private-directory protections and actual mounted filesystem were subsequently checked at `05:02 UTC`, as recorded below.

## Database initialization evidence

The successful initializer ran from approved fallback `af8ed1a` between `2026-11-04T03:45:58.290Z` and `03:46:49.820Z`. Its sanitized phase record confirms:

- The exact staging provider identity and empty owner target were verified; external TLS certificate verification passed.
- The actual repository migrator applied and verified 50 entries. Repeating the same migrator left the ledger unchanged.
- The restricted login was created, the reviewed runtime grant applied, and restricted `db:verify` passed.
- The temporary individual operator IP allowance was removed. Empty allowlist readback succeeded and a fresh external connection was not accepted.

Initializer ledger digest: `8afda774bd24fb363f3c64c78d6bf67400752f104579d510fd1f2a72f388f684`. Its encoding is SHA-256 over JSON of ordered `[hash, String(created_at)]` pairs, following `ORDER BY created_at,id`. The separate read-only observation at `05:09 UTC` matched this digest. Neither observation proves preservation across a rollback.

Two earlier attempts stopped at a CLI-version preflight mismatch before database connection or role creation. Both restored and verified the empty allowlist; external denial was not verified in those earlier attempts. Their failed checkpoint records are retained instead of being relabeled successful.

## Initial fallback deployment and public checks

| Service | Immutable provider deploy | Started | Live |
| --- | --- | --- | --- |
| API | `dep-dblb2fajnfac73ff6l9g` | `04:14:53.020263Z` | `04:16:09.479354Z` |
| Web | `dep-dblb2f2jnfac73ff6l2g` | `04:14:52.784198Z` | `04:16:28.078912Z` |

Both were triggered by Blueprint sync and report the full fallback revision `af8ed1aca1ccc159fc73589e39a2d1b7cb6e543a`. Public checks on the **onrender.com origins** completed at `2026-11-04T04:18:46.149Z`:

- API `/health`: HTTP 200, exact fallback revision, `status: ok`, database connected, `Cache-Control: no-store`.
- Unsigned API `/api/v1/me`: HTTP 401 and `UNAUTHENTICATED`.
- Web release metadata: HTTP 200 with service `careiq-web` and the exact fallback revision.
- Web `/`, `/sign-in` and `/sign-up`: HTML 200, `nosniff`, frame denial, CSP `frame-ancestors 'none'`, `no-referrer` and `noindex` protections.
- Web `/design-preview`: HTTP 404.

These seven checks do not authenticate a user, inspect tenant records or establish a complete three-service production smoke pass. No marketing service is included in this isolated staging stack.

## DNS, identity and acceptance limits

Earlier custom-domain checks observed normal HTTPS access to staging web and verified the API certificate/HTTP 200 response with normal TLS validation while explicitly resolving the hostname to its published provider address. Both configured system DNS servers returned the correct API CNAME, while macOS system resolution and Chrome still retained stale `NXDOMAIN` behavior. That discrepancy remained a failed acceptance checkpoint; no DNS configuration change or certificate-verification bypass was used to disguise it.

At `04:52 UTC`, the two-origin smoke observer passed against `https://api-staging.careiqlabs.com` and `https://staging.careiqlabs.com` using ordinary hostname resolution and TLS verification. Both services reported the exact fallback revision, and database health, unsigned denial, public pages, protection headers and preview-route denial passed. This supersedes the earlier DNS blocker; it does not establish authenticated application acceptance.

The Clerk setup record at `2026-11-04T04:11:46.225Z` identifies synthetic founder `user_3Lcu6v9W31ZGexFF4NoSmsxk8cj`. It confirms organizations enabled, creator role `org:admin`, organization slugs enabled, organization domains disabled, and that synthetic user's self-deletion and organization-creation flags disabled. Its email was administratively marked verified; this is not proof of email ownership or a completed provider challenge. No sign-in ticket or normal CareIQ onboarding was recorded by that setup step. That early record still listed dashboard checks as remaining. Before Blueprint approval, the operator saved, reloaded and read back the global settings: membership optional on, automatic first-organization creation off, organization slugs on, user-created organizations off and user self-deletion off. No Clerk organization or CareIQ tenant has been created yet.

Password sign-in for the original example-domain fixture reached a genuine email challenge that its reserved address could not receive. The user subsequently selected a deliverable address for staging. An attempted administrative verification update was rejected by automatic approval review and was not applied; no administrative sign-in token was used. The original fixture remains unchanged and unused.

A separate marked synthetic account, `user_3Ld0zFQu0BsH1UOPAT52Gc4Twvf`, was created with its primary address explicitly **reserved and unverified**. Its password was stored privately before creation, and self-deletion and organization-creation remain disabled. Normal password sign-in succeeded. A genuine email code was sent through Clerk's Manage Account UI, and user completion remains pending. Read-only provider observation at `2026-11-04T05:14:20.837Z` confirmed `emailVerificationStatus: unverified`, `passwordEnabled: true` and founder readiness false. No email address, code, credential or browser authentication state is included here. This is not completed email-ownership verification, onboarding or MFA acceptance. Signed-webhook setup is also not proof of an end-to-end membership-reconciliation event.

At `2026-11-04T05:15:10Z`, the signed-in, unverified account selected **Set Up A New Practice**. CareIQ displayed **Verify Your Email** with its normal **Send Verification Code** control and blocked practice setup. This negative authorization check passed; no practice was created. The verification prompt remains open for the user.

The first read-only live-service SSH attempt failed with `Permission denied (publickey)` before any runtime command ran. After explicit approval, the temporary task-only public key was registered. At `05:02 UTC`, the running staging API's actual `NODE_ENV=production`, private storage directory and mounted filesystem checks passed. Both compiled release and database verifiers passed with the actual restricted runtime configuration; the owner credential was not installed as the API runtime credential.

At `05:09 UTC`, a separate owner-only, read-only ephemeral-shell check observed exactly 50 ledger entries and digest `8afda774bd24fb363f3c64c78d6bf67400752f104579d510fd1f2a72f388f684`, matching initialization. The database's public ingress remained closed. Ephemeral-shell removal follows the provider's documented lifecycle; independent removal verification was not obtained. The approved SSH key remains a temporary operator resource, not proof of a completed rollback.

## Remaining release gates and provenance

The rollback drill has **not started**. Initial fallback publication and public/runtime readiness are complete; email verification and the authenticated fallback baseline are still pending. After genuine verification and the subsequent founder allowlist change, deploy the same exact fallback `af8ed1aca1ccc159fc73589e39a2d1b7cb6e543a` to the staging API again and retain that new successful deployment as the rollback target with the approved founder configuration. The initial API deployment remains historical evidence. The original web fallback deployment remains a valid retained target while its configuration is unchanged; recheck its readiness and artifact availability before the drill. No founder setting change or replacement API baseline is claimed here.

No CareIQ tenant or application fixture has been created. Candidate deployment, retained-artifact provider rollback, measured recovery time, fixture/PDF preservation and return to the same candidate have not been performed.

The separate production-backup restore rehearsal **passed** from `2026-11-04T04:32:01.508Z` to `04:32:12.091Z`. The fresh native archive recorded at `04:12 UTC` was 90,648 bytes with SHA-256 `3f11a405fc0fd0f3a20ad6ecbaf772360822e0dc9e02b8d362e7bc3bc227e0ab`. The isolated local PostgreSQL rehearsal verified full restored baseline catalog equivalence, applied migration 49→50 as a non-superuser/non-BYPASSRLS managed owner using immutable fallback `af8ed1a`, verified an immediate unchanged repeat, and passed restricted runtime database verification. The task container was removed successfully. API, shared-package and lockfile sources were independently confirmed identical between fallback `af8ed1a` and selected candidate `947e219`.

The clone used PostgreSQL 18.6 and Node 22.23.4 with no network access or published ports. Render-specific roles were represented by nonprivileged local placeholders; this does not reproduce the provider's internal platform capabilities. Generated local credentials and all task containers were removed and independently checked.

This validates restoration and migration rehearsal separately from the still-pending hosted rollback drill. Production remains on 49 migrations and was not modified. No backup URL, archive contents, production rows or credential values are included here, and no production migration or deployment has occurred.

Evidence retained privately outside Git includes the three initializer checkpoint records, the Clerk setup and reserved-user/read-only verification records, Blueprint planning/readback metadata, initial and custom-domain smoke results, runtime/storage and ledger observations, `careiq-current-release-checks.json` and the rehearsal `restore-rehearsal.json`. A brief nonsensitive Software Kanban status update succeeded; the detailed Notion update was rejected and omitted. This document transcribes only safe identities, phase outcomes, hashes and public-check results. It does not publish secret-bearing operator files, browser state, provider sessions or backup access URLs. Later acceptance results should extend this checkpoint with their own timestamps, revisions and deploy IDs rather than overwriting the distinction between prepared and verified work.
