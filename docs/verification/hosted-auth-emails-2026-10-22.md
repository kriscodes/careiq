# Hosted authentication emails — October 22, 2026

The matching Clerk **Development** instance used by the five QA accounts now serves Little hello authentication/security emails. All 16 selected templates were updated and fetched again with exact body/subject matches to the reviewed plan. Eleven unrelated templates remained unchanged, out of 27 total. Original template names, subjects, sender/reply-to values, enabled/delivery flags and editor markup were preserved. Production acceptance is separate.

## Applied scope and content

| Group | Applied provider slugs |
| --- | --- |
| Verification and recovery | `verification_code`, `reset_password_code` |
| Email links | `magic_link_sign_in`, `magic_link_sign_up`, `magic_link_user_profile` |
| Invitations | `invitation`, `organization_invitation`, `organization_invitation_accepted` |
| Account security | `account_locked`, `mfa_enabled`, `new_device_sign_in`, `password_changed`, `password_removed`, `primary_email_address_changed`, `passkey_added`, `passkey_removed` |

Billing, commerce, opaque-token and waitlist templates were excluded. English matches the current hosted source language; the separate Spanish catalog is not a dynamically activated Clerk locale. Authentication copy is independent of practice role. Generic verification wording applies to the verification the recipient started, without claiming signup, sign-in or enrolled MFA. Invitation acceptance does not promise clinical activation. Security guidance remains present when optional new-device action/support URLs are missing.

White canvas and cards, blue actions and headings, the approved wordmark/companion, inline colors and light-only metadata replace the previous provider layout. The actual provider footer remains and is responsive. Public immutable PNG downloads were verified against the approved local files. The currently undeployed application asset URLs returned 404, so emails use the public asset URLs pinned to repository commit `42b81b78186580f670c6934130481b6f11518ca9`; these images contain no recipient information.

## Provider preservation and validation

Private inspection, plan, previews and exclusive pre-change backups remain in ignored, owner-only local storage. No credentials, account IDs, message links, codes, real recipient/device details or session artifacts are included here. Each source was fingerprinted; apply rechecked every selected live source before its first write.

Functional expressions, escaping helpers, required variables, complete condition/else structure and expression contexts were retained. Every dynamic action anchor retains its original URL, count and conditional context, including fallback and optional sign-out/support links. Only the documented `app_logo` presentation partial was replaced with the paired verified images; `footer` remains. Original subjects are preserved byte-for-byte.

The first save was rejected with HTTP 422 / `form_param_missing` for `name`. Full fingerprint reconciliation confirmed all 27 templates were still unchanged. The live endpoint requires this field despite its published schema marking it optional. The corrected transport echoes the exact inspected template name, keeps it outside editable plan fields, and rejects an unexpected rename. A fresh exclusive backup preceded the successful application. No delivery or sender workaround was used.

## Verification results

- Installer/preservation regressions: 20 passed. Mapped-copy regressions: 31 passed. These cover source drift, backup/partial failure, name echo, conditional contexts, action counts, safety boundaries and optional new-device recovery guidance.
- All 16 templates rendered successfully through Clerk’s documented preview endpoint with expanded provider variables/partials.
- Final browser coverage: 64 template/width/system-theme combinations, using 320px and 640px viewports with both light and dark system preferences. Authored backgrounds stayed white, images loaded, and no horizontal overflow occurred. After the new-device guidance correction, only its four affected combinations needed a fresh visual check.
- All 16 actual provider updates were confirmed and fetched again. Readbacks match the reviewed plan; all 11 unselected templates retain their full original fingerprints.
- One fresh reset request through the actual local recovery UI for the approved QA owner reached code entry without errors. Its new message arrived at the exact approved Gmail alias. Delivered MIME content contains the Little hello marker, “A fresh start.” heading, white/light metadata, both image URLs and “A little more room to care.” footer.
- No code was used and no password changed. This receipt confirms delivered branding content, not completed authentication or Gmail/Apple Mail/Outlook visual acceptance.

## Representative provider previews

These screenshots contain **Clerk’s fictional preview data**, including a sample code and sample device details. They are not live authentication messages or completed sign-in/reset evidence.

| Message | Mobile | Desktop |
| --- | --- | --- |
| Password reset | [320px](hosted-auth-emails-2026-10-22/reset_password_code-320.png) | [640px](hosted-auth-emails-2026-10-22/reset_password_code-640.png) |
| Organization invitation | [320px](hosted-auth-emails-2026-10-22/organization_invitation-320.png) | [640px](hosted-auth-emails-2026-10-22/organization_invitation-640.png) |
| New device | [320px](hosted-auth-emails-2026-10-22/new_device_sign_in-320.png) | [640px](hosted-auth-emails-2026-10-22/new_device_sign_in-640.png) |

## Remaining manual acceptance

Follow the [five-persona walkthrough](../qa-auth-manual-checks.md), completing the owner before administrator, member, clinician and patient. Use a clean browser context and codes from the current browser attempt. Enter codes and new passwords privately. Verify incorrect-code handling, successful password/challenge completion, actual reset completion, old-password rejection, other-session revocation, new-password sign-in and unchanged role/patient access. Earlier setup tickets and fictional previews cannot satisfy these checks.

Visual inbox acceptance remains for Gmail, Apple Mail and Outlook in light/dark modes and with images blocked. Record client-forced color overrides separately from authored white HTML. Real invitation email-link redemption, actual second-practice isolation and provider OAuth identities remain separate checks. Existing accepted invitations and Gmail aliases cannot stand in for those flows. Account records remain Created / Development, and SW-T78 remains In progress with remaining acceptance recorded.

See the [email implementation/activation guide](../little-hello-emails.md) and [QA account guide](../qa-test-accounts.md).
