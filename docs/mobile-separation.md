# Mobile repository separation — October18,2026

The owner requested mobile be removed from the active CareIQ repository now. The separate mobile GitHub repository will be created later. The active checkout remains `/Users/kristian/Documents/Server/CareIQ` and contains API, authenticated web, marketing and shared packages.

## Preserved local handoff

Before removal, all62 tracked mobile files and16 shared localization files were copied and SHA-256/byte-size verified. The mobile source matched starting commit `11df3349d87d9f36235ec5c4047398d290cb9306`. Fifteen dependency/security/toolchain references were preserved as well. An independent reviewer verified all93 files, source inventory, privacy boundaries and source-commit equivalence.

Owner-only handoff directory:

```text
/Users/kristian/Documents/Server/CareIQ-mobile-handoff-2026-10-18/
  README.md
  manifest.json
  source/apps/mobile/             # Tracked source/templates/tests
  source/packages/i18n/           # Matching shared localization snapshot
  reference/                     # Original lock/policy, patches/tests and guides
  private-local-state/           # Private original ignored/generated recovery state
```

The handoff is outside the active checkout and is not part of CI or deployment. Source/reference contain no real environment files, credentials, generated output or symlinks; `.env.example` remains a blank template. The complete original working directory is preserved under private-local-state for recovery, behind mode0700 parents. **Never copy that private directory wholesale into a new repository or upload it.** Original node_modules links/generated state are not portable. No new Git repository, remote, commit or push was created.

The deleted tracked files also remain in local Git history. Recover an individual source file from `11df334:apps/mobile/<path>` or export the selected directories from that exact commit into a new reviewed directory. Preserve any later local work separately; do not reset the CareIQ checkout to recover mobile.

## Active workspace and commands

The root workspace explicitly lists the three active applications. Mobile imports and Expo commands no longer participate in install/build/lint/typecheck/test/CI. The stale nested web workspace/lock is removed so child-directory commands resolve the same root lock and security policy.

Run from the canonical root with pinned Node22/pnpm11.22.0:

```sh
pnpm install --frozen-lockfile
pnpm release:check
pnpm web:associations:test
pnpm web:associations:check
```

`release:check` first requires a loopback database named `careiq_test` without URL query overrides/fragments, then checks the retained workspace, dependency regressions, web associations, component browser cases, actual API/restricted-database paperwork cases and the unchanged raw production audit. Supply private test configuration without posting credentials. Browser checks require the installed Playwright browser; the local review uses `PLAYWRIGHT_CHANNEL=chrome` when selecting installed Chrome.

`web:associations` and its check command still require real owner-approved native identifiers/domain/certificate metadata before producing deployable website association files; missing metadata intentionally fails. They do not fabricate a mobile registration. The existing generated-file checks/public exact-path hosting remain for a future client. No native API gate was enabled and no current authentication, tenant/location, audit, document or database policy was relaxed.

## Future mobile repository

1. Choose the destination repository and source/history strategy explicitly; no repository has been created by this extraction.
2. Use the reviewed `source/` files and matching shared localization. Existing imports expect the `apps/mobile` plus `packages/i18n` layout; the copied i18n package's tooling scripts refer to web node_modules and must be adapted before a standalone install.
3. Prepare a mobile-only workspace/manifest/lock with the pinned compatible Expo/React Native toolchain. The reference lock represents the earlier combined workspace and must not be copied blindly as the new repository's active lock.
4. Retain/review the original mobile dependency security patches and exact regressions until genuine fixed releases or a reviewed compatible replacement is available. Separation did not fix the archived mobile dependency graph.
5. Deliberately publish/version or duplicate-and-own the shared localization/API contracts. Existing API versioning, environment/provider mapping and native authorization remain server-owned.
6. Configure real owner IDs, Expo/EAS/signing/domain/provider settings and repeat compiled installed iOS/Android authentication, link, session, access and accessibility acceptance before enabling native access or distributing a release.

Production and full audit results, remaining lint/vendor limitations, retained application verification and the commit handoff are in [current verification](verification/mobile-separation-2026-10-18/README.md). Historical mobile design/development/verification documents retain their earlier scope and do not describe an active app in this checkout. See [ADR-018](decisions/018-mobile-repository-separation.md).
