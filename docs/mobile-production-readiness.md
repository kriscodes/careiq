# Mobile production readiness

> October18,2026: native mobile source is no longer active in this checkout. A verified private handoff is preserved for a separate repository to be created later. Mobile commands/results below describe the earlier combined workspace; standalone setup and acceptance remain future work. See [separation and recovery](mobile-separation.md).

October 16 workflow implementation and verification are recorded in [the workflow review guide](workflow-implementation.md) and [current verification](verification/workflow/verification.md). Earlier results below remain historical.

Date: 2026-10-06. Scope: local changes and verification in the canonical CareIQ checkout. No native release, hosted configuration, signing operation, account registration or deployment was performed. The API native-client gate remains disabled pending installed-device acceptance.

## Implemented safeguards

- Every foreground access check creates a new generation, cancels earlier requests and accepts only the latest result. Background/inactive transitions hide protected screens, cancel requests, clear the query cache and selected location, and require a fresh provider token plus `/api/v1/me` before reopening protected content.
- Token acquisition shares the 25-second request deadline. Background cancellation rejects promptly even when the provider promise is still waiting; a late token or response cannot enter a changed account, session, practice or location.
- `/me` responses must match the current Clerk user/session/organization and contain the expected access fields. Malformed and cross-context responses leave the protected gate closed.
- Password and verification-code fields clear when the app becomes inactive. Backup-code-only authentication goes to recovery. Sign-in preserves only an allowlisted `/join` destination; external redirects and caller-supplied confirmation parameters are discarded.
- Invitation acceptance uses the signed-in user's Clerk invitation resource. The accepted organization survives the provider remount in a route hint, then must match the active organization before the API confirms enrollment. Failed confirmation retains a retry screen. A query parameter grants no membership, role or location.
- Development, preview and production variants have separate configuration. Preview uses distinct provisional identifiers. Production cannot use the development placeholders, missing configuration, a test/secret Clerk key, a non-public/insecure API origin, malformed link host or missing EAS project UUID.
- Preview/production native configuration explicitly disables iOS arbitrary HTTP loads, Android cleartext traffic and Android backups. Distributed variants do not register the generated Expo development-client scheme. Development retains Metro connectivity.

Clerk's installed secure token cache stores the client credential in Expo SecureStore; the SDK implements native token-cache synchronization and cleanup. CareIQ does not enable Clerk's experimental offline resource cache or persist API/query/clinical data. Device verification of sign-out cleanup remains required.

## Build configuration

