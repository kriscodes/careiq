"use client";

import Link from "next/link";
import { SignIn, SignUp, useAuth, useSignIn, useSignUp } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { safeDestination, signInStep, type AuthStep } from "@/lib/access-flow";
import { invitationContinuationUrl, rememberAuthDestination, sessionTaskDestination } from "@/lib/auth-intent";
import { AccessActionError, authErrorMessage, isUnknownAccountError } from "@/lib/auth-errors";
import { SignOutButton } from "./SignOutButton";
import { AccessError, AccessField, AccessHeading, AccessPassword, AccessShell, AccessStatus } from "./AccessShell";

type Mode = AuthStep | "resetdone";
type MFA = "totp" | "phone_code" | "email_code" | "backup_code";
type Result = { error: unknown | null };

function check(result: Result) { if (result.error) throw result.error; }

export function AuthScreen({ initialMode = "signin", returnTo, invitation = false, invitationComplete = false, expired = false }: { initialMode?: "signin" | "signup" | "forgot"; returnTo?: string; invitation?: boolean; invitationComplete?: boolean; expired?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn, fetchStatus: signInFetch } = useSignIn();
  const { signUp, fetchStatus: signUpFetch } = useSignUp();
  const [mode, setMode] = useState<Mode>(invitation ? "provider" : initialMode);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [mfa, setMfa] = useState<MFA>("totp");
  const locked = useRef(false);
  const restored = useRef(false);
  const alive = useRef(true);
  const destination = safeDestination(returnTo || (invitation ? "/join?accepted=1" : "/"));
  const signupFlow = initialMode === "signup";

  useEffect(() => { if (mode === "provider") rememberAuthDestination(destination); }, [mode, destination]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => { if (isLoaded && isSignedIn && !expired && (!invitation || invitationComplete)) window.location.replace(destination); }, [isLoaded, isSignedIn, destination, expired, invitation, invitationComplete]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || invitation || restored.current) return;
    restored.current = true;
    // Restore only the provider attempt. Credentials and codes are never persisted by CareIQ.
    void Promise.resolve().then(() => {
      if (!alive.current) return;
      if (signupFlow && signUp.id && signUp.status !== "complete") {
        setEmail(signUp.emailAddress || "");
        setMode(signUp.unverifiedFields.includes("email_address") ? "verify" : "provider");
      } else if (!signupFlow && signIn.id && signIn.status !== "needs_identifier") {
        setEmail(signIn.identifier || "");
        if (signIn.status === "needs_new_password") setMode("reset");
        else if (signIn.firstFactorVerification.strategy === "reset_password_email_code" && signIn.status === "needs_first_factor") setMode("resetcode");
        else if (["needs_second_factor", "needs_client_trust", "needs_protect_check", "complete"].includes(signIn.status)) setMode("provider");
      }
    });
  }, [isLoaded, isSignedIn, invitation, signupFlow, signIn, signUp]);

  const switchMode = (next: Mode) => { setError(""); setMessage(""); setMode(next); };
  async function run(action: () => Promise<void>) {
    if (locked.current || !isLoaded) return;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) { if (alive.current) setError(authErrorMessage(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function finish(source: "signin" | "signup") {
    check(await (source === "signin" ? signIn : signUp).finalize({ navigate: ({ session, decorateUrl }) => {
      window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination(destination) : destination));
    } }));
  }
  async function advanceSignIn() {
    const next = signInStep(signIn.status, signIn.supportedSecondFactors);
    if (next === "complete") return finish("signin");
    if (next === "mfa") {
      const supported = signIn.supportedSecondFactors.map(f => f.strategy);
      const chosen: MFA = supported.includes("totp") ? "totp" : supported.includes("phone_code") ? "phone_code" : supported.includes("email_code") ? "email_code" : "backup_code";
      setMfa(chosen);
      if (chosen === "phone_code") check(await signIn.mfa.sendPhoneCode());
      if (chosen === "email_code") check(await signIn.mfa.sendEmailCode());
    }
    if (alive.current) switchMode(next);
  }
  async function advanceSignUp() {
    if (signUp.status === "complete") return finish("signup");
    if (signUp.unverifiedFields.includes("email_address")) {
      check(await signUp.verifications.sendEmailCode());
      if (alive.current) { setCooldown(30); switchMode("verify"); }
    } else if (alive.current) switchMode("provider");
  }
  async function chooseMFA(strategy: MFA) {
    await run(async () => {
      if (strategy === "phone_code") check(await signIn.mfa.sendPhoneCode());
      if (strategy === "email_code") check(await signIn.mfa.sendEmailCode());
      setMfa(strategy); switchMode(strategy === "backup_code" ? "recovery" : "mfa");
    });
  }
  async function resend() {
    if (cooldown) return;
    await run(async () => {
      if (mode === "verify") check(await signUp.verifications.sendEmailCode());
      else if (mode === "resetcode") {
        // Keep account-existence feedback generic for password recovery.
        const result = await signIn.resetPasswordEmailCode.sendCode();
        if (result.error && !isUnknownAccountError(result.error)) throw result.error;
      } else if (mode === "firstcode") check(await signIn.emailCode.sendCode());
      else if (mfa === "email_code") check(await signIn.mfa.sendEmailCode());
      else if (mfa === "phone_code") check(await signIn.mfa.sendPhoneCode());
      setCooldown(30); setMessage(mode === "resetcode" ? "If an account exists, a new code will arrive shortly." : "A new code was sent.");
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await run(async () => {
      if (mode === "signin") {
        const identifier = String(fields.get("email")).trim(); setEmail(identifier);
        check(await signIn.password({ emailAddress: identifier, password: String(fields.get("password")) }));
        await advanceSignIn();
      } else if (mode === "signup") {
        const address = String(fields.get("email")).trim(); const fullName = String(fields.get("name") || "").trim();
        setEmail(address); setName(fullName);
        check(await signUp.password({ emailAddress: address, password: String(fields.get("password")) }));
        // Only send name attributes when this Clerk instance accepts them.
        const allowed = [...signUp.requiredFields, ...signUp.optionalFields];
        if (signUp.status !== "complete" && fullName && (allowed.includes("first_name") || allowed.includes("last_name"))) {
          const [firstName, ...rest] = fullName.split(/\s+/);
          check(await signUp.update({ ...(allowed.includes("first_name") ? { firstName } : {}), ...(allowed.includes("last_name") ? { lastName: rest.join(" ") } : {}) }));
        }
        await advanceSignUp();
      } else if (mode === "verify") {
        check(await signUp.verifications.verifyEmailCode({ code: String(fields.get("code")) })); await advanceSignUp();
      } else if (mode === "forgot") {
        const identifier = String(fields.get("email")).trim(); setEmail(identifier);
        const result = await signIn.create({ identifier });
        if (result.error && !isUnknownAccountError(result.error)) throw result.error;
        if (!result.error) {
          const sent = await signIn.resetPasswordEmailCode.sendCode();
          if (sent.error && !isUnknownAccountError(sent.error)) throw sent.error;
        }
        setCooldown(30); switchMode("resetcode");
      } else if (mode === "resetcode") {
        const result = await signIn.resetPasswordEmailCode.verifyCode({ code: String(fields.get("code")) });
        if (result.error) throw new AccessActionError("We couldn’t verify that code. Request a new one and try again.");
        if (signIn.status === "needs_new_password") switchMode("reset"); else await advanceSignIn();
      } else if (mode === "reset") {
        if (fields.get("newpassword") !== fields.get("confirm")) throw new AccessActionError("The passwords don’t match. Try again.");
        check(await signIn.resetPasswordEmailCode.submitPassword({ password: String(fields.get("newpassword")), signOutOfOtherSessions: true }));
        if (signIn.status === "complete") switchMode("resetdone"); else await advanceSignIn();
      } else if (mode === "mfa" || mode === "recovery") {
        const code = String(fields.get("code"));
        check(await (mode === "recovery" ? signIn.mfa.verifyBackupCode({ code }) : mfa === "totp" ? signIn.mfa.verifyTOTP({ code }) : mfa === "phone_code" ? signIn.mfa.verifyPhoneCode({ code }) : signIn.mfa.verifyEmailCode({ code })));
        await advanceSignIn();
      } else if (mode === "firstcode") {
        check(await signIn.emailCode.verifyCode({ code: String(fields.get("code")) })); await advanceSignIn();
      }
    });
  }

  const titles: Record<Mode, [string, string]> = {
    signin: [expired ? "Sign in again" : "Welcome back", expired ? "Your session has expired. Sign in to continue." : "Sign in to your CareIQ account."],
    signup: ["Create your account", "A little more room to care. Start with your account."],
    verify: ["Check your email", `We sent a verification code to ${email || signUp.emailAddress || "your email"}.`],
    forgot: ["Reset your password", "Enter your email and we’ll send a password reset code."],
    resetcode: ["Check your email", `If an account exists for ${email}, you’ll receive a password reset code.`],
    reset: ["Choose a new password", "Use a password you haven’t used for this account."],
    resetdone: ["Password updated", "Your other sessions have been signed out. Continue to CareIQ."],
    mfa: ["One more step", mfa === "totp" ? "Enter the code from your authenticator app." : mfa === "phone_code" ? "Enter the code sent to your phone." : "Enter the code sent to your email."],
    recovery: ["Use a recovery code", "Enter one of the recovery codes you saved when setting up two-step verification."],
    firstcode: ["Check your email", "Enter the verification code sent to your email."],
    provider: [invitation ? "Join your team" : "Continue to your account", invitation ? "Use the email address that received your practice invitation." : "Complete the remaining steps for your account."],
  };
  const loading = busy || signInFetch === "fetching" || signUpFetch === "fetching";
  if (isLoaded && isSignedIn && invitation && !invitationComplete) return <AccessShell><AccessHeading title="Join your team" mark="users">Continue with the email address that received this invitation.</AccessHeading><div className="cq-a-note">You’re already signed in. Sign out to continue with your invited account.</div><div className="cq-a-actions"><SignOutButton className="cq-a-primary" redirectUrl={() => invitationContinuationUrl(window.location.href)}>Use the invited account</SignOutButton><Link className="cq-a-link" href="/">Back to my practices</Link></div></AccessShell>;
  if (isLoaded && isSignedIn && expired) return <AccessShell><AccessHeading title="Sign in again">Your session needs to be refreshed before you can reopen CareIQ.</AccessHeading><SignOutButton className="cq-a-primary" redirectUrl="/sign-in?reason=expired">Sign in again</SignOutButton></AccessShell>;
  if (!isLoaded || isSignedIn) return <AccessShell><AccessHeading title="Opening CareIQ…" /><p role="status">One moment while we check your account.</p></AccessShell>;
  return <AccessShell>
    {!['signin', 'signup', 'provider'].includes(mode) && <button className="cq-a-link cq-a-back" type="button" disabled={loading} onClick={() => switchMode(mode === "recovery" ? "mfa" : initialMode)}>← {mode === "recovery" ? "Back to verification" : "Back"}</button>}
    <AccessHeading title={titles[mode][0]} mark={mode === "verify" || mode === "resetcode" ? "mail" : mode === "resetdone" ? "check" : undefined}>{titles[mode][1]}</AccessHeading>
    {mode === "provider" ? <>{!invitation && signupFlow ? <SignUp routing="hash" forceRedirectUrl={destination} signInUrl={`/sign-in?returnTo=${encodeURIComponent(destination)}`} /> : <SignIn routing="hash" forceRedirectUrl={destination} signUpUrl={`/sign-up?returnTo=${encodeURIComponent(destination)}`} />}{!invitation && <p className="cq-a-under"><Link href={`${signupFlow ? "/sign-in" : "/sign-up"}?returnTo=${encodeURIComponent(destination)}`} className="cq-a-link">{signupFlow ? "Already have an account? Sign in" : "Create an account"}</Link></p>}</> : mode === "resetdone" ? <button className="cq-a-primary" type="button" disabled={loading} onClick={() => void run(() => finish("signin"))}>Continue to CareIQ</button> : <form className="cq-a-form" onSubmit={submit} aria-busy={loading}>
      <fieldset disabled={loading}>
        {mode === "signup" && <AccessField name="name" label="Full name (optional)" autoComplete="name" defaultValue={name} maxLength={120} placeholder="Alex Morgan" />}
        {["signin", "signup", "forgot"].includes(mode) && <AccessField label={mode === "signup" ? "Work email" : "Email address"} name="email" type="email" required autoComplete={mode === "signin" ? "username" : "email"} defaultValue={email} placeholder="you@practice.com" />}
        {(mode === "signin" || mode === "signup") && <AccessPassword creating={mode === "signup"} action={mode === "signin" ? <button className="cq-a-link" type="button" onClick={() => switchMode("forgot")}>Forgot password?</button> : undefined} />}
        {mode === "reset" && <><AccessPassword creating name="newpassword" label="New password" /><AccessPassword creating name="confirm" label="Confirm password" /></>}
        {["verify", "resetcode", "firstcode", "mfa", "recovery"].includes(mode) && <AccessField name="code" label={mode === "recovery" ? "Recovery code" : "Verification code"} required autoComplete={mode === "recovery" ? "off" : "one-time-code"} inputMode={mode === "recovery" ? "text" : "numeric"} pattern={mode === "recovery" ? undefined : "[0-9]{6}"} maxLength={mode === "recovery" ? 100 : 6} placeholder={mode === "recovery" ? "Enter your saved code" : "000000"} hint={mode === "recovery" ? "Each recovery code can only be used once." : "Enter the 6-digit code. You can paste it here."} />}
        <AccessError>{error}</AccessError>
        <button className="cq-a-primary" type="submit">{loading ? "One moment…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset code" : mode === "reset" ? "Update password" : "Verify & continue"} <span aria-hidden="true">→</span></button>
      </fieldset>
    </form>}
    {mode === "signup" && <div id="clerk-captcha" />}
    <AccessStatus>{message}</AccessStatus>
    {["verify", "resetcode", "firstcode"].includes(mode) && <div className="cq-a-actions"><button className="cq-a-link" disabled={loading || !!cooldown} type="button" onClick={() => void resend()}>{cooldown ? `Resend code in ${cooldown}s` : "Resend code"}</button>{mode === "verify" && <button className="cq-a-link" type="button" disabled={loading} onClick={() => void run(async () => { check(await signUp.reset()); switchMode("signup"); })}>Use a different email</button>}</div>}
    {(mode === "mfa" || mode === "recovery") && <div className="cq-a-actions">{signIn.supportedSecondFactors.filter(f => ["totp", "phone_code", "email_code", "backup_code"].includes(f.strategy)).map(f => <button className="cq-a-link" type="button" disabled={loading} key={f.strategy} onClick={() => void chooseMFA(f.strategy as MFA)}>{({ totp: "Use authenticator app", phone_code: "Send a text message", email_code: "Send an email code", backup_code: "Use a recovery code" } as Record<string, string>)[f.strategy]}</button>)}</div>}
    {mode === "signin" && <><p className="cq-a-under">New to CareIQ? <Link className="cq-a-link" href={`/sign-up?returnTo=${encodeURIComponent(destination)}`}>Create an account</Link></p><button className="cq-a-link" type="button" onClick={() => switchMode("provider")}>Other sign-in options</button></>}
    {mode === "signup" && <p className="cq-a-under">Already have an account? <Link className="cq-a-link" href={`/sign-in?returnTo=${encodeURIComponent(destination)}`}>Sign in</Link></p>}
  </AccessShell>;
}
