# CareIQ Labs marketing website

The public site is `apps/marketing`; the authenticated product remains `apps/web`. The existing Express API owns database access. Read [ADR-016](decisions/016-public-marketing-interviews.md) for the public/tenant boundary and [marketing verification](marketing-verification.md) for actual checks and remaining evidence.

## Start locally

Use the repository's Node 22.23+ and pnpm 11.22.0. From the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/marketing/.env.example apps/marketing/.env.local
pnpm --filter @careiq/marketing dev
```

Open `http://localhost:3002`. The product stays on 3001; API stays on 3000. The homepage, privacy notice, FAQ and navigation work with no API, database or Clerk configuration. With no real privacy address the form remains unavailable. To test submissions, configure the marketing API URL and a real monitored privacy address, configure an isolated/local API database, apply migrations with migration credentials, grant the runtime role, set API `INTERVIEW_REQUESTS_ENABLED=true`, and run `pnpm --filter ./apps/api dev`. A localhost API process can still point to a remote database: always inspect the target before migration or test commands.

```sh
pnpm --filter @careiq/marketing... build
pnpm --filter @careiq/marketing typecheck
pnpm --filter @careiq/marketing lint
pnpm --filter @careiq/marketing test
pnpm --filter ./apps/api typecheck
pnpm --filter ./apps/api test
```

After building, stop the dev server and run `pnpm --filter @careiq/marketing preview` to serve the export on `http://127.0.0.1:3002` (IPv4 loopback). The preview serves only static files, including direct privacy and true custom 404 responses.

The production export is `apps/marketing/out`. It contains static HTML and assets, including `privacy/index.html` and `404.html`; `next start` is not used for this application.

## Edit website copy

Edit **`apps/marketing/src/content/site-content.json`**. It owns navigation, hero/sections, founder biography, FAQs, form labels/help/errors/status copy, footer, page titles/descriptions and privacy text. For example, change `hero.headline` to revise the headline, or append a `{ "question": "…", "answer": "…" }` object to `faq.items`. Keep the existing structure and use plain text; React renders it as text, never arbitrary HTML.

The TypeScript content contract and runtime validation reject missing/empty required fields and invalid collections while loading content. The marketing tests and production build exercise that validation. API role values come from `packages/interview-contract`, while their visible labels live in the JSON. Editing a role label does not change the API value. If privacy practices change, revise the notice text and deliberately update `PRIVACY_NOTICE_VERSION` in the shared package so newly saved records carry the applicable revision.

Run content tests, lint/typecheck and a build after edits. This is repository-managed content, **not a live CMS**: every copy or public-environment change requires a rebuild/redeploy.

## Design reuse

The reference is the actual `apps/web/src/app/globals.css` and the interview workspace, not the default Next.js starter assets. Marketing adapts the same light-only semantic colors: background `#f8faf9`, panel `#ffffff`, text `#2b3832`, muted `#626f68`, border `#e4e9e6`, accent `#496f5a`, soft `#f0f5f2`, hover `#f5f8f6`. It uses the same Segoe UI/system font stack, 10px controls, rounded surfaces, green focus ring, restrained line icons and wordmark treatment. The app's existing approved CSS mark may be reused; the Next/Vercel starter logos are not CareIQ assets.

These few primitives are intentionally adapted inside marketing, with source comments, to avoid risky changes to the staff UI. There are no cross-application imports. No real founder photograph or verified LinkedIn destination was supplied; the founder section works without them. The workflow is explicitly illustrative and has no live product data.

## Build-time public configuration

