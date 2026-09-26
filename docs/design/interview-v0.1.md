# CareIQ v0.1 — Interview Design

**Design baseline:** September 21, 2026. **Audience:** front-desk staff, with a separate explanation layer for interview reviewers.

This names the approved interview design. It is not a production release, a compliance claim, or a change to the package version. The vertical slice is sign in → select a practice → create/find a patient → schedule/read an appointment → demonstrate persistence and tenant isolation.

## Design intent

Build a calm, legible working surface that puts the schedule and patient details first. White panels, an almost-white page background, restrained green accents, and generous spacing replace the original dark treatment. The interface should feel useful during a working day and easy to follow during an interview.

The application has two primary destinations: **Schedule** and **Patients**. Selecting a row exposes its details in the adjacent panel. Day selection, week navigation, and patient search organize records already returned for the active practice. They do not imply server-side availability, search, or pagination services.

## Visual contract

| Role | Value / treatment | Use |
| --- | --- | --- |
| Page background | `#f8faf9` | Quiet separation between white surfaces |
| Panel, sidebar, dialog | `#ffffff` | Main working surfaces |
| Main text | `#2b3832` | Headings, labels, body text |
| Secondary text | `#626f68` | Supporting text; keep readable size and contrast |
| Soft border | `#e4e9e6`, 1px | Panels and resting form controls |
| Green accent | `#496f5a` | Primary action, selected navigation, small emphasis |
| Selected surface | `#f0f5f2` | Subtle selected state |
| Hover surface | `#f5f8f6` in the application | Quiet interaction feedback |
| Control corners | 10px | Inputs, select boxes, related controls |
| Surface corners | 16px panels; 18px dialogs | Main working surfaces |

Use a clear sans-serif typeface, a distinct heading scale, and consistent spacing. The reference concept uses Manrope for headings and DM Sans for body text; the integrated application uses a system font stack beginning with Segoe UI and does not require a font download. The hierarchy and density remain consistent with the reference.

Green is an accent, not a background theme. Errors use readable text and an explicit message; status and selection are never conveyed by color alone. Soft resting borders must not replace a visible keyboard focus indicator. Border softness is a visual requirement, not evidence that accessibility checks have passed.

## Controls and dialogs

- Keep native HTML selects for ordinary form choices. Use the same 1px soft border, white background, and 10px radius as other fields.
- Replace the default select arrow with a small chevron centered vertically and inset **14px** from the right edge. Reserve at least 40px of right padding so long labels cannot collide with it. Preserve native keyboard and option behavior.
- Keep the real Clerk organization switcher for practice selection. Style its trigger consistently; do not substitute fictional practice options or override Clerk's authorization behavior.
- Center patient and appointment dialogs in the viewport. Use a white surface, dark text, a restrained scrim, clear title, close control, and an internal scroll area on short screens.
- Put labels above fields. Mark optional email, phone, and visit reason explicitly. Show the destination practice in the form.
- Disable duplicate submission while a request is pending. Keep failure feedback in the form; report success only after the API confirms it.
- Support keyboard opening, visible focus, focus containment, Escape/close, and focus restoration. Verify these in the integrated browser experience.

## Product UI and reviewer notes

Place the reviewer bar **above and outside the application shell**. The integrated bar says **Interview demo · Developer notes**, with **v0.1 — Interview Design · Outside the staff application** below. Its **Architecture notes** action opens **Behind the front desk**, labeled **DEVELOPER NOTES · INTERVIEW DEMO**, with the disclosure **Illustrated architecture — not live telemetry**. These labels are implemented in `InterviewNotes.tsx`, `PracticeWorkspace.tsx`, and `InterviewModal.tsx`.

`NEXT_PUBLIC_INTERVIEW_MODE` controls the reviewer layer: enabled by default in development unless `false`, hidden in production unless `true` at build time. It does not change authentication or data behavior. The standalone mockup always includes the reviewer explanation and uses a shorter “Illustrated flow” caption.

Architecture steps explain authentication, practice resolution, validation, database access, and the response. They must not show fabricated timings, animated request events, success checks, or security badges that suggest measured behavior. Keep implementation commentary out of patient details and scheduling controls. The explanatory panel is documentation for the demo, not a staff workflow.

