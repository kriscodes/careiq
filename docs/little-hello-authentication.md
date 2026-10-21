# Little hello authentication

The approved Little hello design now styles CareIQ sign-in, account creation, email verification, password recovery, MFA/recovery, invitation handoff and required session tasks. Shared practice setup and access states use the same wordmark, typography and blue controls. The application keeps white surfaces under a dark computer preference.

## Interface

Authentication uses a small blue companion, Caprasimo headings, local Nunito Sans body text, one clear form column and the footer “A little more room to care.” English and Spanish copy share the same hierarchy. Fonts and provider artwork are served from `apps/web/public/brand/`; fonts include their licenses. No external font request is required.

Inputs retain password-manager autocomplete, visible labels, keyboard focus, show/hide controls and mobile sizing. Deliberate actions lock their controls while in flight; passive session updates leave the form stable. Verification and reset flows retain code resend cooldowns, redacted errors and safe return destinations. Password reset still signs out other sessions. Invitations retain the provider ticket when changing accounts, and accepted team invitations still require owner confirmation and location assignments.

## Social sign-in configuration

The custom buttons support Google, Microsoft and Apple through the installed Clerk SDK's `signIn.sso` and `signUp.sso` methods. Configure only connections already enabled and verified in the target Clerk instance:

```dotenv
NEXT_PUBLIC_CAREIQ_AUTH_PROVIDERS=google
```

This public build-time allowlist accepts `google,microsoft,apple`, removes duplicates and ignores unrecognized names. An empty value shows no direct provider buttons. “Other ways to sign in” and “Other ways to create an account” retain Clerk's configured methods. Invitation redemption stays in the provider-owned invitation flow rather than offering an unrelated new social signup.

Callbacks return through the existing sign-in/sign-up hash route and required session tasks. Return destinations are clamped to approved application routes. Changing this variable requires a rebuild and does not enable a connection in Clerk. This implementation did not change hosted provider settings.

## User types and authority

| User type | Verified local behavior |
| --- | --- |
| Practice owner | Account authentication remains separate from ownership. Existing owner onboarding, management, transfer and suspension protections remain authoritative. |
| Administrator | Accepting an invitation alone provides no practice/location access. An owner must activate membership and location assignments; capabilities follow explicit provider permissions. |
| Team member | Same invitation/activation boundary; sign-in or signup does not grant access. |
| Configured staff role | The configured clinician role is exercised in the database matrix. Unknown invitation roles are rejected. |
| Adult patient | Uses the shared identity flow; completed-copy access additionally requires the existing verified adult-self account binding. Foreign, missing and revoked grants remain denied. |
| Guardian/representative | No supported authority or invitation flow is introduced. |

Authentication and access emails use the [Little hello email renderer and activation guide](little-hello-emails.md). Identity emails do not invent a practice role; patient messages contain no identity or clinical details. Clerk remains responsible for authentication email delivery. The code includes offline export and guarded template activation tooling; provider activation and actual inbox acceptance remain separate release work.

## Review and verification

Open [local sign-in](http://localhost:3101/sign-in) after starting the existing isolated local environment. The [QA test account guide](qa-test-accounts.md) explains the dedicated development identities, private credential handoff and remaining role setup. The [October 21 verification record](verification/little-hello-2026-10-21/README.md) records browser, database, build and email checks with their limits.

Actual provider login, password reset mail, invitation delivery/redemption and Gmail/Apple Mail/Outlook rendering require the dedicated test identities, their remaining access setup and a reviewed provider-template rollout. Record completed real-account checks separately from the earlier component evidence. Controlled provider mocks prove the local transitions, not delivery by a hosted authentication provider.