| Variable | Behavior |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Absolute website origin used for canonical URLs and sitemap. Use `http://localhost:3002` locally and `https://careiqlabs.com` for the intended production site. |
| `NEXT_PUBLIC_API_URL` | Existing CareIQ convention: the publicly reachable API origin/base, **without** `/api/v1`. The client adds `/api/v1/public/interview-requests`. No production localhost fallback. |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | Real monitored address for privacy/deletion requests. Missing value disables submission. Confirm mailbox operation before launch. |
| `NEXT_PUBLIC_ALLOW_INDEXING` | Default false. Only explicitly enable for the intended production origin after launch checks. Keep staging and previews false. |
| `NEXT_PUBLIC_APP_URL` | Optional verified application URL; omitted unless appropriate for public visitors. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional real public contact mailbox. |
| `NEXT_PUBLIC_FOUNDER_LINKEDIN_URL` | Optional verified founder profile. Do not guess a URL. |

Malformed configuration fails validation. These variables are public; never place database credentials, Clerk secrets or mail credentials in them. The site has no database or Clerk dependency. Public values are embedded into HTML/JavaScript at build time. Marketing introduces no remote fonts, analytics, ad pixels, session replay, scheduling embeds, newsletter service or browser persistence of form contents.

## API contract

`POST /api/v1/public/interview-requests`, `Content-Type: application/json`; maximum body 4KB. It is the sole new public operation (plus OPTIONS). No authentication or tenant context is required. The browser sends no Clerk token or cookies.

```json
{
  "name": "Synthetic Contact",
  "email": "synthetic@example.com",
  "role": "practice_manager",
  "practiceName": "Synthetic Practice",
  "submissionKey": "672c1148-4a95-473a-8a24-ce7823eeb383",
  "website": ""
}
```

`name` (120), `email` (254) and `role` are required; `practiceName` (160) is optional. The shared validator trims strings, normalizes email case, rejects control characters, rejects unknown fields and accepts general email providers. Roles: `practice_owner`, `practice_manager`, `administrative_staff`, `provider`, `other`. The `website` honeypot is bounded and must be empty. `submissionKey` is a bounded UUIDv4 generated with browser crypto, not a database ID. Clients may not choose record ID, status, source, privacy revision, practice or organization IDs.

A new submission and a recognized key retry both return `200 { "data": { "accepted": true } }` only after the database statement finishes. No record/contact values are returned. The browser retains a key across recoverable errors for the same payload, changes it when the payload changes, disables concurrent submission, and stores neither contact fields nor keys in localStorage/URLs. Reloading the page loses the key; intentionally repeated submissions with new keys are separate requests. The key remains unique for the record's lifetime; email is not unique. Never reuse a key for a different intended request.

Errors use the existing `{ "error": { "code", "message" } }` shape (validation may include safe field/error codes). Expected statuses: 400 invalid or honeypot; 413 oversized; 415 wrong media type; 429 rate limited with `Retry-After`; 503 submissions disabled; 500 persistence failure. Recoverable errors preserve entered values. Success does not send email, book a meeting, or subscribe the contact to marketing.

API configuration:

- `INTERVIEW_REQUESTS_ENABLED=true` explicitly enables accepting requests. Default false. Keep it false until migration, runtime privileges and privacy operations are ready.
- `CORS_ORIGINS` includes both existing product origins and marketing origins. Local defaults include `http://localhost:3001,http://localhost:3002`. In production supply an explicit comma-separated list, for example the existing product origin plus `https://careiqlabs.com,https://www.careiqlabs.com`. Origins are normalized, including accidental trailing slashes. Paths/wildcards/credentials are rejected. Preview origins must be deliberately added; no broad suffix match.
- `TRUSTED_PROXY_CIDRS` accepts only explicit proxy IPs/narrow CIDRs; empty trusts none. Determine the actual immediate Render proxy network from trusted deployment information before setting it. Do not set `true`, arbitrary hop counts, or `0.0.0.0/0`. Verify forged forwarding headers cannot create arbitrary client identities. Until configured, proxied visitors may share one limiter bucket.

