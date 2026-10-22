# Manual authentication acceptance

Use the five Development accounts in the [QA account inventory](https://app.notion.com/p/400e97848806811fb721df0967d1ead5) and the [isolated local review environment](local-review.md). This walkthrough records real password, challenge, reset and access behavior. Component tests, administrative setup sessions and inbox receipt are separate evidence.

## Starting state

The [October 21 verification record](verification/qa-accounts-2026-10-21.md) establishes the current fixtures and previously verified results. All five accounts have received real reset emails across earlier runs, but codes were withheld by the Gmail connection. Actual code entry, password changes and old-password rejection remain pending. Staff invitations were delivered and accepted while authenticated in-app; redemption from the invitation email link remains unverified.

The [October 22 hosted activation record](verification/hosted-auth-emails-2026-10-22.md) confirms all 16 Development template updates and one fresh branded owner reset receipt. The manual acceptance cells below still require the current browser attempt and actual client inspection. English is the current hosted source language; the reusable Spanish catalog does not automatically activate provider localization. Follow the [email guide](little-hello-emails.md) for that boundary.

Use the exact account label and Development environment in the private inventory. Enter passwords and codes directly in CareIQ, keeping them out of chat, Notion, screenshots and logs. Store each new password in the owner's password manager and update any deliberately retained private handoff. Use synthetic data only.

## Expected access after authentication

CareIQ QA Practice has one QA Main Location. Recheck current authority after each reset; authentication must not create a role, location, ownership or patient binding.

| Persona | Start | Expected current access |
| --- | --- | --- |
| Owner | `http://localhost:3101/` | Recorded practice owner, active `org:admin`, QA Main Location. Owner management succeeds. Clinical permissions are a separate check; do not infer them from ownership. |
| Administrator | `http://localhost:3101/` | Active `org:admin`, QA Main Location. Patient read is denied with `FORBIDDEN`; owner management is denied with `OWNER_REQUIRED`. Builtin policy stays unchanged. |
| Team member | `http://localhost:3101/` | Active `org:member`, QA Main Location. Patient read is denied with `FORBIDDEN`; owner management is denied with `OWNER_REQUIRED`. |
| Clinician | `http://localhost:3101/` | Active `org:qa_clinician_20261021`, QA Main Location. Patient read succeeds; owner management is denied with `OWNER_REQUIRED`. Appointment creation remains denied. |
| Adult patient | `http://localhost:3101/patient-paperwork` | Personal account with no staff organization. Its adult-self binding exposes the one released unsigned synthetic PDF. Staff workflow and owner management are denied with `ORGANIZATION_REQUIRED`. |

The clinician's seven reviewed permissions are patients read/create, appointments read, documents read, workflow configure, paperwork manage and requests send. Do not add permissions to make a test pass. The patient binding keeps its original expiry, January 19, 2027 at 9:20 PM PST (January 20 UTC), and paperwork email notifications remain disabled. Clerk authentication emails remain available.

Earlier lifecycle checks already verified clinician suspension and location removal denials, patient revocation denials, and restoration using the same signed sessions. Those checks do not replace the password and reset steps below. Avoid repeating changes to grants or roles as part of this walkthrough.

## Run once per account

For the other-session check, use separate browser cookie jars: a normal window for session A and a private window for B, or two different browsers. Two tabs or two private windows in the same browser can share their session and are insufficient for this check. Keep the old password privately until its rejection test is finished, then update or retire the temporary handoff.

Work through one persona completely before moving to the next. Use email and password for this matrix. The controlled Gmail aliases are separate Clerk accounts, not separate Google identities; Google OAuth requires a separate provider/account-linking test.

1. **Normal sign-in.** Open a clean signed-out browser context at the persona's start URL. Submit its saved password. If Clerk requires client trust, explicitly send the verification code once. If an enrolled MFA factor is required, complete that actual factor; record a factor that is not configured as not exercised. Never enroll or bypass a factor just to complete this matrix. Reloading or moving back through a pending challenge must not silently send another code or expose authenticated content.
2. **Challenge behavior.** For a code challenge, change one digit of the received code and enter that incorrect six-digit code once and confirm a clear error without authentication. Then enter the latest valid code privately if Clerk still permits that attempt. If the provider closes the attempt, record that result and use its normal permitted restart. Verify that final provider completion is required before CareIQ opens the destination. Keep this authenticated context open as session A for the revocation check.
3. **Access baseline.** Confirm the persona's destination and the expected access in the table above. Record only redacted outcomes. For the patient, confirm one library item and a downloadable PDF; for staff, check the existing synthetic workflow and owner management as applicable.
4. **Forgot password and branded delivery.** In a separate signed-out context B, open Forgot password for the same account. Confirm the generic account-existence response and the code-entry screen. Check the exact recipient privately and the message purpose. After confirmed hosted activation, verify the new message has the Little hello white layout, blue companion or readable blocked-image fallback, clear code, CareIQ wording and footer. Earlier unbranded receipt does not pass this check.
5. **Reset-code behavior.** Enter one incorrect reset code and confirm a useful error. Enter the latest valid code privately if the attempt remains usable, then reach the new-password form. Do not infer code validity from receipt. Test expiration only when an authoritative expiry is known; wait until that actual expiry and record the result separately. Otherwise mark expiration unverified. The resend countdown is not the code lifetime.
6. **Password update.** Confirm mismatched password confirmation is rejected. Choose a new private password accepted by the provider, submit matching values and verify the password-updated state. Complete any remaining provider task and continue to CareIQ. Update the private password-manager entry. Record completion only after the provider confirms the update.
7. **Old password and other sessions.** Reload session A and attempt a protected action: it must require authentication and show no protected content. In a fresh signed-out context, try the old password once; it must be rejected. Sign in with the new saved password, completing any required client-trust or MFA challenge. A successful new-password sign-in does not by itself prove the old password or session was rejected; record each result.
8. **Authority remains unchanged.** Repeat the role and patient access checks. Confirm the original active membership, role and explicit location, or personal adult-self binding, still apply. The patient's library must still contain its one existing unsigned PDF. Sign out and close the test contexts before starting the next persona.

Stop on throttling, repeated provider failures or an unexpected recipient/account. Honor an actual `Retry-After` value or the displayed cooldown; do not invent a waiting period or repeatedly resend. Retain the pending result and resume through the supported flow when permitted. Never use administrative sign-in tickets to mark these password checks complete.

## Record each result separately

Record environment, persona, time, browser/client, step and redacted outcome in the existing inventory or verification record after the result is observed. Keep account rows at Created / Development until the agreed acceptance work is complete. Do not store a code, password, token, private message link or patient content as evidence.

| Persona | Password + required challenge | Fresh branded reset receipt | Reset code + password update | Old password rejected | Other session rejected | New sign-in + unchanged access |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Pending | Pending | Pending | Pending | Pending | Pending |
| Administrator | Pending | Pending | Pending | Pending | Pending | Pending |
| Team member | Pending | Pending | Pending | Pending | Pending | Pending |
| Clinician | Pending | Pending | Pending | Pending | Pending | Pending |
| Adult patient | Pending | Pending | Pending | Pending | Pending | Pending |

These pending entries describe this manual acceptance pass, not a failure of the setup or earlier delivery checks. Note incorrect-code behavior, challenge factor, expiration coverage and any throttle beside the relevant result.

## White-theme and inbox checks

At sign-in, challenge, forgot-password, reset-code, new-password and completion screens, check the system set to light and dark. CareIQ should keep its white tones, readable labels and errors, visible focus, password-manager support, and a usable narrow layout. Confirm the patient destination survives authentication.

For actual branded email, inspect Gmail, Apple Mail and Outlook in light and dark modes, with images enabled and blocked where supported. Check the white authored canvas, legible code/action, text fallback, companion/wordmark, footer “A little more room to care.” and narrow-screen readability. Record client overrides or color changes explicitly; a browser HTML preview is not inbox acceptance. Identity copy stays independent of practice role. A generic verification template can serve signup, email verification, client trust or MFA, so its copy must not promise a particular completed sign-in or role.

## Remaining acceptance outside this pass

Invitation email-link redemption needs a valid, deliberately planned invitation test; the already accepted invitations cannot establish it. Second-practice isolation also remains separate and needs an approved fixture. Review actual hosted template activation, localization and each mail client's rendering independently. Production acceptance is separate from these Development results. Keep SW-T78 In progress and blocked while required acceptance remains open; replace its blocker only with observed results.
