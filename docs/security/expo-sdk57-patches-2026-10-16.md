# Expo SDK57 patch alignment — October 16, 2026

The native application remains on SDK57 and aligns the seven directly requested packages with the published `expo@57.0.30` compatibility map. The installed `expo/bundledNativeModules.json` agrees with every package below.

| Package | Installed version |
| --- | --- |
| expo | 57.0.30 |
| expo-auth-session | 57.0.16 |
| expo-constants | 57.0.22 |
| expo-crypto | 57.0.4 |
| expo-dev-client | 57.0.20 |
| expo-linking | 57.0.13 |
| expo-router | 57.0.28 |

Each exact version and tarball integrity was verified against the official npm registry before installation. Expo's [official upgrade guidance](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) recommends aligning dependencies with the installed SDK and running Expo Doctor. SDK57 transitive packages required by these patches also moved together, including CLI 57.0.31, module core 57.0.23, autolinking 57.0.16, and router server 57.0.13. Other direct application dependency ranges were preserved.

`minimumReleaseAgeStrict: true`, existing exact exclusions, build-script approvals, scoped overrides, and all three version-preserving backports remain unchanged. The install required no new age exception, advisory ignore, or broad override. The lockfile contains published versions and their integrity hashes.

Verified on Node 22.23.2 / pnpm 11.22.0:

- Expo compatibility check: dependencies up to date.
- Expo Doctor: 21/21 checks passed.
- Native lint and TypeScript: passed.
- Native unit tests: 43 passed.
- Existing security/backport integrity and exploit regressions: 16 passed.
- Raw production audit: exit 1, two high registry findings for the existing node-forge and braces backports; zero critical, moderate, low, or informational findings. This remains an unresolved independent release gate, as explained in [the security version notes](next-october-2026.md).

All-platform export verification is recorded in the [workflow implementation guide](../workflow-implementation.md). No native projects were regenerated, no deployment performed, and no remote build initiated by this patch alignment.
