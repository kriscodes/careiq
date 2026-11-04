# Staging migration-50 fallback checkpoint — November 3, 2026

This is a progress checkpoint, not release acceptance. The isolated staging database was initialized and the exact fallback API/web builds became live. Public checks and the separate isolated production-backup restore rehearsal pass. Authenticated fixture creation, current runtime ledger/storage inspection, candidate deployment, provider rollback and return-to-candidate phases remain pending. Production application services, database and marketing deployment remain unchanged.

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

Provider service metadata independently confirmed the region, environment, source branch, disabled automatic deployments, plan, health paths and disk configuration. Provider disk configuration is not a substitute for inspecting the running process's directory ownership and actual mounted filesystem.

## Database initialization evidence

The successful initializer ran from approved fallback `af8ed1a` between `2026-11-04T03:45:58.290Z` and `03:46:49.820Z`. Its sanitized phase record confirms:

- The exact staging provider identity and empty owner target were verified; external TLS certificate verification passed.
- The actual repository migrator applied and verified 50 entries. Repeating the same migrator left the ledger unchanged.
- The restricted login was created, the reviewed runtime grant applied, and restricted `db:verify` passed.
- The temporary individual operator IP allowance was removed. Empty allowlist readback succeeded and a fresh external connection was not accepted.

Initializer ledger digest: `8afda774bd24fb363f3c64c78d6bf67400752f104579d510fd1f2a72f388f684`. Its encoding is SHA-256 over JSON of ordered `[hash, String(created_at)]` pairs, following `ORDER BY created_at,id`. This is initialization evidence, not a later post-deployment inspection or proof of preservation across a rollback.

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

The operator subsequently observed normal HTTPS access to the staging web custom domain. The API custom-domain certificate and HTTP 200 response were verified with normal TLS validation while explicitly resolving the hostname to its published provider address. Both configured system DNS servers returned `NOERROR` with the correct API CNAME, but macOS system resolution and Chrome still retained stale `NXDOMAIN` behavior. Ordinary API hostname resolution is therefore not yet accepted end to end. No DNS configuration change or certificate-verification bypass was used to disguise this discrepancy.

The Clerk setup record at `2026-11-04T04:11:46.225Z` identifies synthetic founder `user_3Lcu6v9W31ZGexFF4NoSmsxk8cj`. It confirms organizations enabled, creator role `org:admin`, organization slugs enabled, organization domains disabled, and that synthetic user's self-deletion and organization-creation flags disabled. Its email was administratively marked verified; this is not proof of email ownership or a completed provider challenge. No sign-in ticket or normal CareIQ onboarding was recorded by that setup step. That early record still listed dashboard checks as remaining. Before Blueprint approval, the operator saved, reloaded and read back the global settings: membership optional on, automatic first-organization creation off, organization slugs on, user-created organizations off and user self-deletion off. No Clerk organization or CareIQ tenant has been created yet.

Normal password sign-in later reached a genuine email-verification challenge. The reserved example-domain identity cannot supply an ordinary inbox verification, so authenticated onboarding and synthetic application fixtures are not complete. A deliberately approved administrative setup session or a usable test inbox remains a pending choice. Neither an administrative session nor an administrative email flag will be reported as successful password/challenge acceptance. Signed-webhook setup is also not proof of an end-to-end membership-reconciliation event.

A read-only live-service SSH attempt was rejected with `Permission denied (publickey)` before any runtime verification command ran. Account inspection showed no authorized SSH keys. A task-only key is prepared, but registration approval remains pending. Consequently, a fresh running-service 50-entry ledger digest, staging runtime `release:verify`/`db:verify` execution with its actual `NODE_ENV=production` and private-directory/mount metadata remain unverified. The database's public ingress stays closed.

## Remaining release gates and provenance

The rollback drill has **not started**. Initial fallback publication and public readiness are complete; the authenticated fallback baseline is still pending. Candidate deployment, retained-artifact provider rollback, measured recovery time, fixture/PDF preservation and return to the same candidate have not been performed.

The separate production-backup restore rehearsal **passed** from `2026-11-04T04:32:01.508Z` to `04:32:12.091Z`. The fresh native archive recorded at `04:12 UTC` was 90,648 bytes with SHA-256 `3f11a405fc0fd0f3a20ad6ecbaf772360822e0dc9e02b8d362e7bc3bc227e0ab`. The isolated local PostgreSQL rehearsal verified full restored baseline catalog equivalence, applied migration 49→50 as a non-superuser/non-BYPASSRLS managed owner using immutable fallback `af8ed1a`, verified an immediate unchanged repeat, and passed restricted runtime database verification. The task container was removed successfully. API, shared-package and lockfile sources were independently confirmed identical between fallback `af8ed1a` and selected candidate `947e219`.

The clone used PostgreSQL 18.6 and Node 22.23.4 with no network access or published ports. Render-specific roles were represented by nonprivileged local placeholders; this does not reproduce the provider's internal platform capabilities. Generated local credentials and all task containers were removed and independently checked.

This validates restoration and migration rehearsal separately from the still-pending hosted rollback drill. Production remains on 49 migrations and was not modified. No backup URL, archive contents, production rows or credential values are included here, and no production migration or deployment has occurred.

Evidence retained privately outside Git includes the three initializer checkpoint records, the Clerk setup record, Blueprint planning/readback metadata, `careiq-staging-fallback-initial.json`, `careiq-current-release-checks.json` and the rehearsal `restore-rehearsal.json`. This document transcribes only safe identities, phase outcomes, hashes and public-check results. It does not publish secret-bearing operator files, browser state, provider sessions or backup access URLs. Later acceptance results should extend this checkpoint with their own timestamps, revisions and deploy IDs rather than overwriting the distinction between prepared and verified work.
