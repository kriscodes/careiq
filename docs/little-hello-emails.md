# Little hello emails

Little hello now runs in the existing patient and staff email delivery paths. Each email includes a white HTML layout, CareIQ blue, the small companion, a readable plain-text alternative, and one clear next step. The reusable catalog also implements the 27 approved authentication and access messages in English and Spanish. Rendering a template never creates a send event.

## Where the code lives

| File | Purpose |
| --- | --- |
| `apps/api/src/notifications/little-hello-copy.ts` | The 27 approved message purposes, plus the existing generic staff work update. |
| `apps/api/src/notifications/little-hello-email.ts` | Pure validation, localization and HTML/text rendering. |
| `apps/api/src/notifications/patient-delivery-policy.ts` | Existing request/reminder/completed-copy emails use the shared renderer; SMS retains its original plain copy and footer. |
| `apps/api/src/services/staff-notifications.service.ts` | Existing immediate/digest batches use the shared renderer and existing locale preference. |
| `apps/api/src/notifications/delivery-provider.ts` | Sends HTML beside text to Resend, with the same durable idempotency key. |
| `scripts/export-little-hello-emails.ts` | Offline, fictional HTML/text examples for review. |
| `scripts/little-hello-clerk-emails.mjs` | Separate inspect/export/apply tooling for provider-owned authentication templates. |

## Sending boundaries

| Messages | Current behavior |
| --- | --- |
| Email verification, sign-in code, password reset, email MFA and organization invitation | Clerk remains the sender. The API does not send duplicate versions. Provider template inspection and activation are separate from application deployment. |
| Patient secure request, reminder and completed-copy notice | The existing durable queue sends branded HTML and text after its current eligibility, permission, expiry, verified-destination and provider checks. Patient dispatch stays English because it has no confirmed recipient locale field. |
| Staff work updates | The existing immediate/digest queue sends generic branded HTML and text. Existing EN/ES preferences, quiet hours, destination checks and membership checks remain authoritative. |
| Password changed, new sign-in, MFA added/removed, email change, provider linked/unlinked, recovery code used | Reusable EN/ES renderers exist. No new local event sender is enabled. Use verified provider security events and a durable idempotent delivery design before adding a sender. |
| Invitation reminder/expiry, pending owner confirmation, owner join review, access ready/changed/removed, owner welcome | Reusable EN/ES renderers exist. No new local outgoing event is enabled. Check current definitive access state before introducing these notices; temporary suspension during role review is not access removal. |
| Patient portal invitation | Renderer only. It does not create a portal grant or send an invitation. Existing adult-self identity binding remains required. |
| Representative/caregiver | No authority or invitation flow is enabled. Do not adapt patient or team invitations to this role. |

There is no extra CareIQ email after every OAuth sign-in. Follow the selected provider's new-device/risk notification policy. A linked/unlinked notice describes a verified authenticated linking event, which is different from signing in with an already linked provider.

Existing unknown sends remain lookup-only; HTML does not reset an intent, rotate a key or create another attempt. Patient render hashes now include the HTML part. Staff branding configuration is validated before a batch enters the durable submitting state, so a malformed optional asset base cannot strand an unsent batch as unknown. Global delivery gates and the background worker still default to disabled. No real email, provider template update or hosted configuration change was performed during this implementation.

## Rendering and data rules

`renderLittleHelloEmail` accepts an explicit purpose and `en` or `es`. It returns `subject`, `preheader`, `html`, `text`, `templateId`, `templateVersion` and `locale`. There is no generic raw HTML, password, saved recovery code, patient answer or attachment input.

- Identity messages share the same copy before any practice role is established. A trusted first name is optional; missing names render “Hello,” or “Hola:”. Never infer names from email addresses.
- Verification codes are exactly six digits and accepted only by verification, sign-in, reset, email MFA and new-email verification purposes. Recovery-code-use notices cannot contain the saved code.
- Practice roles must come from freshly verified membership, never signup input or a query parameter. Supported variants are owner, administrator, team member and a configured staff role with its trusted label. The renderer cannot establish this trust itself; callers must resolve current authorization before creating the message.
- Role details preserve practice and actual invitation expiry context. Missing optional event/expiry details are omitted. No renderer invents expiry dates, locations, device details or recovery guarantees.
- Patient messages accept no identity or clinical values. Staff work emails accept only a bounded update count and the application link. These messages contain no patient names, IDs, work item details, answers or attachments.
- Text and attributes are escaped. Control characters, unknown fields/purposes/locales, invalid codes and inappropriate role context are rejected with `EMAIL_RENDER_INPUT_INVALID`.
- Actions require HTTPS and the configured application origin. Patient request and library actions are restricted to their intended routes. Only organization invitation purposes can use an additional explicitly trusted provider origin. Image sources require a separate public HTTPS base.

Example internal usage:

```ts
const email = renderLittleHelloEmail({
  purpose: 'password_reset_code',
  locale: 'en',
  origin: configuredApplicationOrigin,
  values: { code: providerVerificationCode },
  assetBaseUrl: configuredEmailAssetBase,
});
```

This example renders only. Clerk-owned reset delivery stays with Clerk; do not call the application delivery provider from this example.

