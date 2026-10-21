"use client";

import { useI18n } from "@/i18n/provider";
import Link from "next/link";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, SignUp, useAuth, useSignIn, useSignUp } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { safeDestination, signInStep, type AuthStep } from "@/lib/access-flow";
import { invitationContinuationUrl, rememberAuthDestination, sessionTaskDestination } from "@/lib/auth-intent";
import { AccessActionError, authErrorMessage, isUnknownAccountError } from "@/lib/auth-errors";
import { AUTH_PROVIDERS, authProviderRedirects, configuredAuthProviders, type AuthProvider } from "@/lib/auth-providers";
import { SignOutButton } from "./SignOutButton";
import { AccessError, AccessField, AccessHeading, AccessPassword, AccessShell, AccessStatus } from "./AccessShell";

type Mode = AuthStep | "resetdone";
type MFA = "totp" | "phone_code" | "email_code" | "backup_code";
type Result = { error: unknown | null };

function check(result: Result) { if (result.error) throw result.error; }

type AuthScreenProps = { initialMode?: "signin" | "signup" | "forgot"; returnTo?: string; invitation?: boolean; invitationComplete?: boolean; expired?: boolean };

function AuthLoading({ failed = false }: { failed?: boolean }) {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (failed) return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [failed]);
  const retryable = failed || slow;
  return <AccessShell centered>
    <AccessHeading title={t(retryable ? "access.auth.unavailableTitle" : "access.copy.opening_careiq")} />
    <p role={retryable ? "alert" : "status"}>{t(retryable ? "access.auth.unavailableHelp" : "access.copy.one_moment_while_we_check_your_account")}</p>
    {retryable && <button className="cq-a-primary" type="button" onClick={() => window.location.reload()}>{t("access.copy.try_again")}</button>}
  </AccessShell>;
}

export function AuthScreen(props: AuthScreenProps) {
  // Server auth state can be loaded before the browser SDK. Mounting its form early
  // captures unloaded resource proxies, whose status cannot advance after a request.
  return <><ClerkLoading><AuthLoading /></ClerkLoading><ClerkFailed><AuthLoading failed /></ClerkFailed><ClerkLoaded><LoadedAuthScreen {...props} /></ClerkLoaded></>;
}

