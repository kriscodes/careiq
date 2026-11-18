# CareIQ staging promotion and marketing

The November 17 provider inventory confirms `careiq-staging-web`, `careiq-staging-api`, and `careiq-staging-db` already exist in Virginia. Marketing staging does not yet exist. The web/API currently follow `release/migration-50-fallback-2026-11-03` with automatic deployment off; production marketing still follows `release/marketing-product-first-2026-11-15`.

The reviewed [`render-staging.yaml`](render-staging.yaml) proposes switching the existing staging web/API to `staging`, gating deployments on passing checks, and adding `careiq-staging-marketing` to the same project/environment. It preserves the database's name, user, PostgreSQL version, region, runtime role requirement, and the API's private disk/provisioning guards.

| Surface | Staging origin |
| --- | --- |
| Staff app (existing) | `https://staging.careiqlabs.com` |
| API (existing) | `https://api-staging.careiqlabs.com` |
| Marketing (new, pending) | `https://marketing-staging.careiqlabs.com` |

Marketing links to the staging staff app and staging API. Indexing stays disabled. Research requests, deliveries, and notification workers stay disabled; no production provider accounts, messages, or patient records are used. The new marketing service has no dedicated database. Its privacy/contact email configuration remains blank so the initial preview cannot submit interview requests.

The API's restricted `careiq_api` DATABASE_URL must remain a stage-only login, not the database owner connection. The separate staging Clerk instance, signed webhook settings, cursor secret, disk, and synthetic user setup remain in place. A Blueprint `sync: false` field does not rotate or overwrite an existing secret. There is no production service/database in this file.

Before promoting application code, reconcile the canonical checkout with the current approved source and validate any pending migrations on an isolated database. This review branch was based on the existing canonical marketing checkout without fetching or replacing local work. Migrations remain an explicit release step; a push must not run an unreviewed production migration.

The [November 3 checkpoint](../verification/staging-rollback-2026-11-03.md) records a passed backup-restore rehearsal but an incomplete hosted rollback drill. Complete authenticated fixture checks, candidate → retained fallback → candidate, and record actual recovery evidence before claiming the drill passed.

When production marketing is eventually promoted, explicitly reconcile its live release-branch pin with the reviewed production source. Do not assume merging `main` updates a service that follows another branch.

## Promotion workflow

1. Work on a feature/review branch. Open a pull request to `staging` and require the repository's existing CI checks. CI runs on pull requests and pushes to both `staging` and `main`.
2. After initial activation, staging services follow `staging` with `autoDeployTrigger: checksPass`. Wait for the actual deployed revision, then verify the UI, API health, error/denial behavior, and relevant persistence using synthetic data.
3. Promote the reviewed changes through a `staging` → `main` pull request. Require CI again and verify its source tree matches the version reviewed in staging, apart from documented environment settings. If it differs, test that candidate in staging first.
4. Production remains a deliberate promotion to its configured production branch. Do not merge or change a Blueprint while review-only work is pending: Blueprint sync can itself change infrastructure or trigger a build.
5. Retain the previous successful deployment. Roll back application code only after checking database compatibility; application rollback does not roll back database contents. Rehearse restore/migration work on an isolated copy with synthetic fixtures.

## Initial activation — still pending

These commits prepare configuration; no resource, DNS record, remote branch, provider setting, or deployment was changed. Creating a Render service triggers its first deployment even when automatic deployments are off. Activate only after the user reviews the result and asks to deploy.

At activation, create `staging` from the approved source, review the provider's Blueprint plan, confirm workspace/resource names and costs, configure stage-only secrets, and install the exact DNS records Render provides. Set up branch protection separately; workflow files do not create branch protection. Keep Blueprint Auto Sync off during initial wiring and review future configuration syncs explicitly.

Use the custom staging domains for end-to-end checks. `onrender.com` aliases are not automatically included in browser origin allowlists. Staging is public unless separately access-controlled; `X-Robots-Tag: noindex, nofollow, noarchive` discourages indexing but is not authentication. Use synthetic data only.

## Initial staging branch validation

The release branch is reconciled onto `79f53275a29e676ec660f239c591906151b4e93f`; only the six staging configuration/documentation files were applied. There is no API runtime or migration diff from the existing staging fallback. The first branch push supplies an all-zero `before` SHA: CI now explicitly compares that event with the fetched default branch, while retaining the supplied base for ordinary pushes, PRs, merge groups, and manual runs. Coverage thresholds remain unchanged.
