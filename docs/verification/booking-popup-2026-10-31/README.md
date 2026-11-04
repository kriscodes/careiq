# Appointment booking popup — October 31, 2026

The booking popup has a scoped visual update in the canonical CareIQ checkout. This work is local only; no commit, push or deployment was performed. All captures and automated checks used isolated synthetic preview records.

## Changes

- A direct “Book an appointment” heading and “Book appointment” primary action distinguish creation from editing. Existing appointments retain the update heading and Save changes action.
- The dialog is 560px wide on larger viewports, with matching native control borders and a consistent focus treatment.
- Date/time, duration, location timezone and availability are grouped in a lightly tinted scheduling section.
- The availability button explains its provider prerequisite when disabled. The optional visit note has a shorter textarea and helpful placeholder.
- English and Spanish copy are complete. Field boundaries exceed 3:1 against white; optional/placeholder copy exceeds 4.5:1. This focused review does not establish full WCAG conformance.
- Native controls, required validation, provider/visit-type behavior, automatic duration, location timezone conversion, command payloads, retries, busy guards and modal focus/Escape behavior are preserved.

## Verification

- Web TypeScript and lint passed using the installed repository-pinned Node 22.23.4.
- All 35 existing workflow browser scenarios passed, including strict booking/cancellation payloads and other shared dialogs.
- All 7 translation catalog checks passed.
- An isolated visual review passed at 1440, 768 and 320px in English and at 1440 and 320px in Spanish. No page/dialog horizontal overflow occurred. Initial control focus, Escape and focus return passed. The final [geometry record](geometry.json) includes measured field boundaries.
- The final desktop and phone screenshots were visually inspected, including the scrolled phone footer. Narrow dialogs retain the shared vertical scrolling behavior.
- No live appointment or availability request was submitted. The synthetic preview adapter’s existing availability-query error was observed separately; availability fetching code is unchanged and live slot retrieval is outside this visual acceptance.

## Screenshots

- [English desktop](booking-en-1440.png), [tablet](booking-en-768.png), [phone](booking-en-320.png), [phone footer](booking-en-320-footer.png).
- [Spanish desktop](booking-es-1440.png), [phone](booking-es-320.png), [phone footer](booking-es-320-footer.png).
