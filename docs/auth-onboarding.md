# Authentication and practice onboarding

This change is implemented in the existing checkout at `/Users/kristian/Documents/Server/CareIQ`. It is local review work: no GitHub push, remote deployment or hosted database migration was performed. Existing marketing changes were preserved.

## Designs

The [design handoff](design/auth-onboarding/design-handoff.md) defines 34 screen types for web, iOS and Android. The [interactive prototype](design/auth-onboarding/prototype.html), editable source, inventory, platform boards and design verification record are checked into `docs/design/auth-onboarding/`.

The complete 102-screen PNG export and prototype are also saved in [Notion → Software Project → Designs → Authentication and practice onboarding](https://app.notion.com/p/3f1e97848806815682ffc19d3c845ecc). Screen archives are split per platform to fit the workspace attachment limit. Product pages stay white; sage is the primary accent, with restrained borders, clear labels and one main action per screen.

The design preview uses synthetic accounts. It does not authenticate, create practices or send invitations. Live web/mobile pages use Clerk and the authenticated API. Password recovery follows the enabled provider's supported reset-code workflow; provider requirements such as MFA and session tasks remain authoritative.

## Flow and authorization

- Sign in or create an account, then complete the provider's email verification/MFA/session requirements.
- Existing members select their practice and an explicitly assigned active location. Invitations must match the intended identity and do not immediately grant clinical access.
- A verified, explicitly approved founding Clerk user can create a practice. Empty `CAREIQ_PRACTICE_CREATOR_USER_IDS` disables creation. The client cannot approve itself.
- New-practice setup has three steps: practice name, first location, and review. Drafts are saved on the server for the same actor, and submitted operations can resume after interruption.
- Creation is deliberate and idempotent. Reading `/api/v1/me` or setup state never provisions a practice. Once submitted, the operation payload is immutable; pending retries reconcile that original request.
- Ownership permits administration. Clinical access requires a separate explicit working-location assignment. Pending staff enrollment requires owner confirmation; suspended or revoked access fails closed.
- Optional team invitations follow successful creation. Location administration, team grants and clinical permissions use the same server policy on every client.

## API and database

`GET /api/v1/onboarding/state` returns:

```json
{
  "data": {
    "eligible": true,
    "emailVerified": true,
    "draft": {
      "practiceName": "Harbor Family Practice",
      "locationName": "Main location",
      "timeZone": "America/Los_Angeles",
      "address": "",
      "step": 2
    },
    "operation": null
  }
}
```

Draft and operation may be `null`. An operation reports `pending` or `complete` with its practice/organization identifiers when known. Eligibility reflects the verified server policy and does not itself authorize a write.

`PUT /api/v1/onboarding/draft` accepts `{practiceName, locationName, timeZone, address, step}` and returns `{data: draft}`. Partial draft text may be empty; `step` is 1, 2 or 3. Only an authenticated eligible verified founder can save it. Writes return `409 ONBOARDING_IN_PROGRESS` or `ONBOARDING_ALREADY_COMPLETE` after submission rather than changing the reconciliation payload.

`POST /api/v1/onboarding` keeps the existing contract: `{name, location: {name, timeZone, address?}}` plus a UUIDv4 `Idempotency-Key`. Setup retries retain the submitted payload and resume the existing operation even after moving to another device. Draft values are UI progress, not an alternate source of authority.

Migration `0017_onboarding-drafts.sql` adds actor-scoped drafts with FORCE RLS and narrow runtime grants. Earlier missing migrations `0015_clinical-security.sql` and `0016_location-membership.sql` were reconciled into the canonical checkout. Migration replay and tests run only on isolated local databases. The runtime login inherits `careiq_clinical_runtime`; it is not a table/schema owner, superuser or RLS-bypass role. See [practice access](practice-access-implementation.md) and [security hardening](security-hardening.md).

Browser sessions retain exact authorized-party and origin configuration. The separate native bearer branch requires explicit `CLERK_NATIVE_AUTH_ENABLED=true`, a verified Clerk session token, and a native transport without browser Origin/Cookie headers. Any present native `azp` must match the reviewed exact allowlist. The gate defaults off and remains off in local review until actual installed-device/session acceptance. Native callback URLs and arbitrary origins are not authorization rules.

## Repository changes and documentation reconciliation

`apps/web` contains branded Clerk authentication, access/session states, three-step onboarding and practice/location administration. `apps/mobile` contains the Expo iOS/Android implementation, secure provider token cache, in-memory request/data lifecycle and the same onboarding/access contract. `apps/api` enforces the shared policy and persists/reconciles setup state.

Documentation previously authored in local project copies was brought into this repo: ADR-017, security/backup runbooks, practice access, mobile architecture/development/review, deployment history, release guides and changelog. Historical verification/deployment entries remain historical; they do not imply these new changes are deployed. Current architecture/development guidance now describes controlled provisioning rather than lazy `/me` creation.

`AGENTS.md` records the canonical checkout and the instruction to stop creating fresh GitHub checkouts for routine work. All new handoffs and verification records must be added to this repo.

## Verification and local review

API verification: 109 tests passed with zero skips, including restricted-role PostgreSQL isolation, actor drafts, pending/complete reconciliation, signed-token/native policy and marketing regression checks. API typecheck/build passed. The full 18-migration journal applied to empty `careiq_test`, then replayed as a no-op; it also applied to isolated `careiq_review`.

Web/mobile integrated results and visual evidence are recorded in [the current verification record](auth-onboarding-verification.md). A JavaScript export is not an installed native binary. Device networking, native provider callbacks, invitation cold/warm starts and actual expiry/revocation acceptance remain separate checks.

Start or inspect the local environments using [the local review guide](local-review.md). These environments use a dedicated loopback PostgreSQL container and Clerk test keys; they preserve the original hosted `.env` settings without using the hosted database.
