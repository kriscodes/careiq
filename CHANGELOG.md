# Version history

Release notes in this repository are the source of truth. Each released version has a Git tag, a detailed note, and a short entry under **Software Project → Version Notes** in Notion.

## Unreleased

October18 mobile separation and release hardening:

- Separate native mobile source from active installs, CI, releases and local previews; preserve a verified private handoff for a future repository.
- Use one root workspace/lock; remove mobile-only dependencies while retaining the patched development-only Next lint dependency and visible audits.
- Keep web app-link hosting and gated native API contracts for future clients.
- Harden production document/audit storage, cursor keys and audit transport; block marketing contact redirects/referrer forwarding.
- Require isolated real API/browser paperwork verification in release checks; record actual production versus full development audit results separately.

See [mobile separation](docs/mobile-separation.md) and [current verification](docs/verification/mobile-separation-2026-10-18/README.md). Historical mobile implementation entries below describe the earlier combined workspace. No new remote repository, release, deployment or database migration is created by this separation.

October 18 integration: reconcile current `main` into the clinical workflow/Forms Studio branch, preserving released history, existing migration hashes and the current security boundaries. This local merge resolution is not a deployment.

October 6 implementation, included in the unreleased PR #10 branch:

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
