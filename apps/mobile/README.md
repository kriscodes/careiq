# CareIQ mobile

Expo / React Native app for iOS and Android, with an Expo web preview for local design review.

Implemented routes include email/password sign-in and sign-up, email verification, password recovery, authenticator/SMS/email verification, backup codes, required account security steps, approved owner onboarding, invitation acceptance, pending access, practice selection, assigned location selection, owner team invitations and explicit member access confirmation.

`/design-preview` is a development-only gallery of all 34 native screen layouts. It uses the same native components as the real routes and never signs in, provisions a practice, or accesses protected API data. `/` uses real Clerk sessions and server-confirmed practice access.

## Local preview

The isolated workspace preview is started with `pnpm local:start`; its native gallery is at `http://localhost:8082/design-preview`. See [local review](../../docs/local-review.md) for the API, web, and mobile ports.

For a standalone preview, use the repository’s supported Node runtime and install workspace dependencies first. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the existing Clerk publishable test key and `EXPO_PUBLIC_API_URL` to the local API origin. These are build-time public variables; never use a Clerk secret key in mobile.

```sh
EXPO_PUBLIC_API_URL=http://localhost:3100 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_TEST_KEY pnpm --filter @careiq/mobile exec expo start --web --host localhost --port 8082
```

Open `http://localhost:8082/design-preview` for layout review. Browser preview is not native device acceptance. Native authenticated API requests remain subject to the server’s separately configured native-client gate, which stays off by default.

For a simulator/device development build, use `pnpm mobile:ios` or `pnpm mobile:android` with the appropriate local Xcode/Android toolchain. Generated native directories are ignored; keep durable changes in app configuration/plugins. `dev.careiq.mobile` and `careiq-dev` are provisional local identifiers. This implementation does not register store IDs, configure signing, or publish a native build.

## Access and data handling

Clerk’s secure token cache stores identity credentials using Expo SecureStore. App API/query data stays in memory with no persistence. Background transitions cancel requests, clear query data and the selected location, and unmount protected screens; foreground entry requires a fresh Clerk token and API access check. Server-saved onboarding drafts remain available after that check. Query data is cleared when the account, session, practice, or selected location changes. Outstanding responses are cancelled or discarded across those context changes. The API is the authorization authority; creating a practice or accepting an invitation grants no implicit clinical location access.

Onboarding drafts are saved through the account-scoped draft API. Submission captures an immutable payload and UUID retry key in memory. Cross-device retries use the server’s frozen submitted draft; the server reconciles the single operation for that founder and rejects changed details.

## Verification

Run `pnpm --filter @careiq/mobile typecheck`, `lint`, and `test`. Export JavaScript bundles with `pnpm --filter @careiq/mobile build`. Neither Expo web nor a successful bundle export validates native keyboard, device safe area, Android hardware back, deep-link handling, biometric, SecureStore, or live Clerk/MFA behavior. Complete that acceptance on both an iOS and an Android development build before enabling native production access.

See the [mobile production-readiness record](../../docs/mobile-production-readiness.md) for enforced build variants, HTTPS configuration, verification evidence and remaining installed-device/store gates.
