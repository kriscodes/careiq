# Practice model and mobile bootstrap review

Historical bootstrap review: 2026-10-04. For the subsequent October 5 backend/web implementation and validation, see [practice access implementation](practice-access-implementation.md).

Date: 2026-10-04. Base: `7dcc510` (`main`, v0.1.0 interview baseline). Local branch: `codex/practice-mobile`.

This change documents the architecture first, then adds a small iOS/Android application. It does not implement the proposed practice/location backend, migrate data, change existing clinical permissions, or release an app. No existing accepted ADR was overwritten. The requested ADR-013 number was already used for storage; the owner chose the next available number, **ADR-017**.

## Review the decisions

Read [ADR-017](decisions/017-practice-location-membership-model.md) and the [mobile architecture proposal](design/mobile-architecture.md). Both remain proposed for product/architecture review. The proposal was saved before mobile implementation began.

- One Practice remains one Clerk Organization. Locations are CareIQ resources within that tenant. A member can have several explicit location assignments.
- Clerk retains identity, organization membership, the single membership role and permission authority. CareIQ location assignments narrow that authority. Different roles at different locations need an explicit later extension.
- Staff accept an organization-bound invitation and wait for administrator assignment. Pending enrollment has no clinical access. Practice administration alone does not imply access to every location's records.
- Strict location-owned patient records are the proposed default. A shared patient identity or cross-location sharing needs separate review.
- Keep the API-first boundary, PostgreSQL/Drizzle, forced tenant RLS, UUIDv7, audit and retry protections. Location enforcement needs a coordinated migration and old-client gate; the current API still operates at practice scope.
- Use Expo SDK 57, React Native 0.86.3, React 19.2.3, Expo Router, Clerk's Expo provider/SecureStore token cache, and TanStack Query. Clerk makes the effective minimum iOS version 17. Native projects are generated from configuration.
- Share stable contracts and platform-independent logic when two real consumers need them. Keep Next.js components/server code, auth adapters, navigation and secure storage platform-specific. No speculative package was created, and existing web framework versions are preserved.

## What runs today

`apps/mobile` has two native routes: a foundation screen and environment setup. Empty environment values leave the shell usable. With an API origin, the user can manually request public `/health`; the app validates the response, supports cancellation/timeouts, and sends no token or cookies. Optional Clerk provider wiring prepares secure credential storage without adding sign-in UI.

There are no protected API calls, clinical screens, invitation acceptance, location selection, offline clinical cache, push/camera features or database changes. `/me` is deliberately not used for connectivity because it currently provisions practices.

## Run locally

From the checkout root, using Node 22.23.2 (CI) or a supported Node 24 runtime and pnpm 11.22.0:

```sh
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm mobile:ios       # requires full Xcode and Simulator
# or: pnpm mobile:android
pnpm mobile           # Metro for a previously installed development build
pnpm mobile:check
pnpm mobile:doctor
pnpm mobile:export
```

`pnpm dev` keeps the existing web/API/marketing workflow. Root lint/typecheck/test/build include mobile. The root CI also checks Expo dependency alignment. The [development guide](mobile-development.md) covers physical-device networking, regenerated native projects, public configuration and EAS commands.

## Verification and limits

Local verification uses Node 24.19.0 and pnpm 11.22.0. Mobile exports use empty mobile environment values; Next.js builds use the repository's synthetic Clerk publishable key. No real credentials or hosted clinical data are needed.

| Check | Result |
| --- | --- |
| Locked workspace install | Passed |
| Root lint and TypeScript checks | Passed |
| Root automated tests | 58 passed; 7 existing database integration tests skipped because no disposable test database was configured |
| Root build | API, web, marketing and shared package build; Android and iOS Hermes bundle exports passed |
| Expo compatibility and doctor | SDK dependencies aligned. Before native generation, 21/21 checks passed. Final run after generation: 20/21; native tooling check fails because CocoaPods is unavailable on this machine. |
| pnpm peer dependencies | No conflicts |
| Native project generation | Passed for both platforms without installing native dependencies; confirmed Clerk's iOS 17 target, Android callback/packaging configuration and no Apple sign-in entitlement |
| Native compilation, simulator/device launch and visual QA | Not run: only Apple command-line tools are available, without full Xcode or CocoaPods; Android SDK/JDK are absent |
| Native sign-in, invitations and authenticated API access | Not implemented or verified |
| Production dependency audit | **Fails: two high and one moderate upstream finding remain** |

Exports validate JavaScript/asset bundling, not native binary compilation or device behavior. Unit checks do not establish location isolation, production readiness or healthcare compliance. Existing PostgreSQL integration checks still run in CI where its disposable service is configured.

### Dependency audit release blocker

The initial mobile dependency graph introduced seven reported advisories. Compatible, narrowly targeted overrides for `brace-expansion` 5.0.12 and the `xcode` tool's `uuid` 11.1.1 resolve four findings. The existing `qs` override remains. The following three are still reported as of this review:

