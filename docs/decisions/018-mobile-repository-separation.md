# ADR-018: Separate native mobile source and release ownership

**Status:** Accepted, October18,2026. Implemented locally; no new remote repository or release created.

## Context

The owner requested that mobile leave this repository now, with a separate mobile repository created later. Expo/Metro introduced mobile build/signing dependencies into the repository-wide production audit even though the API/web/marketing production dependency paths did not require them. Mobile also has separate native toolchain, signing, provider and installed-device acceptance requirements.

## Decision

- The active workspace contains only `apps/api`, `apps/web`, `apps/marketing` and the existing shared packages. Remove mobile source from the checkout and prune its actual dependency closure from the root lock; no audit ignores, aliases or version changes are used to disguise retained findings.
- Preserve a verified owner-only source handoff outside the checkout before removing `apps/mobile`. Keep matching shared localization and original security/dependency references for future recovery. Private ignored original working state remains separate from the clean source handoff and must never be published wholesale.
- Remove mobile commands, Expo CI steps and the mobile local supervisor. Retain web-hosted mobile association generation/tests under `web:associations*`, and keep backend native-auth policy, contract and security tests for future clients. Native access remains gated by its existing configuration and acceptance rules.
- Use one canonical root workspace/lock, including installs initiated from the web app directory. Remove the stale nested web workspace/lock rather than allowing an older security/dependency policy to reappear.
- Keep shared EN/ES mobile localization entries in the web-used i18n package; it imports them statically. Separate publishing/version ownership and standalone mobile manifests are future work.
- Preserve production audit gates. Also record the full development audit honestly: `braces` remains in Next lint tooling and retains its reviewed backport. Its finding is not resolved by renaming or suppressing it.

## Consequences

The current repository no longer builds or releases native mobile. Mobile work is preserved and recoverable, but there is no new repository, standalone installable project, signing identity or native release. A future repository needs mobile-only manifests/lock, deliberate shared localization/contracts ownership and independent native/provider/device acceptance.

The server/database contract and clinical security boundaries are unchanged. No schema migration is introduced. Repository separation does not certify hosted identity, operating controls, or arbitrary bundled third-party code. Current source, dependency, artifact and test boundaries are recorded in the [separation guide](../mobile-separation.md) and [verification](../verification/mobile-separation-2026-10-18/README.md).
