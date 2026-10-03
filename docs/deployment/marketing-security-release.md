# Marketing security release — October 3, 2026

This release updates the marketing application's Next.js and matching ESLint configuration from 16.3.3 to 16.3.6. It merges `main` commit `82d93cb` into the marketing deployment history, retaining the already-reviewed API pool recovery, authenticated-web security headers, CI workflow, and workspace `qs` override at 6.16.0. Marketing source, copy, static-export configuration, and Render settings are unchanged.

This is a dependency-only marketing rollout. It adds no database migration and does not include clinical-security migration 0015 or the new clinical permissions/retry interface. Deploy the existing static-site build and publish `apps/marketing/out` using the established marketing deployment process. Confirm the hosting release separately; this preparation did not push or deploy the branch.

## Keep intake and indexing disabled

Preserve `NEXT_PUBLIC_ALLOW_INDEXING=false`, leave `NEXT_PUBLIC_PRIVACY_EMAIL` unset, and keep the API's `INTERVIEW_REQUESTS_ENABLED=false`. The proposed `kristian@careiqlabs.com` mailbox has not been verified. This release does not configure that mailbox or satisfy the remaining intake schema, grants, API/CORS/proxy, and hosted submission prerequisites in [marketing launch status](marketing-launch-status.md).

## Verification

- All eight marketing tests passed.
- Workspace lint and type checks passed.
- The marketing production build passed using Next.js 16.3.6 with the canonical site/API origins, indexing disabled, and no privacy mailbox. The package-script wrapper could not bind a temporary compiler worker port locally; invoking the installed Next.js compiler directly with approved worker permissions completed the same production build.
- The generated home and privacy pages contain `noindex`, `robots.txt` disallows indexing, and the interview form remains disabled with its unavailability message.
- The production dependency audit reported no known vulnerabilities.
- The regenerated lockfile contains the patched versions. Marketing source and deployment configuration match the prior marketing deployment branch, and the final diff has no whitespace errors.

Database integration tests were not repeated for this dependency-only marketing release. Production mailbox behavior, signed-in clinical workflows, and hosted deployment remain outside these checks. Roll back by redeploying the prior marketing commit; no schema rollback is needed.
