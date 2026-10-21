# Development QA accounts — October 21, 2026

Five dedicated identities were created in the existing, confirmed Clerk Development instance using Gmail role aliases approved by the owner. No production identity, membership, practice/location assignment or patient account grant was created. The intended owner, administrator, member, configured-clinician and adult-patient labels identify test purposes, not effective application authority.

Account addresses, development user IDs and setup progress are in the owner's private Notion registry, linked from the [QA account guide](../qa-test-accounts.md). Unique generated passwords are only in the ignored local handoff file with mode 600, for transfer into the owner's password manager. No password, OTP, session token, reset link or recovery code is included in this record. The original unrelated local documentation files remain unchanged.

## Verified account provisioning

- The API and web private configuration were confirmed to use matching test keys; the actual Clerk instance reported `development` before user creation.
- All five users were created successfully and passed Clerk's backend password verification.
- All five had zero provider organization memberships after creation.
- Backend creation uses verified email identifiers by default. It does not prove signup email ownership verification.
- The five registry rows were read back as Created / Development. No row is marked Ready for complete role-based acceptance.

## Reproduced and corrected sign-in continuation

Actual password submissions for the five new users reached `needs_client_trust`, with an offered email-code factor and no prepared code. The prior implementation delegated this state to an embedded provider form, which restarted at identifier/password entry.

Supported device trust and enrolled MFA now continue through the existing factor verification APIs. An unprepared code challenge offers an explicit send action with accurate copy; restoration sends nothing and preserves an already prepared factor. Backup-code-only challenges use the recovery input. Unsupported factors and OAuth callbacks retain their provider-owned path. Incomplete verification cannot finalize a session.

Installed Chrome checks against all five actual development identities passed after the correction: each password reached “Verify this sign-in”, showed the send action, retained `needs_client_trust`, remained signed out, prepared no code automatically and kept a white background with a dark OS preference. No send action was clicked during these follow-up checks. These are successful challenge-entry checks, not completed sign-in.

## Actual reset delivery

The local custom recovery form requested actual Clerk development reset messages. Owner, administrator and member requests reached Check your email without a UI error, and messages were found at each exact approved Gmail alias. Clinician and patient requests failed during the same run; one clinician diagnostic confirmed HTTP 429 / `verification_code_rate_limit_exceeded`, with no Retry-After header. Further mail attempts stopped.

The observed rate-limit code now uses the existing localized wait message rather than generic retry advice. No wait duration is invented. The mail connection withholds one-time authentication codes; no alternate channel or testing-token bypass was used to retrieve or bypass them. Passwords were not changed. Existing Clerk development email templates remain active; hosted Little hello template activation is separate.

## Automated verification

Web unit tests: 95 passed. Translation tests: 5 passed. Web lint/typecheck and the isolated Next 16.4.1 webpack production build passed. The production build used reserved synthetic configuration without live credentials. All 54 authentication browser cases passed in the final complete component run. Across the full 97-case component suite, 96 passed and the first communications case timed out during Chrome context setup before an application step; rerunning that unchanged communications file passed all 7 cases. No test timeouts, launch options or assertions were relaxed. The final recovery-Back correction is covered by its browser regression.

The [320px verification screen](little-hello-2026-10-21/trust-unsent-dark-system-320.png) is a controlled component fixture with a visible mock-data label, not an actual account screenshot. It was captured as a fixed viewport after a full-page Chrome capture repeated a header visually; DOM inspection confirmed exactly one screen, wordmark and fixture caption. No production layout change was needed for that capture artifact.

## Remaining acceptance

Complete actual code entry, password update and old-password rejection after provider throttles clear. Establish a deliberately approved QA owner through controlled local onboarding; test team invitation delivery/acceptance, owner activation and exact location/permission grants. Bind the adult-self QA patient through the designated staff flow. Test denial after revocation and across practices without assigning blanket access. A new production test identity and separately reviewed rollout are required for production acceptance; development accounts do not carry into production. OAuth requires an actual account at the selected identity provider, not a Gmail role alias.

Record provider template activation, delivery and Gmail/Apple Mail/Outlook rendering separately. See [Little hello email activation](../little-hello-emails.md) and the earlier [implementation verification](little-hello-2026-10-21/README.md).
