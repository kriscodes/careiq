# Interface languages and dropdowns

CareIQ's launch interface languages are English and Spanish. The header language control is available in staff workflows, account setup and sign-in, patient requests, mobile screens and the public website. Planned Chinese (Simplified/Traditional), Filipino, Vietnamese and Arabic locales are registered but deliberately unavailable until complete catalogs and acceptance checks exist.

## Text ownership

Application copy lives in `packages/i18n/catalogs/{en,es}/`: `workflow.json`, `access.json`, `mobile.json`, `common.json` and `errors.json`. Keys are stable identifiers. Change the value to edit wording; do not rename a key merely because the wording changes. Use whole sentences with named `{parameters}` and ICU plural/select branches instead of joining translated sentence fragments. The dependency-free shared module supplies interpolation, locale resolution, formatting and API-code mappings to both web and native apps.

The website's existing structured English content remains in `apps/marketing/src/content/site-content.json`, paired with `site-content.es.json`. SDK-owned Clerk panels use the official pinned `@clerk/localizations` resources. Browser/OS file pickers, device prompts and hosted provider emails are outside application-owned copy.

Patient/practice names, notes, uploaded filenames, custom roles/catalog labels, published template content, consent wording and signed documents remain authored content. Changing interface language does not translate or revise them. Domain enums, API paths/payload codes, audit codes, idempotency keys and scheduling instants stay stable. Display formatting is separate from machine date keys, dates of birth and clinic time zones.

## Preferences

Web resolves an allowlisted explicit preference or browser language with English fallback. Staff and patient use separate cookies/storage keys; patient pages never inherit the staff setting. Signed-in staff preferences also use Clerk's nonclinical `unsafeMetadata.careiqLocale` field, which has no role in authorization. Account saves are serialized and coalesced so a late earlier save cannot replace a newer choice. A profile-save failure leaves the device choice usable and displays a translated notice. Native preferences use separate secure device keys for staff/patient and synchronize staff account preferences without remounting active screens.

Language switching preserves current records, entered form values, uploaded selections, signature state and command attempts. Web server metadata and SDK dictionaries refresh through the existing server Clerk provider while client state is preserved. No language switch sends a business command or re-exchanges a patient access token.

## Dropdowns

Shared styling is in `packages/i18n/web.css`. Native `<select>` controls retain their form submission, validation, keyboard and touch semantics. Browsers supporting customizable selects receive the padded option panel, border, rounded corners, shadow, hover/focus states and selected checkmark through `appearance: base-select`. Other browsers retain their accessible native option picker and styled control. Native app option panels use the same spacing and selected-state treatment. Touch targets remain at least 44px.

## Adding a language

1. Add matching, nonblank catalog files and preserve every parameter name. Add the website and SDK dictionaries where applicable.
2. Register the locale, autonym and direction. Keep it unavailable while translating/reviewing.
3. Check all catalog key/parameter parity and typed source references; test long labels, errors, empty/loading states, dialogs, forms and narrow layouts.
4. For Arabic, complete direction-aware layout and mixed-direction testing before enabling it. Multilingual generated documents additionally need Unicode fonts/text shaping; the existing PDF renderer is a separate document-content dependency.
5. Enable the locale only after its complete interface is verified.

## Local verification

Run `pnpm --filter @careiq/i18n test`, web/mobile/marketing typechecks, lint and unit tests, and `PLAYWRIGHT_CHANNEL=chrome pnpm --filter web test:browser`. New browser cases cover preference persistence, patient/staff separation, form preservation, native dropdown spacing/keyboard behavior and account-write ordering. Work remains local to this checkout; no deployment is part of this change.

Completed checks and screenshots are recorded in [the October 17 verification](verification/i18n-2026-10-17/README.md). Physical iOS/Android device acceptance remains open.
