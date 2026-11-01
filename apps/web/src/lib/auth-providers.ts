import { safeDestination } from "./access-flow";
import { sessionTaskDestination } from "./auth-intent";

/** Match each entry to a social connection enabled in this deployment's Clerk instance. */
export const AUTH_PROVIDERS = {
  google: { strategy: "oauth_google", label: "access.auth.continueWithGoogle", icon: "google-g.png" },
  microsoft: { strategy: "oauth_microsoft", label: "access.auth.continueWithMicrosoft", icon: "microsoft-symbol.svg" },
  apple: { strategy: "oauth_apple", label: "access.auth.continueWithApple", icon: "apple-mark-black.svg" },
} as const;
export type AuthProvider = keyof typeof AUTH_PROVIDERS;

/** Explicit deployment configuration only; an absent or unrecognized entry enables nothing. */
export function configuredAuthProviders(value: string | undefined): AuthProvider[] {
  return [...new Set((value || "").split(",").map(item => item.trim().toLowerCase()))]
    .filter((item): item is AuthProvider => Object.hasOwn(AUTH_PROVIDERS, item));
}

/** Reuse Clerk's existing hash callback and guard required account tasks before returning. */
export function authProviderRedirects(mode: "signin" | "signup", returnTo: string) {
  const destination = safeDestination(returnTo);
  const route = mode === "signup" ? "/sign-up" : "/sign-in";
  return {
    redirectUrl: sessionTaskDestination(destination),
    redirectCallbackUrl: `${route}?returnTo=${encodeURIComponent(destination)}#/sso-callback`,
  };
}
