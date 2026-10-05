# CareIQ mobile

Expo / React Native foundation for iOS and Android. Review the [architecture proposal](../../docs/design/mobile-architecture.md), then follow the [development guide](../../docs/mobile-development.md).

The app opens without credentials. It has a foundation route and a setup route, an optional Clerk provider with secure token cache, and a manual public API health check. Authentication flows, practice/location access and clinical workflows are not implemented.

From the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm mobile:ios       # local iOS build; requires Xcode
# or pnpm mobile:android
pnpm mobile           # start Metro for the installed development build
pnpm mobile:check
pnpm mobile:doctor
pnpm mobile:export    # JS bundles for both platforms; not native binaries
```

Generated native directories are ignored. After changing native dependencies or app configuration/plugins, regenerate with `pnpm --filter @careiq/mobile exec expo prebuild --clean`, then rebuild. This replaces generated directories; keep durable edits in configuration/plugins. `dev.careiq.mobile` and `careiq-dev` are provisional local identifiers; review/register environment-specific identifiers before distribution. EAS profiles are templates; no Expo project, signing or store setup is supplied.
