# Version history

Release notes in this repository are the source of truth. Each released version has a Git tag, a detailed note, and a short entry under **Software Project → Version Notes** in Notion.

## Unreleased

Local, unpushed review changes from October 6, 2026:

- Branded authentication and three-step practice onboarding for web and Expo iOS/Android.
- Actor-isolated server drafts, immutable pending-operation recovery and the new onboarding-state API.
- Reconciled security/location baseline and previously missing documentation into the canonical checkout.
- Design handoff, editable prototype, web/iOS/Android boards and Notion design/board updates.
- Isolated local review database, restricted runtime and separate application previews.
- Production startup/configuration guards, read-only restricted database verification and migration-ledger checks; additive migration 0018 pins authorization helper search paths.
- Production design-gallery blocking, secure API origins, invitation return routing and mobile transport/session safeguards.
- Owner-configured mobile association-file generator, regression checks and a checks-only CI workflow.
- Scoped published dependency upgrades and version-preserving security backports with integrity/compatibility checks; the raw audit and installed-device/provider acceptance remain open.

See [implementation](docs/auth-onboarding.md), [baseline verification](docs/auth-onboarding-verification.md) and [current production-readiness status](docs/production-readiness.md). These entries do not describe a released version or remote deployment.

## 0.1.0 — 2026-10-03

**Interview baseline · Initial SDLC release · Synthetic/demo use only**

Establishes the first versioned CareIQ interview demo: sign-in and practice selection, patient creation/search, and appointment creation/listing with day/week navigation. Includes the API/database security hardening merged before this baseline. Production authentication, remaining hosted security acceptance and operating controls are still open.

- [Full version notes](docs/releases/0.1.0.md)
- [GitHub release](https://github.com/kriscodes/careiq/releases/tag/v0.1.0)
- [Source at v0.1.0](https://github.com/kriscodes/careiq/tree/v0.1.0)

See the [release process](docs/releasing.md) for version numbering, cadence and the checklist.
