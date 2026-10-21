import { useSyncExternalStore, type ReactNode } from "react";
type Call = { name: string; input?: unknown };
declare global { interface Window { __careiqLocaleAccount?: { load: () => void; resolveNext: () => void; snapshot: () => { loaded: boolean; active: number; maximumActive: number; writes: string[]; storedLocale: string | undefined } }; __careiqAuthFetch?: { set: (source: "signin" | "signup", status: "idle" | "fetching") => void; resolvePassword: () => void; resolveProvider: () => void }; __careiqMockCalls: Call[]; __careiqLastActivation?: { organization: string; navigate?: (input: { session: { currentTask: null }; decorateUrl: (url: string) => string }) => void }; } }
const scenario = new URLSearchParams(location.search).get("scenario") || "normal";
let version = 0;
let organization: string | null = scenario === "no-active-organization" ? null : "org_test";
const listeners = new Set<() => void>();
function useObserve() { useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => version); }
function changed() { version++; listeners.forEach(callback => callback()); }
const call = (name: string, input?: unknown) => { window.__careiqMockCalls ||= []; window.__careiqMockCalls.push({ name, input }); };
const ok = async () => ({ error: null });
const token = async (input?: unknown) => {
  call("getToken", input);
  if (scenario === "token-error") throw new Error("private provider secret trace");
  if (scenario === "workflow-token-refresh") {
    // The real SDK keeps getToken stable but emits updated resources during token refresh.
    await new Promise(resolve => setTimeout(resolve, 0));
    changed();
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return "synthetic-browser-test-token";
};
const setActive = async (input: { organization: string; navigate?: (input: { session: { currentTask: null }; decorateUrl: (url: string) => string }) => void }) => { call("setActive", { organization: input.organization, hasNavigate: !!input.navigate }); window.__careiqLastActivation = input; organization = input.organization; changed(); };
let signOutAttempts = 0;
let mfaSendAttempts = 0;
const signOut = async (input: unknown) => { call("signOut", input); signOutAttempts++; if (scenario === "signed-expired" && signOutAttempts === 1) throw new Error("provider secret trace"); };
let signInFetchStatus = "idle";
let signUpFetchStatus = "idle";
let resolvePassword: (() => void) | undefined;
let resolveProvider: (() => void) | undefined;
window.__careiqAuthFetch = {
  set: (source, status) => { if (source === "signin") signInFetchStatus = status; else signUpFetchStatus = status; changed(); },
  resolvePassword: () => { resolvePassword?.(); resolvePassword = undefined; },
  resolveProvider: () => { resolveProvider?.(); resolveProvider = undefined; },
};
async function providerAttempt(source: "signin" | "signup", input: unknown) {
  call("providerSSO", { source, ...(input as Record<string, unknown>) });
  if (scenario === "auth-provider-pending") await new Promise<void>(resolve => { resolveProvider = resolve; });
  if (scenario === "auth-provider-error") return { error: { code: "network_error", message: "private provider secret" } };
  return { error: null };
}
const signIn = {
  sso: (input: unknown) => providerAttempt("signin", input),
  id: "", status: "needs_identifier", identifier: "", supportedSecondFactors: [{ strategy: "totp" }, { strategy: "backup_code" }], firstFactorVerification: { strategy: "" }, secondFactorVerification: { strategy: null as string | null, status: null as string | null },
  password: async (input: { emailAddress: string; password: string }) => {
    call("password", { email: input.emailAddress });
    if (scenario === "auth-deferred") await new Promise<void>(resolve => { resolvePassword = resolve; });
    if (scenario === "signin-error") return { error: { errors: [{ code: "form_password_incorrect", message: "provider secret" }] } };
    signIn.id = "sign_in_test"; signIn.identifier = input.emailAddress; signIn.status = scenario.startsWith("auth-trust") ? "needs_client_trust" : scenario === "mfa" ? "needs_second_factor" : "complete"; return { error: null };
  },
  create: async (input: { identifier: string }) => { call("recoveryCreate", { email: input.identifier }); signIn.identifier = input.identifier; if (scenario === "unknown-account") return { error: { code: "form_identifier_not_found" } }; if (scenario === "recovery-offline") return { error: { code: "network_error", message: "provider secret" } }; signIn.id = "sign_in_test"; return { error: null }; },
  finalize: async () => { call("signInFinalize"); return { error: null }; },
  resetPasswordEmailCode: {
    sendCode: async () => { call("sendResetCode"); signIn.firstFactorVerification.strategy = "reset_password_email_code"; return { error: null }; },
    verifyCode: async ({ code }: { code: string }) => { call("verifyResetCode"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signIn.status = "needs_new_password"; return { error: null }; },
    submitPassword: async ({ signOutOfOtherSessions }: { password: string; signOutOfOtherSessions: boolean }) => { call("submitNewPassword", { signOutOfOtherSessions }); signIn.status = "complete"; return { error: null }; },
  },
  mfa: {
    sendPhoneCode: async () => sendMFACode("phone_code"), sendEmailCode: async () => sendMFACode("email_code"),
    verifyTOTP: async ({ code }: { code: string }) => { call("verifyTOTP"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signIn.status = "complete"; return { error: null }; },
    verifyPhoneCode: async (input: { code: string }) => verifyMFACode("phone_code", input), verifyEmailCode: async (input: { code: string }) => verifyMFACode("email_code", input),
    verifyBackupCode: async () => { call("verifyBackupCode"); signIn.status = "complete"; return { error: null }; },
  }, emailCode: { sendCode: ok, verifyCode: ok },
};
async function sendMFACode(strategy: "phone_code" | "email_code") {
  call(strategy === "email_code" ? "sendMFAEmailCode" : "sendMFAPhoneCode");
  mfaSendAttempts++;
  if (scenario === "auth-trust-send-error" && mfaSendAttempts === 1) return { error: { code: "network_error", message: "private provider secret" } };
  if (scenario === "auth-trust-rate-limit") return { error: { code: "verification_code_rate_limit_exceeded", message: "private provider secret", status: 429 } };
  signIn.secondFactorVerification = { strategy, status: "unverified" };
  return { error: null };
}
async function verifyMFACode(strategy: "phone_code" | "email_code", { code }: { code: string }) {
  call(strategy === "email_code" ? "verifyMFAEmailCode" : "verifyMFAPhoneCode");
  if (signIn.secondFactorVerification.strategy !== strategy || signIn.secondFactorVerification.status !== "unverified" || code !== "111111") return { error: { code: "form_code_incorrect" } };
  signIn.secondFactorVerification.status = "verified";
  signIn.status = "complete";
  return { error: null };
}
if (scenario.startsWith("auth-trust")) {
  signIn.supportedSecondFactors = [{ strategy: scenario === "auth-trust-unsupported" ? "email_link" : scenario === "auth-trust-phone" ? "phone_code" : scenario === "auth-trust-backup" ? "backup_code" : "email_code" }];
  if (scenario.includes("restored")) {
    signIn.id = "restored_trust_test"; signIn.identifier = "synthetic@example.invalid"; signIn.status = "needs_client_trust";
    if (scenario === "auth-trust-restored-prepared") {
      signIn.supportedSecondFactors.unshift({ strategy: "totp" });
      signIn.secondFactorVerification = { strategy: "email_code", status: "unverified" };
    }
  }
}
if (scenario === "auth-restored-mfa") { signIn.id = "restored_sign_in_test"; signIn.identifier = "synthetic@example.invalid"; signIn.status = "needs_second_factor"; }
const signUp = {
  sso: (input: unknown) => providerAttempt("signup", input),
  id: "", status: "missing_requirements", emailAddress: "", requiredFields: ["email_address", "password"], optionalFields: ["first_name", "last_name"], unverifiedFields: ["email_address"],
  password: async (input: { emailAddress: string; password: string }) => { call("createAccount", { email: input.emailAddress }); signUp.id = "sign_up_test"; signUp.emailAddress = input.emailAddress; return { error: null }; },
  update: async (input: unknown) => { call("updateName", input); return { error: null }; },
  reset: async () => { call("resetSignup"); signUp.id = ""; signUp.emailAddress = ""; return { error: null }; },
  finalize: async () => { call("signUpFinalize"); return { error: null }; },
  verifications: { sendEmailCode: async () => { call("sendVerificationCode"); return { error: null }; }, verifyEmailCode: async ({ code }: { code: string }) => { call("verifyEmail"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signUp.unverifiedFields = []; signUp.status = "complete"; return { error: null }; } },
};
if (scenario === "auth-restored-signup") { signUp.id = "restored_sign_up_test"; signUp.emailAddress = "synthetic@example.invalid"; }
const email = { emailAddress: "owner@example.invalid", verification: { status: "verified" }, prepareVerification: ok, attemptVerification: ok };
let localeAccountLoaded = !(scenario === "locale-account" && new URLSearchParams(location.search).get("account") === "late");
const localeWrites: string[] = [];
const pendingLocaleWrites: Array<{ metadata: Record<string, unknown>; resolve: () => void }> = [];
let activeLocaleWrites = 0;
let maximumLocaleWrites = 0;
function updateLocaleAccount(input: { unsafeMetadata: Record<string, unknown> }) {
  if (scenario !== "locale-account") return Promise.resolve();
  localeWrites.push(String(input.unsafeMetadata.careiqLocale));
  call("localeAccountUpdate", input);
  activeLocaleWrites++;
  maximumLocaleWrites = Math.max(maximumLocaleWrites, activeLocaleWrites);
  return new Promise<void>(resolve => pendingLocaleWrites.push({ metadata: input.unsafeMetadata, resolve }));
}
let user = { id: "user_test", fullName: "Test owner", primaryEmailAddress: email, emailAddresses: [email], reload: ok, unsafeMetadata: { careiqLocale: "en" } as Record<string, unknown>, update: updateLocaleAccount };
if (scenario === "locale-account") window.__careiqLocaleAccount = {
  load: () => { localeAccountLoaded = true; changed(); },
  resolveNext: () => {
    const pending = pendingLocaleWrites.shift();
    if (!pending) throw new Error("No deferred locale save to resolve.");
    user = { ...user, unsafeMetadata: { ...pending.metadata } };
    activeLocaleWrites--;
    changed();
    pending.resolve();
  },
  snapshot: () => ({ loaded: localeAccountLoaded, active: activeLocaleWrites, maximumActive: maximumLocaleWrites, writes: [...localeWrites], storedLocale: typeof user.unsafeMetadata.careiqLocale === "string" ? user.unsafeMetadata.careiqLocale : undefined }),
};
const identityRole = new URLSearchParams(location.search).get("identityRole");
const membershipRole = identityRole === "member" ? "org:member" : identityRole === "configured-clinician" ? "org:clinician" : "org:admin";
const memberships = { data: [{ id: "member_test", role: membershipRole, organization: { id: "org_test", name: "Test practice" } }], isLoading: false, error: null, hasNextPage: false, fetchNext: () => {}, revalidate: ok };
const invitations = { data: [{ id: "invite_test", emailAddress: scenario === "wrong-invite-email" ? "teammate@example.invalid" : email.emailAddress, publicOrganizationData: { id: "org_team", name: "Invited team" }, accept: async () => { call("acceptInvitation"); } }], isLoading: false, error: null, hasNextPage: false, fetchNext: () => {}, revalidate: ok };
export function useAuth() { useObserve(); return { isLoaded: true, isSignedIn: !scenario.startsWith("auth-provider-") && !scenario.startsWith("auth-trust") && !["normal", "signin-error", "mfa", "unknown-account", "recovery-offline", "auth-noise", "auth-deferred", "auth-restored-mfa", "auth-restored-signup", "auth-loading", "auth-failed"].includes(scenario) || new URLSearchParams(location.search).get("component") !== "auth", getToken: token, userId: user.id, orgId: organization }; }
export function useClerk() { return { signOut }; }
export function useSignIn() { useObserve(); return { signIn, fetchStatus: signInFetchStatus }; }
export function useSignUp() { useObserve(); return { signUp, fetchStatus: signUpFetchStatus }; }
export function useUser() { useObserve(); return { user: localeAccountLoaded ? user : null, isLoaded: localeAccountLoaded }; }
export function useSession() { useObserve(); return { isLoaded: true, session: { currentTask: null } }; }
export function useOrganizationList() { useObserve(); return { isLoaded: true, setActive, userMemberships: memberships, userInvitations: invitations }; }
export function UserButton() { return <button type="button">Test account</button>; }
export function SignIn() { return <p>Provider completion fixture</p>; }
export function SignUp() { return <p>Provider signup fixture</p>; }
export function TaskResetPassword() { return <p>Required password task fixture</p>; }
export function TaskSetupMFA() { return <p>Required MFA task fixture</p>; }
export function TaskChooseOrganization() { return <p>Required organization task fixture</p>; }

export function useReverification<Args extends unknown[], Result>(fetcher: (...args: Args) => Promise<Result>) { return async (...args: Args) => { const result = await fetcher(...args); if (result && typeof result === "object" && "clerk_error" in result) { call("reverify"); if (scenario === "reverification-cancel") throw Object.assign(new Error("Synthetic cancellation"), { code:"reverification_cancelled" }); return fetcher(...args); } return result; }; }

export function ClerkLoaded({ children }: { children: ReactNode }) { return ["auth-loading", "auth-failed"].includes(scenario) ? null : <>{children}</>; }
export function ClerkLoading({ children }: { children: ReactNode }) { return scenario === "auth-loading" ? <>{children}</> : null; }
export function ClerkFailed({ children }: { children: ReactNode }) { return scenario === "auth-failed" ? <>{children}</> : null; }
