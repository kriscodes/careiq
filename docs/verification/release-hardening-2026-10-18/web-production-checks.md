# Web and marketing production checks — October 18, 2026

Local production mechanics pass. Hosted identity, hosted rollout and signed-in production acceptance remain open. These checks do not authorize deployment or establish a real-patient launch. All application changes are in the canonical `/Users/kristian/Documents/Server/CareIQ` checkout; nothing was committed, staged, pushed or deployed by this review.

## Fixed

Marketing interview submissions now refuse HTTP redirects and suppress the referrer. A 307/308 therefore cannot replay submitted contact details to a redirected origin. Existing cookie omission, no-store and timeout handling remain. The ninth marketing test uses native fetch and two task-owned loopback HTTP servers: the configured origin receives one request, the redirect receiver receives zero and the caller gets a recoverable error. No external service receives the synthetic fields. [Transport checks](web-marketing-transport.json), [separate real HTTP receipt](web-marketing-redirect-real-http.json).

## Verified locally

| Check | Result and boundary |
| --- | --- |
| Web units, lint, types | 73 tests pass, no skips; lint and TypeScript pass. [Receipt](web-unit-checks.json). |
| Marketing units, lint, types | Final 9 tests pass, no skips; lint and TypeScript pass after the source/test changes. [Final receipt](web-marketing-transport.json). |
| Component browser | 53 pass, zero skips/flakes. Synthetic identities/API fixtures cover auth retry/MFA, stationary hover across 90 passive provider transitions, stable enabled pointer, deliberate pending submission lock, duplicate prevention, access gates, workflows, audit and localization. |
| Production HTTP browser | 3 pass, zero skips/flakes, against isolated production Next on 127.0.0.1:3191 with reserved `.invalid` live-shaped fixtures. Preview/encoded aliases are 404, fresh matching Clerk/Next nonce CSP has no unsafe-eval, sign-in HTML is no-store, and absent owner association files are 404. |
| Actual read-only Next/Clerk | 3 pass against preserved localhost:3101 in a fresh unauthenticated browser context. Real pages render; password visibility, safe return intent, recovery/help keyboard controls, invitation fallback and 320px layout work. Non-GET/HEAD/OPTIONS requests are blocked. No password/code/provider mutation or signed-in success is claimed. [Browser receipt](web-browser-checks.json). |
| Marketing exported pages | 11 assertions pass against actual final exported files on owned 127.0.0.1:3192: root/privacy 200, real missing-page 404, disabled intake/indexing, no overflow at 1440/390/320px, keyboard menu/focus return, light color scheme, no page errors and disabled no-JavaScript form. Non-loopback/non-read browser requests are blocked. [Receipt](web-marketing-export-browser.json). |
| Production builds | Isolated webpack web and marketing builds pass. Marketing source fix is rebuilt successfully. Web uses synthetic reserved-host configuration; marketing intake/indexing are disabled. [Builds](web-production-builds.json), [marketing rebuild](web-marketing-transport.json). |
| Public output scan | 39 web client files and 41 final marketing export files have zero reviewed private database/secret-key/private-key markers. This bounded marker scan does not prove the absence of every possible secret. [Receipt](web-bundle-scan.json). |
| Process cleanup | Owned 3191/3192 stopped and final ports are closed. Existing services were preserved; no screenshots/traces/video, user sessions or hosted data were retained. Temporary generated web tsconfig includes were removed; next-env files are unchanged. [Receipt](web-cleanup.json). |

The first Playwright launcher failed with EACCES before executing any test while `pnpm exec` refreshed workspace metadata. The direct installed CLI repeat passed all 56 component/production checks; the original launch failure is retained in its receipt. A temporary marketing harness initially called Playwright `isDisabled()` on a fieldset itself; it was corrected to check the disabled attribute and actual descendant input. The final exported-page check passes. No application source change was needed for either verification-harness issue.

## Current hosted evidence

These are credential-free read-only checks of the currently deployed services, with deployed commit unknown. Default OS TLS verification passes for every request; no certificate bypass is used. Python's initial bundled trust store lacked an issuer, so the completed check used the operating system curl trust store. No response bodies, cookies, patient records, key values or redirect query strings are saved. [Sanitized hosted receipt](web-hosted-readonly.json).

| Endpoint/check | Observed |
| --- | --- |
| `https://app.careiqlabs.com/` | 200, public static-shell cache header `s-maxage=31536000`; public HTML references a Clerk test-mode publishable key and a `clerk.accounts.dev` asset host. Only mode markers are recorded. This is not acceptance of matching live production identity configuration. |
| Application `/sign-in` | 404. The reviewed local account routes are not available at this deployed path. |
| Application `/design-preview`, `/workflow-preview` | Both 404. |
| `https://careiqlabs.com/` and `/privacy/` | Both 200. Root metadata is noindex/nofollow; form fieldset is disabled and native form method is POST. |
| `https://www.careiqlabs.com/` | 301 to the HTTPS apex. |
| Marketing `/robots.txt` | 200, disallows all indexing. |
| `https://careiq-api-7ssz.onrender.com/health` | 200, no-store. Health body is not retained. |
| Hosted API `/api/v1/patients` without credentials | 401, no-store. Response body is not retained. |
| API OPTIONS from `https://app.careiqlabs.com` | 204, exact allowed origin. |
| API OPTIONS from `https://untrusted.release.invalid` | 204 with no allowed-origin header, so browser cross-origin access is denied. |

Live headers reflect the older deployed implementation: application responses use baseline CSP and `strict-origin-when-cross-origin`, while the reviewed local build supplies nonce CSP and no-referrer. HSTS was not observed on these public responses. The root cache header alone is not evidence that patient data is cached; this check is anonymous and retains no body. Confirm edge transport policy and actual authenticated private-page no-store behavior during the approved rollout.

## Production acceptance still requiring actual environment inputs

- Deploy the reviewed commit through the separate approved release path; the user's no-push instruction remains in force. Record deployed API/web commits and actual hosting build/branch/filter/pre-deploy configuration. A source release does not migrate the database.
- Supply the intended approved production Clerk instance, matching live keys, configured providers, MFA/recovery, exact HTTPS redirects/origins and deliberate production user/organization/practice/location mappings. Do not infer that existing development identities exist in production or silently switch keys.
- Use approved synthetic owner and invited-staff accounts in two practices to exercise real sign-in, invitation delivery/redemption, setup/resume, least-privilege roles/location assignment, clinical save/reload, cross-practice patient/document denial, immutable signed-copy retrieval, retry, revoked access and protected audit evidence. Fresh read-only rendering and synthetic fixture identities do not replace these cases.
- Verify actual provider email/MFA/recovery and webhook delivery/replay using the owning environment. No provider tickets, personal sessions, messages or account changes were made here. Automatic paperwork email delivery cannot be certified from a queued notification intent alone.
- Complete hosted backup restoration/migration/runtime verification, durable private-file/scanner/worker and audit configuration, and installed-device/native association acceptance under their corresponding operator guides. Local web builds and static exports do not establish those operational controls.

No release tag was created and no hosted configuration was changed.
