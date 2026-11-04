# Location-selection loop diagnosis — October 30, 2026

The user reported being unable to continue beyond Where are you working, including after transferring ownership. This follow-up investigated behavior before choosing a new product flow or creating designs. No product source, accounts, roles, ownership or permissions changed during this diagnosis.

## Confirmed behavior

A mock account with an active assigned location and no workflow-read capabilities passes the frontend location-scope check. Continue requests the location workspace; the API correctly returns 403 FORBIDDEN. The adapter invokes the access-denied callback, which refreshes practice context and clears the selected location. The next successful context response recreates the same chooser without a visible explanation. The diagnostic reproduced the same sequence twice.

Ownership transfer changes the recorded owner and removes that user's owner-management authority. It preserves organization membership, enrollment, locations and existing clinical permissions. An assigned location alone does not grant workspace read access.

A separate diagnostic confirmed that ordinary window blur/focus discards an authorized working-location choice. Privacy concealment should remain; the selected location can remain navigation intent while a fresh authorization check decides whether records may reopen.

## Coverage and constraints

Four isolated mock-only diagnostic cases passed: repeated forbidden-workspace loop, blur/focus loss after an authorized workspace, documents-only workspace access, and configuration-only workspace access. The existing token-refresh regression also passed. Temporary diagnostic test/config sources were removed, retaining only ignored redacted results.

Workflow admission currently permits patient read, appointment read, document read or workflow configuration. The practice-context response exposes only the patient/appointment capability subset. A new landing decision must account for all permitted workspace areas, including documents/configuration-only staff. Do not infer clinical access from ownership, automatically widen permissions, or label those users as having no workspace.

Product directions remain proposals: a practice home with available actions and an access summary; direct routing to permitted work with an explicit unavailable-access destination; or a recipient-accepted ownership handoff. Loading indicators and settings navigation are to be chosen before visual design. This diagnosis does not claim the loop is fixed or complete the remaining manual authentication/reset acceptance.