| Dependency | Finding and path | Why it remains |
| --- | --- | --- |
| `decode-uri-component` 0.2.2 | Moderate malformed URL decoding denial of service; Expo Router → query-string. [Advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | The registry's available fixed 0.5.0 is ESM; the installed query-string expects a callable CommonJS module. A forced major query-string upgrade also changes the import shape expected by Expo Router. A coordinated upstream fix is needed. |
| `node-forge` 1.4.0 | High signature-verification issue; Expo CLI/code-signing certificate tooling. [Advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Audit metadata names 1.4.1 as fixed, but that version was not published in the queried registry. |
| `braces` 3.0.3 | High nested-pattern stack exhaustion; Metro/file-map → micromatch tooling. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Audit metadata names 3.0.4 as fixed, but that version was not published in the queried registry; the parent still depends on 3.0.3. |

No audit exception or suppression was added. The repository's existing `pnpm audit --prod --audit-level moderate` CI step remains failing until compatible fixes are available and validated. Treat this as a release/merge gate, not a passing CI result. Recheck published versions and advisory status before implementing a dependency upgrade. Expo compatibility checks do not override the audit result.

## Remaining setup and review order

1. Review ADR-017's patient ownership, administrator versus clinical access, role policy, assignment timing and migration gates.
2. Resolve the three dependency advisories through compatible, verified upgrades before promotion.
3. Install supported full Xcode/Simulator (SDK 57 requires Xcode 26.4+) with CocoaPods, and Android Studio/JDK/SDK. Expo Doctor recommends CocoaPods 1.15.2 or later. Build and launch both apps, inspect both routes, and test health success/failure/timeouts on actual devices.
4. Choose the first mobile workflow and hosted versus native Clerk sign-in. Configure the matching Clerk application and prove real native token verification against the API's current `authorizedParties` policy without weakening browser validation.
5. Approve and implement server membership/location contracts, enrollment/revocation and location RLS before adding clinical screens. Include stale request, context switch, sign-out and resume protections.
6. Choose owned bundle/package IDs and separate environment variants. The current `dev.careiq.mobile` / `careiq-dev` identifiers are local placeholders. Link an Expo/EAS project, configure public environment values, signing and Apple/Google accounts. EAS profiles are templates; no cloud builds, store releases or OTA updates were created.

## File-by-file change inventory

All paths are relative to the repository root. Generated native directories, dependencies, exports and local check logs are ignored and are not part of the change.

| File | Change |
| --- | --- |
| `docs/decisions/017-practice-location-membership-model.md` | New practice/location decision, invitation lifecycle, authorization model and migration safeguards. |
| `docs/design/mobile-architecture.md` | Design-first proposal covering boundaries, wireframes, auth, API, context, state, storage, sharing, testing and release. |
| `docs/mobile-development.md` | Local/native/EAS setup and remaining integration work. |
| `docs/mobile-bootstrap-review.md` | This review, verification record, audit blockers and complete inventory. |
| `docs/architecture.md` | Adds mobile foundation and proposed location model while labeling the current implementation. |
| `docs/development.md` | Links mobile setup and explains root development/check behavior. |
| `README.md` | Adds app structure, architecture/setup/review links and commands. |
| `apps/README.md` | Application responsibilities and mobile boundary. |
| `packages/README.md` | Shared-package extraction policy and web/native separation. |
| `package.json` | Root mobile launch, check, export and doctor scripts. |
| `pnpm-workspace.yaml` | Explicitly skips two funding-only install scripts and adds the two compatible security overrides; existing workspace patterns and `qs` override remain. |
| `pnpm-lock.yaml` | Single locked dependency graph with Expo-compatible native peers and app-local React/TypeScript. |
| `.github/workflows/ci.yml` | Adds Expo SDK dependency validation; existing recursive checks pick up mobile. |
| `.gitignore` | Ignores generated Expo/native metadata and binaries; removes stray Markdown wrapper text. |
| `apps/mobile/package.json` | Expo entry point, scripts and compatible pinned dependency ranges. |
| `apps/mobile/app.json` | iOS/Android app metadata, provisional IDs and config plugins. |
| `apps/mobile/eas.json` | Development, preview and production build profile templates. |
| `apps/mobile/.env.example` | Optional public configuration with blank values. |
| `apps/mobile/tsconfig.json` | Expo base, strict typing and explicit types for the Node test runner under TypeScript 6. |
| `apps/mobile/metro.config.cjs` | Standard Expo workspace-aware Metro configuration. |
| `apps/mobile/eslint.config.cjs` | Expo lint rules and generated-file exclusions. |
| `apps/mobile/README.md` | App entry point and developer commands. |
| `apps/mobile/app/_layout.tsx` | Native stack, safe-area and provider composition. |
| `apps/mobile/app/index.tsx` | Foundation route with clear scope and setup navigation. |
| `apps/mobile/app/setup.tsx` | Configuration status and manual health check. |
| `apps/mobile/src/config.ts` | Public origin/key checks; local HTTP permitted only in development. |
| `apps/mobile/src/environment.ts` | Expo static public environment reads. |
| `apps/mobile/src/health.ts` | Public, cancellable, bounded, validated health request with safe errors. |
| `apps/mobile/src/providers.tsx` | Optional Clerk provider/token cache, memory-only query client and error fallback. |
| `apps/mobile/src/styles.ts` | Small app-local native style set. |
| `apps/mobile/tests/config.test.ts` | Missing configuration, invalid origins, release HTTP restrictions and secret-key rejection. |
| `apps/mobile/tests/health.test.ts` | Public request behavior, invalid responses, failures, timeout and cancellation. |