function LoadedAuthScreen({ initialMode = "signin", returnTo, invitation = false, invitationComplete = false, expired = false }: AuthScreenProps) {
  const { t, formatNumber } = useI18n();
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
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
  const providers = configuredAuthProviders(process.env.NEXT_PUBLIC_CAREIQ_AUTH_PROVIDERS);

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
      // The fragment is available only in the browser. Clerk must own its OAuth callback,
      // including a cold return before its sign-in/sign-up resource status has advanced.
      if (/^#\/sso-callback(?:\?|$)/.test(window.location.hash)) { setMode("provider"); return; }
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
    catch (cause) { if (alive.current) setError(authErrorMessage(cause, t)); }
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
  async function chooseProvider(provider: AuthProvider) {
    if (invitation || !providers.includes(provider) || !["signin", "signup"].includes(mode)) return;
    await run(async () => {
      rememberAuthDestination(destination);
      const params = { strategy: AUTH_PROVIDERS[provider].strategy, ...authProviderRedirects(signupFlow ? "signup" : "signin", destination) };
      check(await (signupFlow ? signUp.sso(params) : signIn.sso(params)));
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
      setCooldown(30); setMessage(mode === "resetcode" ? t("access.copy.if_an_account_exists_a_new_code_will_arrive_shortly") : t("access.copy.a_new_code_was_sent"));
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
        if (result.error) throw new AccessActionError(t("access.copy.we_couldn_t_verify_that_code_request_a_new_one_and_try_again"));
        if (signIn.status === "needs_new_password") switchMode("reset"); else await advanceSignIn();
      } else if (mode === "reset") {
        if (fields.get("newpassword") !== fields.get("confirm")) throw new AccessActionError(t("access.copy.the_passwords_don_t_match_try_again"));
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
    signin: [expired ? t("access.copy.sign_in_again") : t("access.auth.goodToSeeYou"), expired ? t("access.copy.your_session_has_expired_sign_in_to_continue") : t("access.auth.roomToCareStartsHere")],
    signup: [t("access.auth.aLittleHello"), t("access.auth.createAccountOneStep")],
    verify: [t("access.copy.check_your_email"), t("access.auth.sentVerification", { email: email || signUp.emailAddress || t("access.copy.your_email") })],
    forgot: [t("access.auth.passwordResetTitle"), t("access.copy.enter_your_email_and_we_ll_send_a_password_reset_code")],
    resetcode: [t("access.copy.check_your_email"), t("access.auth.sentReset", { email })],
    reset: [t("access.auth.freshStart"), t("access.copy.use_a_password_you_haven_t_used_for_this_account")],
    resetdone: [t("access.copy.password_updated"), t("access.copy.your_other_sessions_have_been_signed_out_continue_to_careiq")],
    mfa: [t("access.copy.one_more_step"), mfa === "totp" ? t("access.copy.enter_the_code_from_your_authenticator_app") : mfa === "phone_code" ? t("access.copy.enter_the_code_sent_to_your_phone") : t("access.copy.enter_the_code_sent_to_your_email")],
    recovery: [t("access.copy.use_a_recovery_code"), t("access.copy.enter_one_of_the_recovery_codes_you_saved_when_setting_up_two_step_verific")],
    firstcode: [t("access.copy.check_your_email"), t("access.copy.enter_the_verification_code_sent_to_your_email")],
    provider: [invitation ? t("access.copy.join_your_team") : t("access.copy.continue_to_your_account"), invitation ? t("access.copy.use_the_email_address_that_received_your_practice_invitation") : t("access.copy.complete_the_remaining_steps_for_your_account")],
  };
  // Only this form’s deliberate actions lock its controls. Passive SDK refreshes
  // (including the inactive sign-up flow) must not interrupt typing or hover.
  const loading = busy;
  if (isLoaded && isSignedIn && invitation && !invitationComplete) return <AccessShell centered><AccessHeading title={t("access.copy.join_your_team")} mark="users">{t("access.copy.continue_with_the_email_address_that_received_this_invitation")}</AccessHeading><div className="cq-a-note">{t("access.copy.you_re_already_signed_in_sign_out_to_continue_with_your_invited_account")}</div><div className="cq-a-actions"><SignOutButton className="cq-a-primary" redirectUrl={() => invitationContinuationUrl(window.location.href)}>{t("access.copy.use_the_invited_account")}</SignOutButton><Link className="cq-a-link" href="/">{t("access.copy.back_to_my_practices")}</Link></div></AccessShell>;
  if (isLoaded && isSignedIn && expired) return <AccessShell centered><AccessHeading title={t("access.copy.sign_in_again")}>{t("access.copy.your_session_needs_to_be_refreshed_before_you_can_reopen_careiq")}</AccessHeading><SignOutButton className="cq-a-primary" redirectUrl="/sign-in?reason=expired">{t("access.copy.sign_in_again")}</SignOutButton></AccessShell>;
  if (!isLoaded || isSignedIn) return <AccessShell centered><AccessHeading title={t("access.copy.opening_careiq")} /><p role="status">{t("access.copy.one_moment_while_we_check_your_account")}</p></AccessShell>;
  return <AccessShell centered>
    {!['signin', 'signup', 'provider'].includes(mode) && <button className="cq-a-link cq-a-back" type="button" disabled={loading} onClick={() => switchMode(mode === "recovery" ? "mfa" : initialMode)}>← {mode === "recovery" ? t("access.copy.back_to_verification") : t("access.copy.back")}</button>}
    <AccessHeading title={titles[mode][0]} mark={mode === "verify" || mode === "resetcode" ? "mail" : mode === "resetdone" ? "check" : undefined}>{titles[mode][1]}</AccessHeading>
    {!invitation && (mode === "signin" || mode === "signup") && providers.length > 0 && <div className="cq-a-providers" aria-busy={loading}>
      {providers.map(provider => <button key={provider} className="cq-a-social" type="button" disabled={loading} onClick={() => void chooseProvider(provider)}><span className={`cq-a-social-icon cq-a-social-${provider}`} aria-hidden="true" />{t(AUTH_PROVIDERS[provider].label)}</button>)}
      <div className="cq-a-divider"><span>{t("access.auth.orWithEmail")}</span></div>
    </div>}
    {mode === "provider" ? <><div className="cq-a-provider">{!invitation && signupFlow ? <SignUp routing="hash" forceRedirectUrl={destination} signInUrl={`/sign-in?returnTo=${encodeURIComponent(destination)}`} /> : <SignIn routing="hash" forceRedirectUrl={destination} signUpUrl={`/sign-up?returnTo=${encodeURIComponent(destination)}`} />}</div>{!invitation && <p className="cq-a-under"><Link href={`${signupFlow ? "/sign-in" : "/sign-up"}?returnTo=${encodeURIComponent(destination)}`} className="cq-a-link">{signupFlow ? t("access.copy.already_have_an_account_sign_in") : t("access.copy.create_an_account")}</Link></p>}</> : mode === "resetdone" ? <button className="cq-a-primary" type="button" disabled={loading} onClick={() => void run(() => finish("signin"))}>{t("access.copy.continue_to_careiq")}</button> : <form className="cq-a-form" onSubmit={submit} aria-busy={loading} aria-describedby={error ? "cq-access-error" : undefined}>
      <fieldset disabled={loading}>
        {mode === "signup" && <AccessField name="name" label={t("access.copy.full_name_optional")} autoComplete="name" defaultValue={name} maxLength={120} placeholder={t("access.copy.alex_morgan")} />}
        {["signin", "signup", "forgot"].includes(mode) && <AccessField label={mode === "signup" ? t("access.copy.work_email") : t("access.copy.email_address")} name="email" type="email" required autoComplete={mode === "signin" ? "username" : "email"} defaultValue={email} placeholder={t("access.copy.you_practice_com")} />}
        {(mode === "signin" || mode === "signup") && <AccessPassword creating={mode === "signup"} action={mode === "signin" ? <button className="cq-a-link" type="button" onClick={() => switchMode("forgot")}>{t("access.copy.forgot_password")}</button> : undefined} />}
        {mode === "reset" && <><AccessPassword creating name="newpassword" label={t("access.copy.new_password")} /><AccessPassword creating name="confirm" label={t("access.copy.confirm_password")} /></>}
        {["verify", "resetcode", "firstcode", "mfa", "recovery"].includes(mode) && <AccessField name="code" label={mode === "recovery" ? t("access.copy.recovery_code") : t("access.copy.verification_code")} required autoComplete={mode === "recovery" ? "off" : "one-time-code"} inputMode={mode === "recovery" ? "text" : "numeric"} pattern={mode === "recovery" ? undefined : "[0-9]{6}"} maxLength={mode === "recovery" ? 100 : 6} placeholder={mode === "recovery" ? t("access.copy.enter_your_saved_code") : "000000"} hint={mode === "recovery" ? t("access.copy.each_recovery_code_can_only_be_used_once") : t("access.copy.enter_the_6_digit_code_you_can_paste_it_here")} />}
        <AccessError>{error}</AccessError>
        <button className="cq-a-primary" type="submit">{loading ? t("access.copy.one_moment") : mode === "signin" ? t("access.copy.sign_in") : mode === "signup" ? t("access.copy.create_account") : mode === "forgot" ? t("access.copy.send_reset_code") : mode === "reset" ? t("access.copy.update_password") : t("access.copy.verify_continue")} <span aria-hidden="true">→</span></button>
      </fieldset>
    </form>}
    {mode === "signup" && <div id="clerk-captcha" />}
    <AccessStatus>{message}</AccessStatus>
    {["verify", "resetcode", "firstcode"].includes(mode) && <div className="cq-a-actions"><button className="cq-a-link" disabled={loading || !!cooldown} type="button" onClick={() => void resend()}>{cooldown ? t("access.auth.resendCountdown", { seconds: formatNumber(cooldown) }) : t("access.copy.resend_code")}</button>{mode === "verify" && <button className="cq-a-link" type="button" disabled={loading} onClick={() => void run(async () => { check(await signUp.reset()); switchMode("signup"); })}>{t("access.copy.use_a_different_email")}</button>}</div>}
    {(mode === "mfa" || mode === "recovery") && <div className="cq-a-actions">{signIn.supportedSecondFactors.filter(f => ["totp", "phone_code", "email_code", "backup_code"].includes(f.strategy)).map(f => <button className="cq-a-link" type="button" disabled={loading} key={f.strategy} onClick={() => void chooseMFA(f.strategy as MFA)}>{({ totp: t("access.copy.use_authenticator_app"), phone_code: t("access.copy.send_a_text_message"), email_code: t("access.copy.send_an_email_code"), backup_code: t("access.copy.use_a_recovery_code") } as Record<string, string>)[f.strategy]}</button>)}</div>}
    {mode === "signin" && <><p className="cq-a-under">{t("access.copy.new_to_careiq")} <Link className="cq-a-link" href={`/sign-up?returnTo=${encodeURIComponent(destination)}`}>{t("access.copy.create_an_account")}</Link></p><button className="cq-a-link cq-a-other" type="button" onClick={() => switchMode("provider")}>{t("access.auth.otherWaysToSignIn")} <span aria-hidden="true">⌄</span></button></>}
    {mode === "signup" && <button className="cq-a-link cq-a-other" type="button" onClick={() => switchMode("provider")}>{t("access.auth.otherWaysToCreateAccount")} <span aria-hidden="true">⌄</span></button>}
    {mode === "signup" && <p className="cq-a-under">{t("access.copy.already_have_an_account")} <Link className="cq-a-link" href={`/sign-in?returnTo=${encodeURIComponent(destination)}`}>{t("access.copy.sign_in")}</Link></p>}
  </AccessShell>;
}