The inline HTML mockup is a separate artifact: its patients and appointments are fictional and its changes stay in memory. **The integrated application calls the real API and writes to the database selected by `DATABASE_URL`.** Its reviewer notice must say so. Running on localhost does not mean the database is local. Use synthetic data for the interview.

## Dates, responsive behavior, and states

The integrated schedule uses the browser's local timezone and visibly names it. Form date/time values are converted into an ISO timestamp for the API; returned timestamps are formatted in that same browser timezone. Do not carry over the mockup's fixed September dates or hardcoded Pacific Time label. A stored practice timezone and explicit handling of ambiguous daylight-saving times are future work.

On wide screens, show navigation, the list, and its detail panel together. At narrow widths, stack the list and details and let controls wrap without horizontal page overflow. Dialogs remain centered and usable on small or short screens.

Provide deliberate states for authentication loading, signed out, no selected practice, data loading, load failure with retry, empty practice, empty day, no search matches, submitting, and submit failure. A practice switch must discard the previous practice's visible records, selection, form state, and late responses before showing the new practice.

## Interview walkthrough

1. Start the API and web app using [development and deployment](../development.md). Confirm their configured database and use synthetic records.
2. Open the web app, sign in, and choose Practice A through Clerk.
3. Add a synthetic patient; find the patient through search and verify their details.
4. Schedule a visit. Confirm the patient is immediately available in the patient selector and that the appointment appears on the chosen day at the labeled local time.
5. Refresh, then sign out and back in. Confirm the records persist.
6. Switch to Practice B and verify A's records are absent. Add B's records, then switch back to A.
7. Open the reviewer architecture notes and explain the server-derived practice ID, transaction-scoped tenant context, and PostgreSQL policies. State that the panel illustrates the design; the isolation test suite supplies separate evidence.

See [interview architecture](../interview-architecture.md) for the source-backed explanation and deployment limits.

## Acceptance checklist

These are checks to perform and record, not claims that they have passed.

- [ ] Resting dropdowns match other controls; chevrons have a 14px inset and do not overlap text.
- [ ] Keyboard focus remains clearly visible on inputs, selects, navigation, and actions.
- [ ] White dialogs are centered at desktop and narrow viewport sizes; all content and buttons are reachable.
- [ ] Modal focus stays inside, Escape closes, and focus returns to the opener.
- [ ] The reviewer bar and architecture notes are visibly separate from the staff workflow.
- [ ] The application accurately discloses API-backed writes; the mockup accurately discloses fictional data.
- [ ] New patients appear in scheduling without a page refresh; failures do not produce success messages.
- [ ] Date/week navigation, search, empty states, and detail selection work with actual records.
- [ ] Timezone labels match displayed and submitted dates, including days near a UTC date boundary.
- [ ] Practice switching clears previous data and ignores stale responses; A/B isolation is demonstrated in both directions.
- [x] Type checks, lint, API unit tests, and production build pass for the final integrated change; see [verification](../verification.md) for limits.
- [ ] Signed-in browser and hosted smoke checks are recorded separately from compile-time checks.

## Reference material

These are design influences, not claims of feature parity or copied authenticated product screens. CareIQ's visual treatment and scope are its own.

- [NexHealth scheduling](https://www.nexhealth.com/features/scheduling): a scheduling-centered product narrative and clear booking actions. CareIQ does not implement NexHealth's integrations, availability sync, waitlists, or reminders.
- [Weave scheduling](https://www.getweave.com/weave-scheduling/): an adjacent front-office workflow reference. This slice does not include its wider patient engagement suite.
- [Carbon color overview](https://carbondesignsystem.com/elements/color/overview/): neutral surfaces with purposeful color roles informed the white-and-green palette. CareIQ is not an implementation of Carbon components.

References reviewed September 21, 2026. The original exploration preceded this approved light palette.

## v0.1 design changelog

- Established white surfaces, a pale background, restrained green accents, and a schedule-first layout.
- Moved developer explanation into a separate, explicitly labeled reviewer bar.
- Replaced dark corner popups with centered white dialogs and dark text.
- Unified dropdown borders and rounding; moved chevrons inward.
- Defined live-application behavior, timezone labeling, accessibility checks, and the boundary between illustration and telemetry.

Future visual changes should record their purpose here or in a subsequent design revision. This milestone does not authorize deployment or replace the remaining deployment acceptance checks.