The bounded in-memory limiter allows 5 attempts/address and 100 total attempts per 15-minute process window, counting malformed and failed attempts. It resets on process restart; multiple instances each have their own limits. Shared networks can be limited together. The global limit reduces write exposure but an attacker can consume it. This is a modest initial control, not a distributed bot-defense service; keep one instance initially and replace with shared infrastructure before scaling. No paid service is provisioned. CORS and the honeypot are not authentication or standalone bot protection.

## Database migration and runtime grants

`apps/api/drizzle/0014_marketing-interview-requests.sql` adds one business-contact table with UUIDv7 primary key, name/email/role, optional practice name, unique UUIDv4 submission key, fixed source, privacy notice revision and `timestamptz` creation default. Length/role/source/nonempty/key checks reinforce API validation. Only primary-key and retry-key indexes are created. The Drizzle snapshot and journal preserve all earlier migration entries.

The table is outside the tenant domain. It does not create a practice, organization, user or patient. It does not use `withTenant` or clinical audit records. Existing patients/appointments forced RLS remains unchanged. Runtime credentials must be separate from the migration/table owner, with no superuser, BYPASSRLS, role-management, or owner-role membership.

Migration 0014 revokes default grants on the **new table only**, and creates the non-login `careiq_marketing_submitter` group with INSERT plus SELECT on `submission_key` (needed by PostgreSQL for the explicit conflict target). No contact-column SELECT, UPDATE, DELETE, TRUNCATE or tenant privileges are granted. There is no unnecessary INSERT RETURNING. Migration must be run by an authorized role able to create/manage this group as well as the table.

On a confirmed local/test database, apply the migrations twice (the second run must be a no-op) and run the database tests. For any hosted target, migration is an explicit operator deployment step, never an application startup action. Do not use an unverified `DATABASE_URL` and never reset an existing database.

After migration, a trusted operator grants group membership to the **actual** API runtime role using:

```sh
psql "$OPERATOR_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v runtime_role=actual_api_role \
  -f apps/api/src/db/grant-marketing-submitter.sql
```

The script checks role ownership/privilege and table/column grants across every transitive membership in a transaction, rolling back unsafe configurations. It also rejects server-file/program roles and ADMIN-only memberships that could restore inherited access. Substitute a verified role name. It does not grant clinical access or alter existing RLS. If the cluster already has a role named `careiq_marketing_submitter`, review its existing ownership, object grants and members before granting membership: role names are cluster-wide, and the migration does not remove unrelated privileges from a pre-existing group. Use the newly created dedicated group path for a clean deployment. Recheck after any future default-grant or role-membership changes. The test suite uses an actual restricted PostgreSQL login; this is different from HTTP tests with an injected store.

## Trusted operator review and deletion

Use the existing trusted database administration access, separately from API runtime credentials. There is no public list/export route and no staff-app CRM. Limit access to authorized interview operators and use encrypted connections for hosted databases. Avoid exporting requests or placing query results in tickets/logs.

Review only a bounded recent set in the trusted SQL client:

