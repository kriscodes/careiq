# Development QA accounts — October 21, 2026

Five dedicated identities were created in the existing, confirmed Clerk Development instance using Gmail role aliases approved by the owner. The later user-approved setup established a dedicated QA organization, actual staff roles and a synthetic adult-patient binding through the normal application endpoints. Practice, location, patient and paperwork records remain in the isolated loopback review database. No production identity or authorization setting changed.

Account addresses, development user IDs and setup progress are in the Notion registry under CareIQ → Software Project, inheriting that destination’s sharing, linked from the [QA account guide](../qa-test-accounts.md). Unique generated passwords are only in the ignored local handoff file with mode 600, for transfer into the owner's password manager. No password, OTP, session token, reset link or recovery code is included in this record. The original unrelated local documentation files remain unchanged.

## Verified account provisioning

- The API and web private configuration were confirmed to use matching test keys; the actual Clerk instance reported `development` before user creation.
- All five users were created successfully and passed Clerk's backend password verification.
- All five had zero provider organization memberships immediately after identity creation; later approved memberships are recorded below.
- Backend creation uses verified email identifiers by default. It does not prove signup email ownership verification.
- The five registry rows were initially read back as Created / Development. Setup results and complete authentication acceptance are tracked separately.

## Reproduced and corrected sign-in continuation

Actual password submissions for the five new users reached `needs_client_trust`, with an offered email-code factor and no prepared code. The prior implementation delegated this state to an embedded provider form, which restarted at identifier/password entry.

Supported device trust and enrolled MFA now continue through the existing factor verification APIs. An unprepared code challenge offers an explicit send action with accurate copy; restoration sends nothing and preserves an already prepared factor. Backup-code-only challenges use the recovery input. Unsupported factors and OAuth callbacks retain their provider-owned path. Incomplete verification cannot finalize a session.

Installed Chrome checks against all five actual development identities passed after the correction: each password reached “Verify this sign-in”, showed the send action, retained `needs_client_trust`, remained signed out, prepared no code automatically and kept a white background with a dark OS preference. No send action was clicked during these follow-up checks. These are successful challenge-entry checks, not completed sign-in.

## Actual reset delivery

The local custom recovery form requested actual Clerk development reset messages. Owner, administrator and member requests reached Check your email without a UI error, and messages were found at each exact approved Gmail alias. Clinician and patient requests failed during the same run; one clinician diagnostic confirmed HTTP 429 / `verification_code_rate_limit_exceeded`, with no Retry-After header. Further mail attempts stopped.

A later follow-up through the actual local recovery UI reached code entry without errors for the clinician and patient. New reset messages were found at both exact Gmail aliases. Reset-message delivery is therefore verified for all five personas across the two runs; no verification code was read and no password was changed.

The observed rate-limit code now uses the existing localized wait message rather than generic retry advice. No wait duration is invented. The mail connection withholds one-time authentication codes; no alternate channel or testing-token bypass was used to retrieve or bypass them. Passwords were not changed. Existing Clerk development email templates remain active; hosted Little hello template activation is separate.

## Automated verification

Web unit tests: 95 passed. Translation tests: 5 passed. Web lint/typecheck and the isolated Next 16.4.1 webpack production build passed. The production build used reserved synthetic configuration without live credentials. All 54 authentication browser cases passed in the final complete component run. Across the full 97-case component suite, 96 passed and the first communications case timed out during Chrome context setup before an application step; rerunning that unchanged communications file passed all 7 cases. No test timeouts, launch options or assertions were relaxed. The final recovery-Back correction is covered by its browser regression.

The [320px verification screen](little-hello-2026-10-21/trust-unsent-dark-system-320.png) is a controlled component fixture with a visible mock-data label, not an actual account screenshot. It was captured as a fixed viewport after a full-page Chrome capture repeated a header visually; DOM inspection confirmed exactly one screen, wordmark and fixture caption. No production layout change was needed for that capture artifact.

## Approved role and patient setup

The registry was moved under CareIQ → Software Project and its five existing account rows were preserved. Passwords, authentication links, verification codes and session artifacts remain excluded from Notion and Git.

The owner approved these Clerk Development settings: optional organization membership for personal patient accounts, organization slugs enabled for deterministic controlled onboarding, and unrestricted end-user organization creation disabled. The saved Dashboard settings were verified after reload. Production settings were untouched.

Seven explicit CareIQ permissions were created for the dedicated `org:qa_clinician_20261021` role: patients read/create, appointments read, documents read, workflow configuration, paperwork management and request sending. That role is excluded from the initial/default role set. Only the new QA organization uses its custom role set; builtin administrator/member policies and the default role set were verified unchanged. The isolated API recognizes this role through an ignored, mode-600 `roles.env` override. Original application environment files were preserved.

The explicitly approved QA owner completed CareIQ onboarding for **CareIQ QA Practice / QA Main Location**. The first location did not automatically confer a working assignment: the owner was separately activated with that location through the existing owner endpoint. Owner practice management returned 200.