`apps/mobile/app.json` is the base; `app.config.cjs` and `release-config.cjs` resolve the variant and enforce production setup. Durable transport configuration lives in `plugins/with-release-transport.cjs`. Generated `ios/` and `android/` directories remain ignored. Expo supports dynamic config resolution and public config inspection; app configuration must not contain secrets. [Expo app configuration](https://docs.expo.dev/workflow/configuration/).

The EAS profiles explicitly select `CAREIQ_MOBILE_VARIANT=development`, `preview` or `production`. Unique platform identifiers let variants coexist. Switching a native variant requires regenerating native directories before compilation. [Expo app variants](https://docs.expo.dev/build-reference/variants/).

| Variable | Production requirement |
| --- | --- |
| `CAREIQ_MOBILE_VARIANT` | `production` (already set by that EAS profile) |
| `EXPO_PUBLIC_API_URL` | Matching public HTTPS API origin, no credentials/path/query/fragment |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Matching live Clerk publishable key; never a secret key |
| `MOBILE_IOS_BUNDLE_ID` | Owner-approved registered production iOS identifier |
| `MOBILE_ANDROID_PACKAGE` | Owner-approved registered production Android identifier |
| `MOBILE_SCHEME` | Registered production callback scheme, distinct from development |
| `MOBILE_LINK_HOST` | Verified owned HTTPS invitation-link hostname; no scheme/path/wildcard |
| `MOBILE_EAS_PROJECT_ID` | The owning Expo/EAS project UUID |

These values are public app metadata or bundled public configuration. Validation checks their structure; it does not prove ownership, signing, matching backend/Clerk settings or working domain associations. Supply real owner-approved values through the build environment. Synthetic values in tests and temporary verification files are not deployable configuration.

To inspect real production settings locally:

```sh
EXPO_NO_DOTENV=1 CAREIQ_MOBILE_VARIANT=production pnpm --filter @careiq/mobile exec expo config --type public
```

This intentionally fails until the required values are supplied by the owning release environment. Do not weaken the gate to make an unconfigured production build pass.

A no-account CI bundle check can use the preview variant:

```sh
EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 CAREIQ_MOBILE_VARIANT=preview pnpm --filter @careiq/mobile exec expo export --platform all --output-dir /private/tmp/careiq-mobile-ci-export
```

This checks JavaScript/assets, including static web routes. It does not produce an installable binary or test a native session. The local development gallery continues at `http://localhost:8082/design-preview`; production redirects that route to the real app entry.

## Invitation links and authentication callbacks

The current custom authentication screens use password/email codes, MFA and recovery codes. No custom OAuth/SSO browser flow is enabled by these screens. Clerk's required-security/native account component must be exercised against the actual configured instance on both platforms, including every provider or task that the instance exposes.

`MOBILE_SCHEME` registers native callback routing; it does not establish domain ownership or invitation authority. Before native distribution, configure the matching Clerk native application/redirects and test any SDK-hosted provider return flow on cold and warm starts. Keep Apple/social/provider options disabled in the instance unless their corresponding native integration has been configured and accepted.

`MOBILE_LINK_HOST` generates the iOS associated-domain entitlement and Android auto-verified HTTPS `/join` intent filter. Website verification is still required: an owner-approved AASA containing the Apple Team ID, bundle ID and `/join` paths; and an `assetlinks.json` containing the package ID and actual signing-certificate SHA-256 fingerprints. These files need the real accounts/signing identities and were not fabricated or published. See [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/) and [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/).

Test links from email/browser with and without the app installed. Cover cold/warm starts, signed-out return through sign-in/sign-up/MFA, different-email accounts, different active practices, expired/revoked/already-accepted invitations, activation failures and failed API confirmation. Confirmation can create pending enrollment only; the owner must still assign role and locations.

## Verified locally

| Check | Result |
| --- | --- |
| Supported runtime | Node 22.23.2 with the refreshed workspace lock |
| Mobile TypeScript and lint | Passed |
| Automated tests | 33 passed: configuration, identity/access validation, background/overlap/sign-out lifecycle, token cancellation/deadline, invitation intent, onboarding immutability/refusals, assigned access and public health |
| Online Expo Doctor after patch alignment | 21/21 passed |
| iOS/Android/web preview bundle export | Passed, 17 static routes |
| Production config without release values | Rejected as intended |
| Production config introspection with synthetic fixtures | ATS arbitrary loads disabled; Android cleartext/backup disabled; associated domain and restricted verified intent filter present; development scheme absent |
| Isolated production prebuild with synthetic fixtures, `--no-install` | Both native projects generated successfully; iOS deployment target 17.0, native URL types/entitlements and Android manifest inspected |

Temporary exports/native projects were generated outside the checkout. Prebuild validates config/plugin/project generation only. It does not run CocoaPods/Gradle compilation, sign a binary, install an app or exercise Clerk on a device. Dependency security status is tracked by the repository's production-readiness record and audit checks; Expo Doctor does not replace that audit.

## Remaining release gates

| Gate | Current state / acceptance required |
| --- | --- |
| iOS toolchain and native binary | This machine selects Command Line Tools, has no full Xcode app or CocoaPods on PATH. Install the supported full toolchain, compile and launch the development/release candidate; inspect actual deployment/signing/permissions. |
| Android toolchain and native binary | Android SDK directory and adb/emulator/sdkmanager are absent. Configure supported JDK/SDK, compile and launch; inspect merged release manifest and signing. |
| Real native token verification | Prove actual native JWT `azp`, expiry, revocation, audience/issuer and session behavior against the separately gated API policy using synthetic accounts. Keep the API native-client gate off until accepted. |
| Installed-device auth/session/access | Verify sign-in/up/verification/reset/MFA/backup/task completion, rejected access, sign-out SecureStore cleanup, account/practice/location changes, background/resume and loss of connectivity on iOS and Android. |
| Invitation link/domain acceptance | Real account/signing/domain ownership, verified association files, configured redirects and cold/warm link tests remain external prerequisites. |
| UX/accessibility | Test VoiceOver/TalkBack, large text, safe areas, Android back, keyboard avoidance, time-zone modal, and authority confirmation on installed devices. Browser layout review does not prove these. |
| Store/distribution setup | Owner-approved identifiers, Expo project, signing custody, Apple/Google accounts, app icon/branding, privacy disclosures, legal URLs, store listings and internal device review are still required. No account/store IDs or release assets were invented. |

Record device model, OS, binary/build identifier, synthetic test account, matching API/Clerk environment and actual outcomes when completing acceptance. Never record raw tokens, credentials or patient information.

## Local website-association preparation

The local-only CLI `scripts/generate-mobile-associations.mjs` prepares `apple-app-site-association` and `assetlinks.json` from owner-supplied real metadata. It never registers apps, reads signing private keys, configures accounts, contacts a domain or publishes files. There are no deployable default identifiers, Team IDs, fingerprints or hosts.

Supply the registered IDs and signing-certificate fingerprints for the same mobile variant and owned hostname used by the native configuration:

| Environment variable | Required owner-supplied value | Equivalent CLI flag |
| --- | --- | --- |
| `MOBILE_APPLE_TEAM_ID` | Real 10-character Apple Developer Team ID | `--team-id` |
| `MOBILE_IOS_BUNDLE_ID` | Registered iOS bundle ID | `--bundle-id` |
| `MOBILE_ANDROID_PACKAGE` | Registered Android package ID | `--package-id` |
| `MOBILE_LINK_HOST` | Owned public hostname without scheme/path/port/wildcard | `--link-host` |
| `MOBILE_ANDROID_CERT_SHA256` | Comma-separated actual signing-certificate SHA-256 fingerprints | Repeat `--fingerprint` for each certificate |

Fingerprints are public certificate metadata, not private keys. Include each real certificate needed for current distribution and signing-key rotations; values normalize to uppercase colon-separated bytes and duplicates are removed. Do not insert illustrative test values into deployable output. Structural validation does not prove registration, certificate ownership or domain ownership.

With the owner values already supplied in the environment, validate without any output reads or writes:

```sh
node scripts/generate-mobile-associations.mjs --check
```

Stage the two documents locally for review:

```sh
node scripts/generate-mobile-associations.mjs --output-dir /private/tmp/careiq-owner-associations
```

After review, the same command without `--output-dir` targets the checkout's `apps/web/public/.well-known`, independent of the calling working directory:

```sh
node scripts/generate-mobile-associations.mjs
```

Missing/partial/malformed metadata fails before creating the destination. Existing different association files are preserved before either output is written; stage a reviewed replacement in a separate directory instead of overwriting unrelated app associations. Matching generated files are idempotent. Diagnostic output never echoes supplied metadata, fingerprints or credential-shaped values. No owner metadata was supplied or written to the web public directory during this task.

AASA matches exactly `/join`, including its query parameters. The production/preview Android HTTPS intent filter now uses exact `android:path="/join"`, verified in Expo introspection and the generated native manifest; `/join-other` and descendants do not match this filter. Standard Android `assetlinks.json` delegates site/app ownership; the native intent filter restricts the invitation path. Configure website association responses on the same HTTPS host, then complete the real signing/domain and cold/warm installed-device acceptance described above. The custom authentication callback scheme is unchanged.

Verification: all 8 association tests passed, covering missing and malformed platform/domain/certificate metadata, rotations, exact AASA path, no-write validation, explicit output, idempotence, preservation of existing files and safe CLI diagnostics. Mobile's 33 tests, typecheck and lint passed after the exact-path change; isolated native prebuild/config inspection also passed. Tests generated synthetic documents only in temporary directories and removed them.

```sh
node --test scripts/tests/mobile-associations.test.mjs
```
