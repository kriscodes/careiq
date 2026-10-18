# Mobile development

> October18,2026: native mobile source is no longer active in this checkout. A verified private handoff is preserved for a separate repository to be created later. Mobile commands/results below describe the earlier combined workspace; standalone setup and acceptance remain future work. See [separation and recovery](mobile-separation.md).

`apps/mobile` is the `@careiq/mobile` iOS/Android application. It uses Expo SDK 57, React Native 0.86.3, React 19.2.3 and Expo Router. Review the [mobile architecture proposal](design/mobile-architecture.md) before extending the scaffold. The practice/location model is specified in [ADR-017](decisions/017-practice-location-membership-model.md); the current authentication/onboarding implementation follows that access model. See [authentication and onboarding](auth-onboarding.md) for the implemented API and UI flows.

The installed Clerk native module requires **iOS 17 or later**. Its Expo plugin sets the deployment target and Android packaging settings; Apple sign-in capability is explicitly disabled until an authentication flow is selected. Expo SDK 57 requires Xcode 26.4 or later for local iOS builds.

The current app implements branded sign-in, sign-up, email verification, password reset, MFA/session requirements, protected practice/location selection, invitation/access states and server-saved three-step onboarding. API requests obtain fresh bearer tokens and clear/cancel in-memory scope state during identity, practice or location transitions. Clinical records are not persisted offline.

The dedicated `/design-preview` screen is a synthetic visual gallery. It works without authentication and does not send invitations or create practices. `pnpm local:start` exposes its browser preview; see [local review](local-review.md). Native builds and installed-device acceptance remain separate from a browser preview or JavaScript export. The API's native bearer policy defaults off until actual device/session behavior is verified.

## Requirements

