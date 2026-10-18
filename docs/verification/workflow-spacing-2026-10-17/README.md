# Workflow spacing review — October 17, 2026

Shared popup and workflow spacing changes are local in the canonical CareIQ checkout. This review used the existing isolated browser fixture, Chrome through Playwright, and synthetic preview records. It did not use a live identity, API, patient data, or external network requests.

## Changes

- `InterviewModal` now provides one padded body wrapper. Legacy fieldsets and reviewer notes inherit that gutter without duplicate padding.
- Popup bodies use 26px horizontal padding on larger screens and 20px below 590px. Forms, fields, template editors, and footer groups have consistent spacing. Narrow footer actions stack.
- Workflow dropdowns reserve 44px for their indicator, with the chevron positioned 16px inward. Native appearance remains available in forced color mode.
- Today visit rows have 16px desktop, 14px tablet, and 12px phone horizontal padding. Times and statuses remain within the hover background.
- Requirement actions use stacked padded options with descriptive text. The waiver option has a separate subdued treatment.
- Paired form fields align at their top edge, so helper text does not stretch adjacent inputs.

## Browser evidence

The [after geometry](after/geometry.json) covers 48 view/size combinations: Today plus booking, new patient, requirement actions, waiver, patient request, edit contact, upload, document detail, version review, template editor, template detail, preparation, provider availability, provider assignment, and requirement rules. Each was checked at 320, 768, and 1440px. Long forms also have scrolled footer screenshots. A [booking follow-up](after/geometry-booking.json) captures the final paired-field alignment correction at those widths.

No reviewed page or dialog had horizontal overflow. The minimum measured control or footer inset from the dialog border increased from 1px before to 21px afterward (27px on larger screens). Today row inset measurements changed from 0px on each side to 12/14/16px by viewport.

| Example | Desktop | Phone |
| --- | --- | --- |
| Requirement chooser | [1440px](after/1440-requirement-actions.png) | [320px](after/320-requirement-actions.png), [footer](after/320-requirement-actions-footer.png) |
| Waiver | [1440px](after/1440-waiver.png) | [320px](after/320-waiver.png) |
| Template editor | [1440px](after/1440-template-editor.png) | [320px](after/320-template-editor.png), [footer](after/320-template-editor-footer.png) |
| Booking | [1440px](after/1440-booking.png) | [320px](after/320-booking.png) |
| Patient request | [1440px](after/1440-request.png) | [320px](after/320-request.png), [footer](after/320-request-footer.png) |
| Today | [1440px](after/1440-today.png) | [320px](after/320-today.png) |

The [before geometry](before/geometry.json) and screenshots preserve the original edge spacing for comparison. Screenshots were visually inspected at desktop, tablet, and phone widths, including the scrolled footer states.

## Verification

- Web lint and TypeScript pass; API TypeScript passes.
- All 60 web unit tests pass, including exact upload requirement binding, restored preview context, review/waiver state changes, evidence selection and replacement version behavior.
- All 32 browser scenarios passed across the final executions: 25 completed in the main run, then the seven failed/unfinished cases passed in a focused rerun. The first Chrome launch timed out before an application assertion; the main run was stopped while another case was in progress. The rerun included both new visit-action scenarios and the interrupted cases.
- The isolated Next.js production build passes.
- The owned local API was refreshed so exact candidate/evidence parent document references are available. The web development server applies the CSS and UI changes locally.

The new requirement chooser preserves patient, appointment, requirement and exact version context. Staff can review a received file, view it securely, upload a replacement, request it from the patient, choose existing evidence, or deliberately waive/revoke a waiver when permitted. Processing files cannot be reviewed. Upload and evidence actions also update the synthetic preview correctly.

No padding-only tests were added. No commit, push, or deployment was performed.
