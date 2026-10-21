# Little hello verification — October 21, 2026

Implementation: [authentication](../../little-hello-authentication.md) and [emails](../../little-hello-emails.md).

All code and verification work used the existing canonical checkout. Existing unrelated documentation changes were preserved and excluded from the implementation commit. Tests used Node 22.23.2, pnpm 11.22.0, installed Chrome and an isolated loopback PostgreSQL `careiq_test` database. No hosted database was used.

## Executed checks

| Check | Result |
| --- | --- |
| Workspace unit/database suite (`pnpm test`) | 440 passed: API 330, web 93, marketing 9, i18n 5, interview contract 3; zero failures/skips. |
| Complete component browser suite | 88 passed, zero failures/skips/retries. Includes MFA, recovery, reset, invitation/account switching, session refresh, access boundaries, workflows and communications. |
| Actual local Next/Clerk read-only browser suite | 3 passed. Non-read requests are blocked; no credentials/codes are submitted. |
| Real browser/API/restricted-database suite | 3 passed with synthetic authenticated principals: signed/unsigned patient forms, immutable PDF/library access and staff insurance evidence/audit. Owned fixture cleanup confirmed. |
| Isolated production build | Next 16.4.1 webpack build and generated routes passed using reserved `.invalid` synthetic live-shaped configuration. |
| Production HTTP/CSP checks | 3 passed: fresh matching nonces, strict-dynamic, transport headers and protected preview/association paths. |
| Workspace lint and typecheck | Passed; final changed browser fixtures also passed targeted checks. |
| Security and association regressions | 16 security and 8 association tests passed. |
| Production dependency audit | No known vulnerabilities reported by `pnpm audit --prod`. |
| Offline Clerk template helper | 16 passed, including wrong-instance/source-drift protection, backup-first writes and no blind retries. No live template API was called. |
| Email layout | All 56 EN/ES examples fit 320px with dark OS preference, white backgrounds and loaded brand images. Representative desktop/mobile renders inspected. |
| Latest email worker assertions | 20 database-backed tests passed; branded white HTML reaches mocked providers, SMS has no HTML, patient fields remain absent and uncertain sends reconcile without duplicate delivery. |

The role lifecycle matrix includes owner administration and invitations for administrator, member and configured clinician roles, with explicit activation, locations and permissions. It also checks unknown roles, revocation, expiry, failed provider updates, ownership transfer and stale/replayed membership events. Patient account binding and foreign/revoked access checks run in the API suite. Unsupported representative authority is denied.

The Little hello browser regressions check desktop and 320px dark-system layouts, every input's light color scheme, locally loaded fonts/assets and valid MIME responses, keyboard recovery/help focus, provider allowlists, safe callback destinations, signup, error redaction, duplicate action locks and invitation ticket continuity. Social provider responses use controlled mocks. The installed Clerk lifecycle test verifies loaded/unloaded SDK behavior without claiming a real sign-in.

## Screenshots

The eight screen PNGs in this folder contain only synthetic component fixtures and visibly identify their mock identity/API context. Examples: [mobile sign-in](signin-dark-system-320.png), [desktop sign-up](signup-dark-system-1280.png), [mobile recovery](forgot-dark-system-320.png), [reset code](reset-code-dark-system-1280.png).

Email examples: [verification](email-verification-dark-system-1280.png), [password reset](email-reset-dark-system-320.png), [Spanish team invitation](email-invitation-es-dark-system-320.png). Names, codes, dates and links are fictional. These browser renders do not prove email-client behavior.

## Remaining live acceptance

Dedicated safe test inboxes/accounts are needed for actual owner, administrator, member, configured staff and adult-patient sign-in, password reset and invitation delivery/redemption. Provider connections must be enabled in the intended Clerk instance before the custom allowlist is configured. Clerk email templates need instance-specific inspection/export, review and activation; new lifecycle notification renderers do not create automatic events. Gmail, Apple Mail and Outlook rendering, sender DNS and actual delivery were not tested here.

No real authentication email was sent, no hosted provider template was changed, and no remote deployment was performed as part of these checks. Local logs, provider fixture values and database connection settings remain in ignored private storage.
