# Native localization verification — October 17, 2026

The mobile application has complete English and Spanish interface catalogs: 595 messages in each catalog, with matching keys and interpolation arguments. Only these two reviewed languages are selectable. Other locale registry entries remain unavailable.

## Verified behavior

- All 56 mobile unit tests passed. Coverage includes independent staff and patient preferences; late storage/account metadata; serialized device writes; serialized and coalesced account saves; account identity changes; safe error messages and retry uncertainty; catalog completeness; and active patient document language taking precedence over parent staff effects.
- Mobile TypeScript validation passed.
- Full mobile ESLint validation passed with zero errors and zero warnings.
- Expo production export completed for iOS, Android, and web, including all 18 static routes. Exported bundles are retained in [the local review directory](../../../.local-review/mobile-localization-export/).
- An actual Chrome run of the local mobile web preview verified Spanish labels, exactly two selectable language options, preservation of entered email and password values across a language change, independent patient and staff storage preferences, correct document language for each scope, and no page errors.
- The Spanish screen was visually reviewed at a 430-pixel viewport. The [review screenshot](native-spanish.png) contains synthetic form input; the password remains masked.

Staff language changes synchronize with the authenticated account preference through a serialized save queue. Explicit choices take precedence over late preferences for the same account, while a change of account restores that account's preference. Patient language stays independent and device-specific. Interface language changes preserve form state. Native text and language options carry accessibility language information, and the deepest active language scope controls mobile web document language.

Existing patient-entered text, authored template labels, consent text, signed documents, routes, and business codes retain their original values. Newly created template signature labels use the selected interface language. Arabic direction support is preparatory; Arabic is not currently offered as a reviewed translation.

## Evidence and limits

- [Unit test output](../../../.local-review/mobile-localization-tests.txt)
- [ESLint report](../../../.local-review/mobile-localization-lint.json)
- [Spanish mobile preview](native-spanish.png)

Production bundling verifies build compatibility; it does not replace physical iOS and Android device review. Account synchronization races were verified through the pure preference policies; no live account metadata changes were performed during the browser smoke check. No deployment was performed.
