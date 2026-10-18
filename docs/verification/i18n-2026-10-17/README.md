# Language layer and dropdown review — October 17, 2026

Implemented locally in /Users/kristian/Documents/Server/CareIQ. No changes were pushed or deployed.

## Delivered

- English and Spanish interface text for staff workflows, account access/setup, patient requests, mobile screens and the public website. The shared catalogs contain 2,034 messages per language; the website has 152 corresponding structured content values.
- Header language selectors with saved preferences. Staff account/device preferences and patient device preferences are independent. Switching languages preserves active forms, selections and workflow command attempts.
- Shared dropdown spacing, rounded option panels, hover/focus states and selected checkmarks. Native form/keyboard behavior is retained. Browsers without customizable-select support retain their native option picker.
- Safe translated errors, localized date/number display and official Clerk interface dictionaries. Patient-entered and authored document content, audit codes and API payload values retain their original meaning.
- Additional planned languages stay unavailable until complete translations and acceptance checks exist.

## Validation

| Check | Result |
| --- | --- |
| Shared catalog/locale tests | 5 passed |
| Web unit tests | 65 passed |
| Mobile unit tests | 56 passed |
| Public-site unit tests | 8 passed |
| Chrome component/browser tests | 40 passed |
| Shared package, web, mobile and public-site TypeScript checks | Passed |
| Web, mobile and public-site lint | Passed |
| Web and public-site production builds | Passed |
| Mobile production export for iOS, Android and web | Passed |
| Layout checks at 320, 390, 1024 and 1440 pixels | No horizontal overflow in 11 captured states |

Browser cases verify language persistence, independent patient/staff settings, preservation of entered values and failed-save drafts, unchanged workflow payload codes, serialized account saves, late-profile race handling, dropdown keyboard use, and narrow layouts. A focused independent source review found no material issue.

Builds used local review output directories and synthetic configuration for build-time checks. Existing local services were not deployed or replaced.

## Visual evidence

Screenshots use synthetic preview records. The [layout measurements](geometry.json) record viewport width, content width and document language.

- [Visit status dropdown](desktop-visit-status-en.png)
- [Spanish staff workspace](desktop-today-es.png)
- [Spanish phone visit dropdown](phone-visit-status-es.png)
- [Waiver reason dropdown](desktop-waiver-reason-en.png)
- [Template dropdown](desktop-template-dropdown-en.png)
- [Spanish website phone header](phone-website-header-es.png)
- [Spanish website phone view](phone-website-viewport-es.png)
- [Native Spanish screen and verification details](native-checks.md)

## Review boundaries

Physical iOS/Android device acceptance remains to be performed. The mobile export and local Chrome review verify compatibility and interface behavior, not physical device presentation. Account preference races were tested with controlled account mocks; no real account metadata was changed during browser verification.

Generated document translations, user-authored template/consent content and historical static English design-reference boards are outside interface translation. Arabic remains unavailable pending completed translation, bidirectional layout review and appropriate document font/shaping support.

See [the localization guide](../../localization.md) for catalog ownership, preferences, fallback behavior and adding a language.