- Use Node.js 22.23.2 to match the repository's CI baseline; the scaffold also supports Node.js 24. Keep pnpm at **11.22.0**, as declared in the root `package.json`.
- For local iOS builds, use macOS with full Xcode, its command-line tools, an installed iOS Simulator runtime and CocoaPods (Expo Doctor recommends 1.15.2 or later). Follow [Expo's Xcode setup](https://docs.expo.dev/workflow/ios-simulator/).
- For local Android builds, install Android Studio, its supported JDK/Android SDK and an emulator, or connect an Android device with USB debugging enabled. Follow [Expo's Android setup](https://docs.expo.dev/workflow/android-studio-emulator/).
- API development needs the database and Clerk configuration documented in [development](development.md). Neither is required to open the unconfigured shell.

Run commands from the repository root unless a section explicitly changes directory. Install once at the root; the workspace uses one pnpm lockfile.

```bash
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env.local
```

Leave both values empty to review the setup and visual preview screens. Use synthetic data when connecting development services.

## Public configuration

| Variable | Purpose | Required for |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | API origin only, without a path, query, fragment or embedded credentials | Health checks and authenticated API workflows |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Valid `pk_test_` or `pk_live_` publishable key from the matching Clerk environment | Clerk authentication and sessions |

Use the same Clerk application as the matching API environment. Copy an actual publishable key rather than a truncated example. A malformed value should be corrected in the local environment file before using that integration.

`EXPO_PUBLIC_*` values are embedded in the client bundle and are readable by anyone with the app. Never put a Clerk secret key, database URL, signing credential or service secret in them. Reload the app after configuration changes; a distributed app requires a new bundle/build with its intended public values. See [Expo's environment-variable guide](https://docs.expo.dev/guides/environment-variables/).

Use HTTPS for hosted APIs. The development configuration permits HTTP for localhost, loopback and private IP addresses, but permission in the configuration validator does not override iOS or Android transport policy. Prefer a trusted HTTPS development endpoint or tunnel. The distributed preview/production variants explicitly disable iOS arbitrary traffic and Android cleartext traffic; development retains Metro connectivity. See the [mobile production-readiness record](mobile-production-readiness.md) for generated-manifest evidence and the required release metadata.

## Build and run locally

Create the native development client on the selected platform:

```bash
pnpm mobile:ios
```

or:

```bash
pnpm mobile:android
```

These commands generate native projects when necessary, compile and install the app, and start Metro. For later JavaScript/TypeScript changes, start Metro with the installed development client:

```bash
pnpm mobile
```

Select iOS or Android in the terminal. To choose a connected device explicitly:

```bash
pnpm --filter @careiq/mobile exec expo run:ios --device
pnpm --filter @careiq/mobile exec expo run:android --device
```

The development client is the supported baseline. Rebuild after changing native dependencies, plugins or native app configuration. `apps/mobile/ios` and `apps/mobile/android` are generated and ignored by Git; durable configuration belongs in the Expo app configuration or config plugins. Avoid hand-editing generated files that will be replaced. See [Expo's local development-build guide](https://docs.expo.dev/guides/local-app-development/).

When generated native directories already exist, regenerate them before rebuilding after a native/configuration change:

```bash
pnpm --filter @careiq/mobile exec expo prebuild --clean
pnpm mobile:ios  # or pnpm mobile:android
```

`--clean` replaces generated native directories. Keep durable changes in configuration/plugins first; running `expo run:*` alone can reuse stale generated settings.

### Reach the API from a device

Run the API separately:

```bash
pnpm --filter ./apps/api dev
```

The API listens on port 3000. Set the mobile API origin according to the device:

| Device | Local development origin | Notes |
| --- | --- | --- |
| iOS Simulator on the API host | `http://localhost:3000` | Subject to native transport policy; HTTPS remains preferred |
| Android Studio emulator | `http://10.0.2.2:3000` | Emulator alias for the host; `localhost` points to the emulator |
| Physical iOS/Android device | A trusted HTTPS development URL | A phone's `localhost` is the phone; a LAN address additionally requires routing, firewall access and permitted transport |

`10.0.2.2` is specific to the Android emulator's host mapping; see the [Android emulator networking reference](https://developer.android.com/studio/run/emulator-networking). Metro's connection and the API connection are separate. Tunneling Metro does not expose the API automatically.

Open the shell and use the health-check button. Check an invalid/unreachable origin as well as a working one. `/health` includes a database connectivity check, so a 503 can indicate a database failure even when the API process is reachable.

## Checks

```bash
pnpm mobile:check
pnpm mobile:doctor
pnpm mobile:export
```

| Command | Scope |
| --- | --- |
| `mobile:check` | Mobile TypeScript, lint and automated unit checks |
| `mobile:doctor` | Expo dependency compatibility and project diagnostics |
| `mobile:export` | Bundles iOS/Android JavaScript and assets |

`mobile:doctor` needs network access for dependency metadata and Expo diagnostics.

See the [current mobile production-readiness record](mobile-production-readiness.md) for verified checks and remaining native acceptance. The [bootstrap review](mobile-bootstrap-review.md) records historical October 4 findings; use current repository audit results for dependency status.

An export is **not an installable app binary**. Passing these checks does not establish that Xcode/Gradle compilation, device networking or native authentication works. Complete simulator/emulator and physical-device checks before enabling native production access. Record actual verification results in the change summary; this guide lists commands, not a completed test record.

After shared-package or root-workspace changes, also run the repository checks described in [development](development.md). Keep the Next.js web build and API tests passing independently of mobile.

## EAS setup and release path

`apps/mobile/eas.json` defines three profiles that select explicit build variants. Production configuration fails until the [required release metadata](mobile-production-readiness.md#build-configuration) is supplied:

| Profile | Intent |
| --- | --- |
| `development` | Internal development client with Metro |
| `preview` | Internal standalone build for device review |
| `production` | Store-oriented build with automatic build-number increments |

No Expo/EAS project, signing account, store listing or release is created by the scaffold. The initial `dev.careiq.mobile` iOS bundle identifier and Android application ID are placeholders. Decide the production identifiers and environment-specific identifiers before registering store apps or distributing builds. Separate identifiers are needed if development and production apps should coexist on a device.

When the owning Expo account and identifiers are agreed, run EAS commands from the mobile app directory:

```bash
cd apps/mobile
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest build:configure
```

Review generated changes, including the EAS project ID, owner and existing build profiles. Set public configuration in the matching EAS development, preview and production environments. Keep backend secrets out of all mobile bundles. Commit the reviewed project configuration; keep credentials in the chosen protected credential service.

To create an internal development build after that setup:

```bash
pnpm dlx eas-cli@latest build --profile development --platform android
pnpm dlx eas-cli@latest build --profile development --platform ios
```

iOS device distribution needs appropriate signing/provisioning and registered devices; an iOS Simulator artifact needs a separate profile with `ios.simulator: true`. Store distribution needs the relevant Apple/Google developer accounts. See [Expo's build setup](https://docs.expo.dev/build/setup/) and [internal distribution guide](https://docs.expo.dev/build/internal-distribution/).

Before a production build, confirm store ownership, signing custody, identifiers, app branding, privacy disclosures, public environment values and the reviewed release checklist. Use internal distribution/TestFlight/Play testing before a store release. EAS Update is not enabled by this scaffold; introduce update channels, runtime compatibility, rollback and environment controls as a separate reviewed change. Existing web/API hosting remains independent of mobile distribution, consistent with ADR-015.

## Installed-device acceptance before release

1. Review the [mobile architecture](design/mobile-architecture.md) and ADR-017, including practice-wide versus location-scoped permissions and invitation assignment timing.
2. Verify the implemented native Clerk sign-in/session flow on installed devices. Browser authorized parties remain derived from exact web `CORS_ORIGINS`; the separately gated native policy is documented in [authentication and onboarding](auth-onboarding.md). Verify actual native token `azp` behavior before enabling that gate. Do not remove existing verification or treat CORS as native authorization.
3. Validate the implemented membership/location API contract and server-side authorization with synthetic users before exposing location-scoped records. Selecting a location on a device does not grant access.
4. Configure invitation handoff, authentication callbacks, iOS Universal Links and Android App Links with owned domains and tested cold/warm app behavior. A custom URL scheme alone does not establish invitation security.
5. Exercise sign-out, session expiry, account/practice/location switching, app backgrounding and rejected access on both platforms. Verify token-cache cleanup and clear any in-memory data for the previous context.
6. Complete installed-device flow coverage, accessibility and physical-device checks for the implemented screens. Do not persist clinical data or enable offline mutations until their storage, synchronization and revocation behavior is designed.

The [architecture proposal](design/mobile-architecture.md) is the source of truth for app boundaries, sharing with Next.js, navigation, data fetching, secure storage and implementation sequencing.
