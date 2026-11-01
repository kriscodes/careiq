# Consistent application navigation — October 31, 2026

The signed-in web application now uses one shared navigation model and frame across Home, clinical workflow, Practice settings, teammate invitations, My workspace access, invitation inbox, personal account and protected audit review. The earlier [owner-operator policy](owner-operator-2026-10-31.md) and all authorization boundaries remain in force. This implementation is local to the canonical CareIQ checkout, with no commit, push or deployment.

## Navigation design

Location-mode staff see the same ordered destinations throughout the application:

| Group | Destinations |
| --- | --- |
| Workspace | Home, Today, Schedule, Patients, Documents, Templates |
| Operations | Manager, Insurance, Patient delivery, Notifications |
| Manage | Practice, for the verified current owner |
| Utilities | View invitations, Personal account, Audit review |

Pages no longer add/remove destinations based on their loaded workflow snapshot. A restricted destination explains current access; the API still authorizes each operation. Legacy practices keep their supported Home/Today/Schedule/Patients destinations consistently across pages, without suggesting unsupported location-only tools. Patients use the same white layout with Your paperwork and Personal account; they receive no staff destinations. Sign-in, session challenges, public patient request links and pre-enrollment/setup remain gated flows outside authorized staff navigation.

The desktop sidebar keeps the workspace/location context, consistent line icons, active destination and account controls. Its longer menu scrolls independently above the fixed utility/account area. Collapse state persists when moving between pages. At narrow widths, the same menu opens from a labeled drawer button; the header retains the white wordmark/language layout, with no multirow strip of destinations. Settings tabs remain inside the shared frame. Exactly one main landmark and one global current-page marker are used per authorized page.

## State and access behavior

- All global exits use each page's leave guard: sidebar destinations, utility links and provider practice switches. Settings, ownership confirmation, owner access, invitations and personal closure choices retain drafts on Keep editing; Discard deliberately leaves without submitting them. Pending saves/reverification block navigation and account/practice controls.
- Switching working-location intent on a practice-wide form keeps that form and its draft. A genuine clinical location change uses the workflow guard and reauthorizes records. Successful internal workflow navigation updates parent intent so a fresh check after backgrounding restores the actual section. A newer permission denial wins, clears protected data and returns to explained Home.
- The mobile drawer stays open while a leave decision is pending, allowing Cancel to restore focus to the actual menu button. It closes after a real destination change.
- Patient library/account switches unmount protected copies, revoke object URLs and reload current access on return. Library content is keyed by signed-in identity. Patient communication choices protect dirty drafts and pending saves; archived/unavailable account states do not retain staff navigation.
- Audit uses the shared shell but retains its explicit audit permission checks. Owner-operator access does not add protected-audit grants. No backend permission or provider role was changed for this navigation work.

## Implementation

`application-navigation.ts` supplies the canonical ordered model and frame/guard contract. `ApplicationFrame` is the common white sidebar/header/main layout. `PracticeAccess` supplies verified practice context and navigation, while workflow and auxiliary pages provide content and their own guards. `AccessShell` supports content-only embedding, preserving standalone authentication/setup screens. The patient library reuses the same frame with its own destination list.

## Verification

| Check | Result |
| --- | --- |
| Initial complete component browser run | 219/225 passed; six existing assertions still expected the former mobile/menu behavior |
| Follow-up after those six assertions and desktop-footer polish | **32/32 passed**, including all 26 new navigation regressions and the six corrected older cases |
| Final affected checks after active-item visibility adjustment | **26/26 passed**, with direct active-item/nav-viewport intersection and refreshed desktop/mobile captures |
| Web unit tests | **112/112 passed**, zero skips; includes all nine destinations, every capability combination, explicit denials and legacy bounds |
| Translation/catalog checks | **7/7 passed** |
| All changed production-source lint and final web typecheck | **Passed**, no warnings; frame checks repeated after the final adjustment |
| Synthetic production build | **Passed** on final source; exact temporary config bytes restored, local services ready after startup warm-up |
| Actual read-only Development UI | **All five personas passed**: owner, administrator, member, clinician and personal patient |

The current browser inventory has 225 unique cases. Results above distinguish the initial full run from the later affected runs; this is not a claim that a second complete 225-case invocation ran. The six failures were outdated drawer/menu assertions, which were corrected without weakening permission or mutation checks. Seven private synthetic captures were visually reviewed at desktop and 320px English/Spanish under dark system preference; surfaces remained white without horizontal overflow. The final desktop view keeps the active Practice item visible above the pinned account/footer area.

The actual owner retained the same ordered menu across Home, all four Practice tabs, My workspace access, Patients and personal account; both current locations and operating access remain. Administrator/member kept their clinical denials with the same menu, and clinician kept its permitted workspace. Patient library/account used only the two patient destinations. No staff navigation or practice reads were exposed to that patient.

The first patient script reached the public/loading library heading before Clerk finished loading its signed-in menu. Adding the required menu-ready wait made the patient-only retry pass; this was a private verification-script timing correction. All six exact temporary setup sessions across the five-persona run and patient retry were individually revoked. The guard observed zero CareIQ API mutation attempts. Existing manual sessions and all QA passwords, ownership, patient bindings and lifecycle states were preserved. No API source, hosted database or shared provider role changed during this task.

Automated component sessions and administrative setup sessions are UI/access evidence, not normal password, challenge, reset or invitation-email acceptance.

The [manual authentication guide](../qa-auth-manual-checks.md) retains all outstanding real authentication, reset/password update, old-password/session cleanup, invitation email-link, mail-client, second-practice and production checks. No QA password, ownership, patient binding or account lifecycle is intentionally changed by the read-only navigation review.