## Brand assets and white tones

Optionally set `CAREIQ_EMAIL_ASSET_BASE_URL` to a public HTTPS base ending in `/`, for example `https://YOUR-APP/brand/little-hello/`. It must serve:

- `careiq-wordmark.png`
- `little-hello-companion.png`

Both assets are included in `apps/web/public/brand/little-hello/`. No recipient information is added to image URLs. The renderer uses conventional image links rather than base64/data URLs. When no base is configured, the email has a text wordmark and a blue plus fallback.

The HTML uses inline colors and explicit light-only metadata; it does not follow the computer's dark preference. Heading and body stacks include Georgia and Arial fallbacks. Inbox clients may block images or fonts, alter colors or render table corners differently. A browser check is not a substitute for Gmail, Apple Mail and Outlook acceptance testing.

## Offline examples

From the repository root:

```sh
apps/api/node_modules/.bin/tsx scripts/export-little-hello-emails.ts --help
apps/api/node_modules/.bin/tsx scripts/export-little-hello-emails.ts --origin https://careiq.example.test --out .local-review/email-examples
```

An optional `--asset-base https://YOUR-APP/brand/little-hello/` uses the real public brand image URLs. The exporter writes 56 EN/ES examples: 27 authentication/access purposes plus the existing staff update. Names, codes, dates and links are fictional. Existing files are not overwritten. Its `catalog.json` is a review bundle, not a provider-variable mapping and not permission to send.

## Clerk template activation

The installed `@clerk/backend` SDK has no email-template endpoint. The helper uses Clerk's documented template REST endpoints, which are deprecated. If they are unavailable, it stops; there is no speculative fallback API or automatic activation. See the [Clerk template guide](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates) and [official API schema](https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml).

Default invocation and offline plan construction do not use credentials or network. The helper reads no `.env` file. Only explicit `--inspect` and `--apply` commands use the externally supplied `CLERK_SECRET_KEY`. Snapshot/plan/backup files are private and must stay in ignored local storage.

```sh
node scripts/little-hello-clerk-emails.mjs --help
# Read-only provider inspection, when preparing activation:
node scripts/little-hello-clerk-emails.mjs --inspect --out .local-review/clerk-before.json
# Offline transformation of that exact instance's returned templates:
node scripts/little-hello-clerk-emails.mjs --snapshot .local-review/clerk-before.json --out .local-review/clerk-plan.json --brand-origin https://YOUR-APP
# Separate provider write, after the exported plan and inbox behavior are reviewed:
node scripts/little-hello-clerk-emails.mjs --apply .local-review/clerk-plan.json --backup .local-review/clerk-backup.json
```

The default transformation wraps the actual inspected provider body in a white CareIQ envelope, with the real companion beside the wordmark and the footer “A little more room to care.” It preserves the original subject, all source expressions and dynamic action hrefs. It does not guess provider slugs, role tokens, code fields, link fields or expiry values. Existing source that follows dark preferences, including `light-dark()`, requires an explicitly reviewed replacement; it is not silently rewritten.

An optional reviewed bundle can use `{schemaVersion: 1, templates: [{id, subject, html, text}]}` with `{schemaVersion: 1, mappings: [{slug, templateId}]}`. Pass them with `--catalog` and `--mappings` during offline export. Slugs must exist in the inspected instance. All original expressions, required variables and dynamic action hrefs must remain; otherwise export stops. Ordinary fictional review examples will fail these checks and must not be treated as live provider templates.

Apply rechecks the instance and every exact source fingerprint before any change, writes an exclusive private backup, and updates only subject/body. Sender, reply-to, delivery/enabled settings and provider editor markup are excluded. A partial failure stops and reports confirmed slugs; it never retries blindly or sends a message. Existing editor markup may need manual dashboard synchronization before later visual editing. Inspecting or applying a template does not validate actual inbox delivery.

## Verification

Executed locally with synthetic fixtures and mocked provider calls:

- API TypeScript check passed.
- Email renderer and existing delivery policy regressions: 27 tests passed, covering all 28 purposes in both languages, escaping, control characters, codes, role boundaries, purpose-specific fields, origins/routes, fallback assets, SMS preservation and stable Resend payload keys.
- Provider exporter/installer: 16 tests passed, including offline defaults, variable/action preservation, source drift, wrong instance, backup failure, partial apply and delivery-setting preservation.
- All 56 branded examples were rendered in installed Chrome at 320 px with the computer theme emulated as dark. Backgrounds stayed white, no horizontal overflow occurred and both real brand images loaded. Desktop verification and representative mobile screenshots were inspected locally under `.local-review/little-hello-email-branded/`.

The final isolated loopback run passed all 20 patient/staff delivery worker tests, including assertions that the actual mocked email-provider payload contains white, light-only HTML without patient identifiers; SMS has no HTML. The full workspace suite passed 440 tests. See the [final verification record](verification/little-hello-2026-10-21/README.md). A real Clerk instance, real provider template acceptance, synthetic mail to test inboxes, sender DNS and Gmail/Apple Mail/Outlook rendering were not exercised here. Nothing in these local checks enables delivery or representative access.