Administrator, member and clinician invitations were sent through CareIQ with stable idempotency keys. All three actual invitation messages were found at their exact approved Gmail aliases. Matching authenticated recipients accepted the actual Clerk invitation, then called CareIQ’s acceptance endpoint. Each reached `pending_assignment` and received 403 `ENROLLMENT_REQUIRED` for patient access before owner activation. The owner then activated each with the reviewed role and one explicit QA Main Location assignment. Final directory readback showed four active, assigned staff accounts and three accepted invitations.

| Account | Verified effective access |
| --- | --- |
| Owner | Recorded owner, current `org:admin`, active with one location; owner management succeeds. |
| Administrator | Current `org:admin`, active with one location; practice management denied with `OWNER_REQUIRED`; unchanged builtin policy grants no clinical permissions. |
| Member | Current `org:member`, active with one location; owner management and clinical patient access denied. |
| Clinician | Current dedicated QA role, active with one location; patient read succeeds; owner management and appointment creation denied. |
| Adult patient | Personal account without staff membership; explicit active adult-self binding to the new synthetic adult patient; staff routes denied with `ORGANIZATION_REQUIRED`. |

A staff-authorized synthetic verification reference explicitly identifies the binding as simulated QA, rather than attesting to a real in-person identity check. The normal binding endpoint enforced the current provider permissions and provider-signed recent first-factor age. No authentication claim or database grant was forged. Patient email delivery is disabled on the binding.

An unsigned, clearly labeled synthetic form was published and completed through a request session. This requested no signature or legal agreement. Completion released one immutable PDF and requested no notification. The bound patient’s actual personal Clerk session listed that released item and retrieved its PDF with HTTP 200, `application/pdf`, a valid `%PDF-` header and 1,181 bytes. An unrelated member saw an empty patient library and received 404 `PAPERWORK_COPY_NOT_FOUND` for the same item. Anonymous library access returned 401. The patient’s communication preferences exposed exactly one authorized practice/location profile.

Administrative, short-lived Clerk development sign-in tickets were used only to establish isolated setup sessions for these fixture operations. These checks prove the actual provider memberships and application authorization paths; they do not prove password, client-trust, MFA or reset-code completion, or invitation email-link redemption. No testing OTP or forged token was used. All separately recorded setup sessions were verified against their QA identity, revoked after fixture checks, and their private browser state removed. The accounts, generated passwords and actual authorization grants were retained.

[Patient library under a dark system preference](little-hello-2026-10-21/qa-patient-library-dark-system.png) shows the actual synthetic account fixture. Its account-code section is masked. The [focused unsigned-copy capture](little-hello-2026-10-21/qa-patient-copy.png) excludes that section entirely. The computed body background remained `rgb(255, 255, 255)` with `color-scheme: light only`.

The local role-override change passed nine stored Python tests, with eleven additional isolated checks of existing runner safeguards. All six pre-existing user documentation files remained byte-for-byte unchanged.

## Access removal and restoration

The owner explicitly approved temporary clinician suspension, location removal and patient-binding revocation on these synthetic fixtures. Each comparison reused the same signed bearer token obtained before the corresponding access change. Baseline requests succeeded; the tokens remained valid throughout each denial/restoration sequence.

| Temporary change | Observed result with the existing token | Restored result |
| --- | --- | --- |
| Clinician suspended through the owner endpoint | Patient read: 403 `ENROLLMENT_REQUIRED` | Original role and explicit location reactivated; patient read: 200. |
| Clinician active with no location assignments | Patient read: 403 `LOCATION_ACCESS_DENIED` | Original explicit location restored; patient read: 200. |
| Patient account binding revoked through the staff endpoint | Library: 200 with no items; communication profiles: 200 with none; original PDF: 404 `PAPERWORK_COPY_NOT_FOUND`. | New verified binding for the same patient/account: one library item, one profile and the original PDF: 200. |

Final owner-directory readback confirmed the clinician's original active enrollment, role and location assignments. Patient restoration used a new grant, preserving the original patient/account scope, self relationship, disabled email delivery and exact original expiry. The previous grant remains revoked. The original released unsigned PDF remained unchanged at 1,181 bytes and was retrieved successfully with its `application/pdf` content type and `%PDF-` header. The dedicated staff permission and provider-signed recent-factor checks applied to both revocation and the new binding.

All three approved checks passed and both accounts were restored. No password, provider role policy, email delivery or production state changed. Administrative setup sessions created for this follow-up were individually revoked after verification, with their private browser state removed.

## Remaining acceptance

Complete actual password/client-trust or enrolled-MFA code entry, reset-code entry, password update and old-password rejection through the normal verification flow. Actual invitation delivery and authenticated in-app acceptance passed; invitation email-link redemption remains separate. Second-practice denial remains untested against an actual second practice. The approved suspension, location-removal and patient-binding revocation/restoration checks passed as recorded above. A new production test identity and separately reviewed rollout are required for production acceptance; development accounts do not carry into production. OAuth requires an actual account at the selected identity provider, not a Gmail role alias.

Record provider template activation, delivery and Gmail/Apple Mail/Outlook rendering separately. See [Little hello email activation](../little-hello-emails.md) and the earlier [implementation verification](little-hello-2026-10-21/README.md).
