# CareIQ marketing deployment handoff

> Historical initial deployment record. October 2–3 follow-up: apex and www now resolve over HTTPS, and www redirects to apex. Intake and indexing remain disabled; `kristian@careiqlabs.com` is now confirmed set up and tested. The API/schema/restricted-runtime security release is deployed; intake configuration and hosted submission/retry/deletion acceptance remain outstanding. See [current security release status](security-release-status.md) and the [complete rollout guide](../security-hardening.md) before using the older prerequisite checklist below.

The marketing application is a separate Next.js static export in `apps/marketing`. The authenticated product remains in `apps/web`, and the existing Express API remains responsible for database access. The initial marketing deployment keeps search indexing and interview submission disabled while the production intake prerequisites are completed.

## Deployment state

| Item | Verified state |
| --- | --- |
| Source | Deployment branch `codex/deploy-marketing`, commit `61014b9`, pushed to the existing CareIQ repository |
| Review | [Draft pull request #2](https://github.com/kriscodes/careiq/pull/2) |
| Local checkout | Work performed in an isolated clone; the original local checkout was not changed |
| Render location | `Care IQ Labs` workspace, `CareIQ` project, `Production` environment |
| Marketing service ID | `srv-db096cdg1s2s73d3gng0` |
| Marketing Render URL | [careiq-marketing.onrender.com](https://careiq-marketing.onrender.com) |
| Hosted build/deploy result | Live; deploy `dep-db096clg1s2s73d3goj0`, code commit `61014b9`, completed in 34.1 seconds on October 2, 2026 (Pacific) |
| Apex/www custom domains and TLS | Both added in Render; `www` redirects to apex. Waiting for DNS and certificate verification; Namecheap sign-in is pending |
| Hosted route and browser checks | Home, both privacy paths, icon, robots and sitemap HTTP 200; missing route HTTP 404. Desktop/mobile, navigation, FAQ and unavailable form verified |

The API service is `srv-darjgre0tbcc73brvbmg`, at [careiq-api-7ssz.onrender.com](https://careiq-api-7ssz.onrender.com). It was running `main` commit `5e9904c`, and its health check returned HTTP 200. The authenticated product service is `srv-dau6ipqd0e5s73efagk0`, at [careiq-web.onrender.com](https://careiq-web.onrender.com). Preserve both service URLs and their current configuration during the marketing rollout.

## Marketing Render configuration

Use a **new Render Static Site**, not a Node web service. The checked-in template is [marketing.render.yaml](marketing.render.yaml), with the full application guide in [marketing.md](../marketing.md).

| Setting | Value |
| --- | --- |
| Repository root directory | Leave blank; build from the monorepo root |
| Initial branch | `codex/deploy-marketing` |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @careiq/marketing... build` |
| Publish directory | `apps/marketing/out` |
| Start command | None; Render serves the static export |
| Node | `22.23.2`, set through `NODE_VERSION` |
| pnpm | `11.22.0`, pinned by the root `packageManager` and `devEngines.packageManager` fields |
| Dependency installation | `SKIP_INSTALL_DEPS=true`, because the build command explicitly installs dependencies |

The workspace filter includes the shared `@careiq/interview-contract` package. It does not build the authenticated product. Do not use `next start`, the API start command, or the marketing preview server as the production start command.

Preserve the template's `/privacy` and `/privacy/` rewrites to `/privacy/index.html`, and its response headers. Keep `404.html` at the publish root. A catch-all rewrite to `/index.html` would conceal missing routes and must not be added.

All `NEXT_PUBLIC_*` values are embedded at build time. Every change requires a rebuild.

| Variable | Initial deployment | Intake/public launch |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://careiqlabs.com` | Same canonical origin |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `false` | Set `true` only after custom-domain, intake and launch checks pass |
| `NEXT_PUBLIC_API_URL` | `https://careiq-api-7ssz.onrender.com` | Same origin, without `/api/v1` |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | Omit; monitored address pending user input | A real, tested privacy/deletion mailbox |
| `NEXT_PUBLIC_APP_URL` | Optional; use the existing verified product URL if shown | Keep the existing product URL until the app-domain migration is verified |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional; omit if no confirmed public mailbox | A verified monitored mailbox, if desired |
| `NEXT_PUBLIC_FOUNDER_LINKEDIN_URL` | Optional; omit if unverified | Only the confirmed founder profile |

Missing API URL or privacy email disables form submission. Indexing also requires the canonical apex origin, a privacy email and an HTTPS API origin. No database credentials, Clerk secrets or mail credentials belong in marketing configuration.

## Validation completed

- Workspace lint and type checks passed. The production Next.js build passed using the installed Next CLI directly. The pnpm build wrapper encountered a local sandbox subprocess restriction. Render subsequently ran the documented pnpm build command successfully with Node 22.23.2 and pnpm 11.22.0; no framework or package-manager changes were needed.
- All 50 tests passed with no skips: 39 API, 8 marketing and 3 shared-contract tests. Database integration used an isolated PostgreSQL 18 instance. Migrations were applied twice; the second application was a no-op.
- Source and exported HTML checks confirmed home/privacy titles, descriptions, canonical URLs, Open Graph/Twitter metadata, responsive viewport and the CareIQ SVG favicon. All internal page and anchor links in the exported home, privacy and 404 pages resolved.
- The initial export intentionally contains `noindex, nofollow`, a `robots.txt` that disallows crawling, and an empty sitemap. An indexed production rebuild must instead advertise the canonical home and privacy URLs.
- Form behavior covers validation, successful persistence responses, retry keys, unavailable service, rate limiting, network failure and timeout. Recoverable errors retain entered details; the form does not store those details in localStorage or URLs.
- Live browser checks verified desktop appearance, mobile navigation and CTA at 390px, and the privacy page at 320px. Page width matched viewport width with no horizontal overflow. FAQ click and Enter-key toggling and privacy-to-home navigation worked. The live form explicitly reports unavailability and all inputs/submission controls are disabled.
- Both privacy rewrites and the template's three response headers were saved in Render. HTTPS responses confirmed `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY`.
- Live API preflight retained the existing product allow-origin. A preflight from the marketing Render origin had no `Access-Control-Allow-Origin`, confirming production marketing CORS still needs configuration. No contact data was submitted to production.

The static Render hostname and routes are verified over HTTPS. Custom-domain DNS/TLS, production intake grants and successful live submission remain unverified. No production database migration, credential change, API redeploy or app-domain cutover was performed.

## Production intake prerequisites

A read-only check of production database `careiq_n8yp` found 14 applied migrations, with latest migration timestamp `1790047000000`. The new `marketing_interview_requests` table was absent. The checked connection used role `careiq_owner`, which owns the database and has `CREATEROLE` and `CREATEDB`; it is neither superuser nor `BYPASSRLS`. This is not a suitable restricted marketing runtime role.

Production intake requires the following controlled work before enabling the form:

1. Supply and test the monitored privacy/deletion mailbox. Confirm who will review requests and handle follow-up, deletion, retention and backup handling under the published notice.
2. Prepare a non-owning API runtime login with only the permissions needed by the existing product and the marketing insert operation. Do not grant membership in an owner/admin role or broadly copy its privileges. Validate existing authenticated product operations and tenant isolation with the restricted role before switching the API connection.
3. Verify the hosted database target and apply migration `0014_marketing-interview-requests.sql` through the repository's migration process using authorized migration credentials. The migration creates the separate contact table and `careiq_marketing_submitter` group. Do not reset the database or run migrations on application startup.
4. Run `apps/api/src/db/grant-marketing-submitter.sql` with operator credentials and the actual restricted runtime role. The script rejects unsafe ownership, privilege and membership combinations. Confirm the runtime can insert and perform retry conflict checks but cannot read contact columns or update/delete requests.
5. Deploy the API changes from the reviewed marketing branch while preserving the current API hostname and existing product configuration. Keep `INTERVIEW_REQUESTS_ENABLED=false` until migration and runtime verification are complete. Preserve the current production TLS mode, `DATABASE_SSL_MODE=require`, for its existing internal Render connection; do not weaken it to `disable`.
6. Extend `CORS_ORIGINS` while retaining its existing `http://localhost:3001,https://careiq-web.onrender.com` entries. Add `https://careiqlabs.com,https://www.careiqlabs.com`. Add the exact marketing Render origin only if intake testing from that origin is intended. Verify allowed-origin preflight and rejected-origin behavior on the hosted API.
7. Establish `TRUSTED_PROXY_CIDRS` from verified Render proxy information and test forwarding behavior. Do not trust every proxy or use an arbitrary hop count. With no proxy trust, visitors may share one address-based limiter bucket. The current limiter is process-local; keep one API instance for this initial design.
8. Enable API `INTERVIEW_REQUESTS_ENABLED=true`, rebuild marketing with the verified API origin and privacy mailbox, and perform one synthetic hosted submission, same-key retry and operator deletion check. Confirm one row is created for the retry pair without exposing contact details in logs.

The form requests a discovery interview. It does not automatically send an email, book an appointment or subscribe someone to a newsletter. An operator must review saved requests and personally coordinate follow-up. No public listing endpoint or staff-app CRM was added.

## Domains and manual DNS steps

The DNS inspection found Namecheap `registrar-servers` nameservers. No apex A record or `www`, `app` or `api` CNAME was observed at that check. This is a point-in-time observation; recheck the live zone before changing it and preserve mail/TXT and unrelated records.

| Hostname | Intended destination | Current action |
| --- | --- | --- |
| `careiqlabs.com` | New marketing Static Site | Added in Render; Namecheap `A` record, host `@`, value `216.24.57.1` required |
| `www.careiqlabs.com` | Marketing, redirecting to the apex | Added in Render; Namecheap `CNAME`, host `www`, value `careiq-marketing.onrender.com` required |
| `app.careiqlabs.com` | Existing authenticated product | Defer DNS cutover until Clerk and product-domain preparation is complete |
| `api.careiqlabs.com` | Existing API | Preserve the current API URL until a separate safe alias migration is verified |

The records above are the exact values shown by Render. In Namecheap Advanced DNS, add/update only these web records, remove conflicting web records or AAAA records for these two hosts if present, and preserve mail/TXT and unrelated records. A one-minute TTL is suitable during setup. Then use Verify on each domain in [Render settings](https://dashboard.render.com/static/srv-db096cdg1s2s73d3gng0/settings), wait for TLS, and check apex HTTPS and the www-to-apex redirect. Namecheap is currently at its sign-in page; DNS has not been changed. See [Render's Namecheap DNS guide](https://render.com/docs/configure-namecheap-dns).

For a later product-domain migration, first prepare the existing web service's custom domain and the Clerk production application's domain/origin/redirect configuration for `app.careiqlabs.com`. Confirm the required Clerk configuration before changing application DNS. Add the new app origin to API CORS while retaining the current product origin. Then configure DNS/TLS and verify sign-in, sign-out, callbacks and authenticated API requests before changing the marketing app link or retiring the old URL. Marketing remains independent of Clerk.

For a later API-domain migration, first add `api.careiqlabs.com` to the existing API service and verify DNS/TLS plus health and public/authenticated endpoints through the new alias. Keep `https://careiq-api-7ssz.onrender.com` available while clients transition. Update the marketing and product API origins only after the alias works, and rebuild each client because those values are public build-time settings. Update any other known consumers deliberately; a marketing launch does not require this migration.

## Remaining hosted acceptance checks

The Render-hostname acceptance checks listed above passed. Repeat them on the apex after DNS verification, including both privacy URLs, mobile navigation, the custom HTTP 404 and the www redirect.

After intake prerequisites are complete, repeat the form's valid, invalid and recoverable-error flows against the hosted API and verify persistence and deletion with operator access. Finally rebuild with indexing enabled for the canonical domain, inspect the resulting metadata/robots/sitemap, and ensure independent previews remain unindexed. Once the custom domain is stable, consider disabling the marketing service's default Render alias to avoid a duplicate public site.

Outstanding owner input: complete Namecheap sign-in and supply the monitored privacy mailbox plus the request-review/deletion owner. The database runtime credential setup and controlled API rollout remain prerequisites for enabling intake. After the API rollout is ready, review/merge PR #2 and change the marketing service's branch to `main` as part of the controlled promotion; do not silently merge while production API auto-deployment behavior is unresolved.
