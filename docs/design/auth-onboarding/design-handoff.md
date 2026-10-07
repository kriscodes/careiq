# CareIQ authentication and practice onboarding

Visual design handoff · Web, iOS and Android · October 6, 2026

## Design intent

Help a practice owner establish an account and a first location with a short, calm flow. Help an invited teammate understand where they are joining and what happens before they can work. These designs are a reviewable prototype; they do not activate authentication, send invitations, provision practices, or release native apps.

Keep every product page background white. Retain CareIQ’s existing sage accent and restrained typography. Use color for actions, selected states and small supporting surfaces; avoid colored full-page backgrounds, decorative onboarding illustrations and excessive reassurance copy.

| Token | Value / usage |
| --- | --- |
| Primary | `#496f5a` — primary action and selected state |
| Text | `#2b3832` — headings and body |
| Muted | `#626f68` — supporting copy |
| Border | `#e4e9e6` — fields and separators |
| Soft | `#f0f5f2` — limited supporting surfaces |
| Page | `#ffffff` |
| Typeface | System sans-serif; clear weight hierarchy |
| Control height | 48px web; 52 design units native |
| Radius | 10px fields and buttons |

One prominent primary action per screen. Label fields persistently. Keep assistance quiet and nearby. Errors use clear text, with color as a supporting cue. Check text contrast, focus visibility and disabled states in implementation.

## Flow and screen inventory

### Authentication

1. **Sign in:** email, password, show/hide password, Forgot password, Sign in, and Create account. Offer only identity methods enabled in the selected Clerk configuration.
2. **Create account:** identity details and credentials required by that configuration. Account creation and practice creation remain distinct.
3. **Verify email:** destination email, code entry, Continue, resend status and change-email/back action. Support paste and autofill.
4. **Forgot password → Check email → Reset password → Success:** show generic email confirmation, clear expiry/retry guidance and a return to sign in.
5. **MFA challenge:** configured verification method, alternative-method action and recovery-code route. Include incorrect/expired code and recovery failure states. Do not imply MFA is universally mandatory.
6. **Session expired:** short explanation and Sign in again. Retain a safe intended destination; reveal protected content only after fresh access checks.

Passkeys are a future consideration and are not presented as a shipping sign-in option. Keep provider-specific settings out of user-facing explanations.

### New practice owner

**Account → Email verified → Approved-founder gate → Three setup steps → Created.**

The gate checks creation eligibility before setup. An unapproved founder sees clear access guidance rather than an unrestricted Create practice action. Current rollout eligibility is controlled by approved identity; an account alone does not establish eligibility.

1. **Practice:** practice name. Explain briefly that locations and teammates can be added later.
2. **First location:** location name, friendly time-zone select and optional address. Suggest the device/browser zone, but require confirmation. Display friendly labels such as “Pacific Time (US & Canada)” while retaining the IANA value `America/Los_Angeles` for submission.
3. **Review:** editable summary and required “I’m authorized to set up and manage this practice” checkbox. Primary action: Create practice and location.

**Created:** confirm the practice and first location. Offer optional Invite your team and an explicit owner location-access action. Setup can finish without invitations. Do not add billing, licenses, NPI, payer connections, data imports or permissions as mandatory setup.

Owner administration does not imply clinical access. A separate post-create action lets the owner explicitly select their own location assignments while retaining the current approved role. Confirm access before offering the working-location chooser. If they skip this action, provide practice settings and a “No clinical location assignments” state.

### Team invitation and entry

**Owner:** employee email → approved role → explicit proposed locations → Send invitation. Explain that access is confirmed after the teammate joins. Show sending, sent, already pending, retry and revocation-confirmation-pending states. Never default to access to all current or future locations.

The owner review screen confirms a joined teammate’s role and each clinical location. A confirmation state distinguishes an active teammate with a location from one whose role is confirmed without clinical assignments.

**Teammate:** invitation → sign in/create account with invited email → provider-confirmed acceptance → finish joining → awaiting owner confirmation → approved practice/location entry.