```sql
SELECT id, name, email, role, practice_name, privacy_notice_version, created_at
FROM public.marketing_interview_requests
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

For a deletion request, verify the requester through the monitored privacy contact. Look up and verify the exact request IDs using parameterized queries in a trusted client, then delete those IDs with operator credentials. Example parameterized operation:

```sql
DELETE FROM public.marketing_interview_requests WHERE id = $1::uuid;
```

Do not paste untrusted email/name text into SQL or delete solely by a guess at identity. This table does not silently inherit patient/audit retention. A request's deletion removes its retry key; a later resubmission can create a new request. Hosted backups and any manual correspondence have separate handling that the owner must confirm before launch. No retention period or automated purge is invented by this implementation.

## Separate Render Static Site

Create a **new** Static Site; do not rename/move the current web/API services or domains. An optional un-applied template is `docs/deployment/marketing.render.yaml`.

- Repository root directory: leave unset (repository root).
- Build: `pnpm install --frozen-lockfile && pnpm --filter @careiq/marketing... build`.
- Publish directory: `apps/marketing/out`.
- Start command: none.
- Node: repository-compatible Node 22.23+; pnpm 11.22.0.
- Set `SKIP_INSTALL_DEPS=true` to use the explicit install command.
- The workspace dependency is `@careiq/interview-contract`, a dependency-free JavaScript package whose build performs syntax validation. The filter's `...` includes it. Marketing does not build or deploy the authenticated application.
- Set public environment variables above in the build environment. The API URL must be its public HTTPS address, not a Render internal hostname. Retain existing API/database/Clerk configuration.

The export uses `trailingSlash: true`: `/privacy/` has its own `privacy/index.html`. Explicit rewrites for `/privacy` and `/privacy/` to `/privacy/index.html` are included in the template. Keep `404.html` at the publish root for a real custom not-found response. Do not add a blanket `/* → /index.html` SPA rewrite. Before launch, directly load both privacy URLs, refresh, and verify a random nonexistent path returns HTTP 404 with the custom page on Render; local export checks are not proof of the CDN configuration.

Add `careiqlabs.com` as the custom domain for the new marketing site. Follow the exact DNS records shown by Render and verify TLS/domain status. Adding the apex first makes Render add/redirect the corresponding `www` domain to the apex; retain the apex canonical in the build. Do not alter unrelated app/API domains. DNS/deployment have not been performed by this implementation.

Keep staging and preview builds at `NEXT_PUBLIC_ALLOW_INDEXING=false`; use separate environment settings so previews never inherit production indexing. For a public production build, set `NEXT_PUBLIC_SITE_URL=https://careiqlabs.com` and only then enable indexing after launch checks. Inspect generated robots, sitemap and page metadata. Once the custom domain works, consider disabling the production site's default onrender.com alias to avoid an indexed duplicate; do not disable independent preview services.

References: [Render Next.js static deployment](https://render.com/docs/deploy-nextjs-app), [static sites](https://render.com/docs/static-sites), [path rewrites](https://render.com/docs/redirects-rewrites), [custom domains](https://render.com/docs/custom-domains). Next.js behavior was verified against the installed 16.3.3 `dist/docs/01-app/02-guides/static-exports.md`.

## Public-launch checklist

- Supply and test a real monitored privacy/deletion mailbox; decide whether a separate contact address is needed. Do not publish a placeholder.
- Confirm actual hosting/database regions, access and service arrangements, technical logging and backups, operator access, retention/review/deletion practice, and handling of manual email correspondence. Revise the plain-language notice if actual deployment differs. Missing contact and unresolved handling practices are public-launch blockers.
- Apply migration 0014 through the controlled process; run the checked grant script against actual runtime credentials and verify production is not using owner/admin credentials. Local tests do not verify a hosted role.
- Confirm narrow proxy trust on the actual Render service, existing/product plus marketing CORS origins, API public HTTPS URL and single-instance abuse-protection limits.
- Set API `INTERVIEW_REQUESTS_ENABLED=true` only after those prerequisites. Rebuild marketing with real configuration; perform a hosted synthetic submission/retry and operator deletion check.
- Verify direct privacy navigation and real 404 status, mobile/keyboard behavior, TLS, apex/www redirects and production/preview indexing.
- Confirm an operator will review requests and personally coordinate by email. No automatic notification or booked meeting exists.

Optional founder photo, LinkedIn and public application link are not blockers. No compliance certification, business entity designation, customer outcome, employer endorsement or launch date is claimed.

## October 2026 security rollout

The intended monitored address is `kristian@careiqlabs.com`; the owner must still set up/test it before enabling intake. The API security release also requires migration0015 and checked clinical-runtime grants. Follow [security hardening](security-hardening.md) and [current release status](deployment/security-release-status.md) for the combined production rollout. The custom apex/www now work over HTTPS; this does not prove that intake is enabled.
