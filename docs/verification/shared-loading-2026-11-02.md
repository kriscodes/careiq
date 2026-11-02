# Shared loading indicators — November 2, 2026

The app now reuses the onboarding companion indicator for pending screens, refreshes, detail reads, pagination and busy actions. The existing panel appearance and image remain the shared source. A compact 22px variant fits buttons and short inline updates.

## Coverage

The pass covers 30 source files: sign-in/provider startup, onboarding, practice/account/access checks, legacy patient and appointment forms, protected audit reads, Today/workflow refreshes, calendar availability, documents and forms, manager/insurance views, Patient Delivery, notifications, patient requests, copy libraries, portal access and communication preferences.

Panel indicators own a polite status announcement. Compact button content uses ordinary spans so the button retains its localized accessible name; standalone compact updates explicitly announce status. The compact image uses a rounded badge inside colored buttons. Reduced-motion settings stop the companion animation. Existing errors, completed-state notices, contact permissions and delivery/processing badges retain their normal meaning.

The native practice-selector option remains plain text because an option cannot contain this component; its pending state has an adjacent shared indicator. Required modal-description strings retain localized context while the body indicator communicates loading. Request/state/permission behavior is unchanged, including the separately committed [Communication Choices fix](communication-choices-loading-fix-2026-11-02.md).

## Verification

All checks used synthetic local fixtures and Node 22.23.4 with Chrome.

- **244 unique browser cases passed**, including all 10 communication cases. The full run passed 239; five focused reruns passed after correcting an inline-button accessible-name regression and adapting two existing loading-panel assertions.
- **131 web unit tests and 7 translation tests passed** on the final component.
- Web and shared translation type checks passed.
- Whitespace checks passed.
- Independent source review confirmed pending-render coverage, valid client directives and inline markup, no duplicate loading live regions, and preserved fetch/abort/error/success handling.
- Visual review covered 1280px English, 320px Spanish and reduced-motion presentation. Each had no page overflow. Compact indicators render a span without block children, keep a 22px companion, and stop animation with reduced motion enabled.

Visual records: [English panel and button](shared-loading-2026-11-02/desktop.png), [Spanish phone layout](shared-loading-2026-11-02/phone-es.png), [reduced motion](shared-loading-2026-11-02/reduced-motion.png), [layout measurements](shared-loading-2026-11-02/review.json), and [render-coverage audit](shared-loading-2026-11-02/audit.txt).

## Local acceptance

1. Open Patients and hover/focus a row to confirm the separately committed side spacing.
2. Open Patient Delivery → Communication Choices. The patient selector opens immediately. Select a patient and observe the branded indicator only while preferences load; clear the selection and confirm the picker remains available.
3. Check an initial workspace load, refresh, calendar availability, document details, notifications and patient paperwork. Pending reads use the companion treatment rather than bare loading text.
4. Start a normal save and confirm the compact companion fits its button, the button stays disabled while pending, and its text remains available to assistive technology.
5. Check English and Español on a narrow layout. Enable reduced motion and confirm the indicator stays still.

Browser coverage used the full component suite with two workers, then a one-worker rerun of the five affected auth/access/account/availability cases. The local review does not send patient messages or modify hosted records.
