# UI capitalization review — November 2, 2026

This follow-up applies the requested style to standalone labels: capitalize every word, including connecting words, in English and Spanish. Examples include **Active Visits Today**, **Checked In**, **Need Paperwork**, **Ready For Visit**, **Continue With Google**, **Back To Sign In**, and **Citas Activas Hoy**. This supersedes the initial-capitalization style in the [November 1 report](ui-capitalization-2026-11-01.md).

The pass changes **2,028 catalog values and 276 inline values** across navigation, headings, tabs, buttons, field labels, status badges, select options, accessible labels and export headings. The [complete exact inventory](ui-capitalization-2026-11-02-changes.json) records each source, message key where available, previous value and resulting value. It also records the two added prose keys and generated-label source changes. Counts describe this follow-up relative to the local November 1 implementation.

Full sentences and helper prose retain sentence casing. Authored form labels, patient/practice names, entered values, technical identifiers, enum values and interpolation values keep their original spelling. The careiq wordmark remains as designed. Two practice-name fallbacks used inside prose now use dedicated English/Spanish sentence keys, so changing the standalone **Your Practice** label does not capitalize words inside those sentences.

Generated patient-signature and communications fallback labels now capitalize each word after technical separators are converted to spaces. Password show/hide accessible labels preserve the existing field-label capitalization. A closed patient request still reads naturally, for example “This request is cancelled.”

## Local review checklist

Repeat the relevant screens in English and Español. Check desktop and a narrow phone layout, including open menus and dialogs.

| Area | What to check locally |
| --- | --- |
| Today | Active Visits Today, Checked In, Need Paperwork; All Visits, Here / In Visit, Needs Attention and Cancelled filters; visit badges, Visit Details, check-in/start/complete actions and status options. Confirm switching filters still works. |
| Appointments | Week View, Previous/Next/Current Week, Jump To Date, provider filter, Find A Time, Check Availability and Book This Time; calendar and phone-agenda visit states. |
| Patients | Find A Patient, contact/edit/upload/request actions, profile tabs, readiness requirements and Actions For each authored document label; preserve the document label itself. |
| Documents | Status filters, review decisions, version history, upload/archive/restore controls and document detail actions. |
| Templates / Forms Studio / setup | Template and document/provider/visit-type setup; Draft/Published/Retired states, studio tools, fields, properties, menus, Field 1 Label/Type, publication and signing actions. Authored field labels retain their spelling. |
| Manager / Insurance | Summary headings, insurance filters and badges, Review Insurance For each patient, evidence/follow-up dialogs, aggregate export headings and the existing team-activity view labels. Patient names and evidence text remain unchanged. |
| Communications / Notifications | Patient Delivery, Delivery Log, Sender Readiness, Message Templates, Reminder Policy, My Preferences, Staff Routing; message review/actions, communication choices, notification read controls and generated fallback statuses. Message bodies and notices remain sentences. |
| Practice / team / ownership | Practice Settings, location/team/invitation actions, owner workspace-access areas, role/location options, Transfer Ownership To the selected recipient and Type the exact practice name To Confirm. Preserve the practice and recipient names. |
| Personal account | Account navigation, archive/deletion choices and confirmation labels, completed-copy links, re-verification and resulting status headings. Typed ARCHIVE/DELETE values retain their case. |
| Sign in / Sign up / onboarding | Continue With provider buttons, Or With Email, input labels, Show Password/Hide Password, reset/MFA/recovery actions, invitation/setup headings and navigation. Helper sentences and validation messages remain natural prose. |
| Patient pages | Paperwork request/item/copy states; generated Patient Signature labels; Copy From This Notice, Open Requested Copy, communication preference headings and Save Choices. A closed-request sentence stays sentence case. |
| Audit / shared navigation | Audit filters, table headings, protected-export controls, navigation sections, breadcrumbs, expanded/collapsed menus, language selector and legacy workspace labels. |

## Verification

- Web unit checks: **131 passed** after the final Spanish additions.
- Shared translation checks: **7 passed**, including matching catalog keys and interpolation parameters.
- Web, shared translation and marketing type checks: **passed**.
- Full isolated browser coverage: **241 unique cases passed**, covering the full component suite in English/Spanish and desktop/narrow layouts. The full run passed 231 cases; the ten remaining selector/startup failures passed a targeted rerun (11 cases, including one additional updated loading-label check). Existing assertions were updated for label casing while raw enum and authored-value assertions retain their original values.
- Browser tests used installed Chrome and synthetic loopback fixtures. The shared navigation fixture now supplies the existing manager-activity response; its test-only Settings button matches the app label.
- Catalog comparison against the start of this pass: every existing changed value differs only in case. Original keys, interpolation parameters and ICU count messages are preserved; two prose fallback keys were added.
- `git diff --check`: **passed**.

Commands used with the repository’s Node 22.23.4 runtime:

```sh
pnpm --filter @careiq/i18n --filter web test
pnpm --filter @careiq/i18n --filter web typecheck
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test --project=components --workers=2 --max-failures=12
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test --project=components --workers=1 tests/browser/components.spec.ts tests/browser/consistent-navigation.spec.ts tests/browser/practice-settings.spec.ts tests/browser/workflow.spec.ts --grep 'an uncertain invitation|owner location limits|the account page queues navigation|the account pending save|ordinary saves|genuine owner-access loss|preview shows synthetic readiness|template field editor|ordinary staff cannot|shared Settings header|a deliberate pending sign-in'
```

User acceptance remains the local checklist above. Changes are local in `/Users/kristian/Documents/Server/CareIQ`; no remote publication is part of this review. The requested local commit also includes the remaining release verification record and tracked marketing type-entry update. Generated Python bytecode is ignored.