Design invitation screens for wrong email/account, expired, revoked and already accepted invitations. Provide Use another account or appropriate owner guidance. Link parameters help navigation; they never establish permission. Acceptance does not immediately open records.

**Awaiting confirmation:** identify the practice and explain that the owner confirms the role and locations. Actions: Check again, Switch practice/account and Sign out.

**Practice chooser:** current memberships only; loading, empty and retry states. **Working-location chooser:** assigned active locations only. A single authorized location may be preselected for explicit confirmation. Keep the active practice/location visible in the resulting workspace.

Separate states for no practices, no clinical assignments, inactive location/practice, access removed and temporary access-check failure. Show a relevant next action without clinical previews.

## Web and native behavior

Web uses a narrow form column, generous white space, keyboard navigation, visible focus and a compact progress indicator. Responsive widths must preserve readable labels and avoid horizontal scrolling.

iOS and Android share content, tokens and flow, using native stacks, safe-area spacing and platform back behavior. Respect iOS back/swipe and Android system Back. Keep forms scrollable, with primary actions above the keyboard; avoid sticky actions obscuring fields. Support text scaling, screen-reader labels/status announcements and comfortable touch targets. Verification codes should support whole-code paste rather than requiring six precise taps.

Do not request notifications, camera, contacts or device location during setup. Biometrics and offline clinical access require separate decisions. Invitation links need native routing and a usable web fallback.

## Persistence, recovery and implementation boundary

Preserve unfinished non-sensitive setup across Back navigation. Do not claim durable draft saving until implemented. Loading actions prevent repeated submission and retain entered values after recoverable errors.

Practice creation is idempotent and may partially complete across providers. Pending/timeout UI resumes the original operation with the same details; do not offer duplicate creation. Changed details after a partial operation require reconciliation. Invitation retry similarly resumes its original attempt.

Clear protected records and clinical drafts on sign-out, identity/practice/location changes and access loss. On foreground/resume, show an access check before protected rendering. Token persistence does not grant offline authorization.

Implementation update — October 6, 2026: the canonical web and Expo iOS/Android clients now implement branded authentication, three-step setup, persistent actor drafts and the access states described here. The API enforces controlled provisioning, optional invitations, pending enrollment, explicit location assignments and safe reconciliation. See [implementation](../../auth-onboarding.md) and [verification](../../auth-onboarding-verification.md) for current results. Hosted activation, live delivery and installed-device verification remain separate.

## Implementation acceptance and sources

Map screens to provider-supported auth states and current API outcomes; implement the three-step presentation without expanding required data; prove owner assignment and invitee confirmation; verify retries, denied access and stale context responses. Review keyboard, text scaling, safe areas and invitation links on both native platforms. Use synthetic identities and practice data in design fixtures.

The completed design set contains 34 screen designs adapted for three platforms (102 PNGs), three overview boards and an interactive preview. Browser review passed at 1024, 736, 390, 360 and 320px widths without horizontal overflow. Owner setup, invitation email matching, approval gating, setup resume, explicit location assignment, password recovery and dialog focus were checked in the prototype. This is browser validation of the designs, not native device or production authentication testing.

Local authority: `docs/practice-access-implementation.md`, ADR-005, ADR-017, `docs/design/mobile-architecture.md`, `PracticeAccess.tsx`, `PracticeSettings.tsx` and `practice-access.service.ts` in the read-only reviewed `careiq-practice-mobile` repository.

Inspiration: [SimplePractice account setup](https://support.simplepractice.com/hc/en-us/articles/46228326151181-Getting-started-with-SimplePractice-Part-1-Readying-your-account) and [Jane clinic information](https://jane.app/guide/step-1-clinic-information) inform minimum setup tasks; [Jane onboarding support](https://jane.app/start) informs quiet assistance; [Jane MFA alternatives](https://jane.app/guide/2-step-verification-faq) informs recovery choices; [Tebra’s practice wizard](https://helpme.tebra.com/Tebra_PM/01_Configure_System/Practice_Setup_Wizard/New_Practice_Setup) informs resumable steps. Adapt the interaction principles to CareIQ’s access model and visual language.
