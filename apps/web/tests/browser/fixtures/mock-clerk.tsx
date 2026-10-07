import { useSyncExternalStore } from "react";
type Call = { name: string; input?: unknown };
declare global { interface Window { __careiqMockCalls: Call[]; __careiqLastActivation?: { organization: string; navigate?: (input: { session: { currentTask: null }; decorateUrl: (url: string) => string }) => void }; } }
const scenario = new URLSearchParams(location.search).get("scenario") || "normal";
let version = 0;
let organization = "org_test";
const listeners = new Set<() => void>();
function useObserve() { useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => version); }
function changed() { version++; listeners.forEach(callback => callback()); }
const call = (name: string, input?: unknown) => { window.__careiqMockCalls ||= []; window.__careiqMockCalls.push({ name, input }); };
const ok = async () => ({ error: null });
const token = async (input?: unknown) => { call("getToken", input); if (scenario === "token-error") throw new Error("private provider secret trace"); return "synthetic-browser-test-token"; };
const setActive = async (input: { organization: string; navigate?: (input: { session: { currentTask: null }; decorateUrl: (url: string) => string }) => void }) => { call("setActive", { organization: input.organization, hasNavigate: !!input.navigate }); window.__careiqLastActivation = input; organization = input.organization; changed(); };
let signOutAttempts = 0;
const signOut = async (input: unknown) => { call("signOut", input); signOutAttempts++; if (scenario === "signed-expired" && signOutAttempts === 1) throw new Error("provider secret trace"); };
const signIn = {
  id: "", status: "needs_identifier", identifier: "", supportedSecondFactors: [{ strategy: "totp" }, { strategy: "backup_code" }], firstFactorVerification: { strategy: "" },
  password: async (input: { emailAddress: string; password: string }) => {
    call("password", { email: input.emailAddress });
    if (scenario === "signin-error") return { error: { errors: [{ code: "form_password_incorrect", message: "provider secret" }] } };
    signIn.id = "sign_in_test"; signIn.identifier = input.emailAddress; signIn.status = scenario === "mfa" ? "needs_second_factor" : "complete"; return { error: null };
  },
  create: async (input: { identifier: string }) => { call("recoveryCreate", { email: input.identifier }); signIn.identifier = input.identifier; if (scenario === "unknown-account") return { error: { code: "form_identifier_not_found" } }; if (scenario === "recovery-offline") return { error: { code: "network_error", message: "provider secret" } }; signIn.id = "sign_in_test"; return { error: null }; },
  finalize: async () => { call("signInFinalize"); return { error: null }; },
  resetPasswordEmailCode: {
    sendCode: async () => { call("sendResetCode"); signIn.firstFactorVerification.strategy = "reset_password_email_code"; return { error: null }; },
    verifyCode: async ({ code }: { code: string }) => { call("verifyResetCode"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signIn.status = "needs_new_password"; return { error: null }; },
    submitPassword: async ({ signOutOfOtherSessions }: { password: string; signOutOfOtherSessions: boolean }) => { call("submitNewPassword", { signOutOfOtherSessions }); signIn.status = "complete"; return { error: null }; },
  },
  mfa: {
    sendPhoneCode: ok, sendEmailCode: ok,
    verifyTOTP: async ({ code }: { code: string }) => { call("verifyTOTP"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signIn.status = "complete"; return { error: null }; },
    verifyPhoneCode: ok, verifyEmailCode: ok,
    verifyBackupCode: async () => { call("verifyBackupCode"); signIn.status = "complete"; return { error: null }; },
  }, emailCode: { sendCode: ok, verifyCode: ok },
};
const signUp = {
  id: "", status: "missing_requirements", emailAddress: "", requiredFields: ["email_address", "password"], optionalFields: ["first_name", "last_name"], unverifiedFields: ["email_address"],
  password: async (input: { emailAddress: string; password: string }) => { call("createAccount", { email: input.emailAddress }); signUp.id = "sign_up_test"; signUp.emailAddress = input.emailAddress; return { error: null }; },
  update: async (input: unknown) => { call("updateName", input); return { error: null }; },
  reset: async () => { call("resetSignup"); signUp.id = ""; signUp.emailAddress = ""; return { error: null }; },
  finalize: async () => { call("signUpFinalize"); return { error: null }; },
  verifications: { sendEmailCode: async () => { call("sendVerificationCode"); return { error: null }; }, verifyEmailCode: async ({ code }: { code: string }) => { call("verifyEmail"); if (code !== "111111") return { error: { code: "form_code_incorrect" } }; signUp.unverifiedFields = []; signUp.status = "complete"; return { error: null }; } },
};
const email = { emailAddress: "owner@example.invalid", verification: { status: "verified" }, prepareVerification: ok, attemptVerification: ok };
const user = { id: "user_test", fullName: "Test owner", primaryEmailAddress: email, emailAddresses: [email], reload: ok };
const memberships = { data: [{ id: "member_test", role: "org:admin", organization: { id: "org_test", name: "Test practice" } }], isLoading: false, error: null, hasNextPage: false, fetchNext: () => {}, revalidate: ok };
const invitations = { data: [{ id: "invite_test", emailAddress: scenario === "wrong-invite-email" ? "teammate@example.invalid" : email.emailAddress, publicOrganizationData: { id: "org_team", name: "Invited team" }, accept: async () => { call("acceptInvitation"); } }], isLoading: false, error: null, hasNextPage: false, fetchNext: () => {}, revalidate: ok };
export function useAuth() { useObserve(); return { isLoaded: true, isSignedIn: !["normal", "signin-error", "mfa", "unknown-account", "recovery-offline"].includes(scenario) || new URLSearchParams(location.search).get("component") !== "auth", getToken: token, userId: user.id, orgId: organization }; }
export function useClerk() { return { signOut }; }
export function useSignIn() { return { signIn, fetchStatus: "idle" }; }
export function useSignUp() { return { signUp, fetchStatus: "idle" }; }
export function useUser() { useObserve(); return { user, isLoaded: true }; }
export function useSession() { useObserve(); return { isLoaded: true, session: { currentTask: null } }; }
export function useOrganizationList() { useObserve(); return { isLoaded: true, setActive, userMemberships: memberships, userInvitations: invitations }; }
export function UserButton() { return <button type="button">Test account</button>; }
export function SignIn() { return <p>Provider completion fixture</p>; }
export function SignUp() { return <p>Provider signup fixture</p>; }
export function TaskResetPassword() { return <p>Required password task fixture</p>; }
export function TaskSetupMFA() { return <p>Required MFA task fixture</p>; }
export function TaskChooseOrganization() { return <p>Required organization task fixture</p>; }
