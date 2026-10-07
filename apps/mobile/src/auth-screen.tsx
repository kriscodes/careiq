import { useAuth, useSignIn, useSignUp } from "@clerk/expo";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, View, Text } from "react-native";
import { userMessage } from "./api";
import { authenticationDestination } from "./invitation-policy";
import { Configured } from "./session";
import { styles } from "./styles";
import { Button, Choice, Feedback, Field, Note, Page, TextButton } from "./ui";
type Mode = "sign-in" | "sign-up" | "verify-email" | "forgot-password" | "reset-password" | "mfa" | "recovery";
type Factor = "totp" | "phone_code" | "email_code" | "backup_code";
const titles: Record<Mode, string> = {
  "sign-in": "Welcome back",
  "sign-up": "Create your account",
  "verify-email": "Check your email",
  "forgot-password": "Forgot your password?",
  "reset-password": "Choose a new password",
  mfa: "One more step",
  recovery: "Use a recovery code"
};
export function AuthRoute({
  mode
}: {
  mode: Mode;
}) {
  return <Configured><AuthScreen mode={mode} /></Configured>;
}
function AuthScreen({
  mode
}: {
  mode: Mode;
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const destination = authenticationDestination(params.returnTo);
  const {
    isLoaded,
    isSignedIn
  } = useAuth({
    treatPendingAsSignedOut: false
  });
  const {
    signIn,
    fetchStatus: signInFetch
  } = useSignIn();
  const {
    signUp,
    fetchStatus: signUpFetch
  } = useSignUp();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [selectedFactor, setFactor] = useState<Factor | null>(null);
  const factor = selectedFactor ?? (signIn.supportedSecondFactors.some(f => f.strategy === "totp") ? "totp" : signIn.supportedSecondFactors.some(f => f.strategy === "phone_code") ? "phone_code" : signIn.supportedSecondFactors.some(f => f.strategy === "email_code") ? "email_code" : "backup_code");
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const fetching = busy || signInFetch === "fetching" || signUpFetch === "fetching";
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") { setPassword(""); setConfirm(""); setCode(""); }
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const run = async (action: () => Promise<void>) => {
    if (fetching) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const check = (result: {
    error: unknown;
  }) => {
    if (result.error) throw result.error;
  };
  const finish = async () => {
    if (signIn.status === "complete") {
      setPassword("");
      setCode("");
      check(await signIn.finalize({
        navigate: ({
          session
        }) => router.replace(session?.currentTask ? { pathname: "/security", params: { returnTo: destination } } : destination)
      }));
    } else if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      const factors = signIn.supportedSecondFactors;
      if (!factors.some(f => ["totp", "phone_code", "email_code", "backup_code"].includes(f.strategy))) {
        router.replace({ pathname: "/security", params: { returnTo: destination } });
        return;
      }
      if (!factors.some(f => f.strategy === "totp")) {
        if (factors.some(f => f.strategy === "phone_code")) check(await signIn.mfa.sendPhoneCode());else if (factors.some(f => f.strategy === "email_code")) check(await signIn.mfa.sendEmailCode());
      }
      setPassword("");
      router.push({ pathname: factors.every(f => !["totp", "phone_code", "email_code"].includes(f.strategy)) ? "/recovery" : "/mfa", params: { returnTo: destination } });
    } else if (signIn.status === "needs_new_password") router.push({ pathname: "/reset-password", params: { returnTo: destination } });else throw new Error("An additional account step is required. Use secure account setup to continue.");
  };
  const submit = () => void run(async () => {
    if (mode === "sign-in") {
      if (!email.trim() || !password) throw new Error("Enter your email and password.");
      check(await signIn.password({
        emailAddress: email.trim(),
        password
      }));
      await finish();
    }
    if (mode === "sign-up") {
      if (!name.trim() || !email.trim() || !password) throw new Error("Enter your name, email, and password.");
      const parts = name.trim().split(/\s+/);
      check(await signUp.password({
        emailAddress: email.trim(),
        password,
        firstName: parts[0],
        lastName: parts.slice(1).join(" ")
      }));
      setPassword("");
      check(await signUp.verifications.sendEmailCode());
      router.push({ pathname: "/verify-email", params: { returnTo: destination } });
    }
    if (mode === "verify-email") {
      check(await signUp.verifications.verifyEmailCode({
        code
      }));
      if (signUp.status !== "complete") throw new Error("Additional account information is required. Continue with secure account setup.");
      setCode("");
      check(await signUp.finalize({
        navigate: ({
          session
        }) => router.replace(session?.currentTask ? { pathname: "/security", params: { returnTo: destination } } : destination)
      }));
    }
    if (mode === "forgot-password") {
      if (resetSent) {
        check(await signIn.resetPasswordEmailCode.verifyCode({
          code
        }));
        router.push({ pathname: "/reset-password", params: { returnTo: destination } });
      } else {
        if (!email.trim()) throw new Error("Enter your email address.");
        check(await signIn.create({
          identifier: email.trim()
        }));
        check(await signIn.resetPasswordEmailCode.sendCode());
        setResetSent(true);
        setCooldown(30);
      }
    }
    if (mode === "reset-password") {
      if (!password || password !== confirm) throw new Error("Your passwords must match.");
      check(await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true
      }));
      setPassword("");
      setConfirm("");
      await finish();
    }
    if (mode === "mfa" || mode === "recovery") {
      if (!code.trim()) throw new Error("Enter your verification code.");
      const method = mode === "recovery" ? "backup_code" : factor;
      check(await (method === "totp" ? signIn.mfa.verifyTOTP({
        code
      }) : method === "phone_code" ? signIn.mfa.verifyPhoneCode({
        code
      }) : method === "email_code" ? signIn.mfa.verifyEmailCode({
        code
      }) : signIn.mfa.verifyBackupCode({
        code
      })));
      await finish();
    }
  });
  const resend = () => void run(async () => {
    if (mode === "verify-email") check(await signUp.verifications.sendEmailCode());else if (mode === "forgot-password") check(await signIn.resetPasswordEmailCode.sendCode());else if (factor === "phone_code") check(await signIn.mfa.sendPhoneCode());else check(await signIn.mfa.sendEmailCode());
    setCooldown(30);
    setMessage("A new code has been sent.");
  });
  if (isLoaded && isSignedIn) return <Redirect href={destination} />;
  const verify = mode === "verify-email" || mode === "mfa" || mode === "recovery" || mode === "forgot-password" && resetSent;
  const expired = mode === "verify-email" && !signUp.id || (mode === "mfa" || mode === "recovery" || mode === "reset-password") && !signIn.id;
  const description = mode === "sign-in" ? "Sign in to your CareIQ account." : mode === "sign-up" ? "A little more room to care. Start with your account." : mode === "verify-email" ? `Enter the code sent to ${signUp.emailAddress || "your email address"}.` : mode === "mfa" ? "Confirm it’s you to finish signing in." : mode === "recovery" ? "Enter one of the recovery codes you saved when setting up two-step verification." : mode === "reset-password" ? "Use a strong password you haven’t used before." : resetSent ? `Enter the reset code sent to ${email}.` : "Enter your email and we’ll help you reset it.";
  return <Page title={expired ? "This step has expired" : titles[mode]} description={expired ? "Start again to get a fresh verification code." : description} onBack={mode === "sign-in" ? undefined : () => router.canGoBack() ? router.back() : router.replace({ pathname: "/sign-in", params: { returnTo: destination } })}>
    {expired ? <Button onPress={() => router.replace(mode === "verify-email" ? "/sign-up" : "/sign-in")}>Start again</Button> : <>
      {mode === "sign-up" && <Field label="Full name" value={name} onChangeText={setName} placeholder="Alex Morgan" autoComplete="name" textContentType="name" maxLength={120} />}
      {(mode === "sign-in" || mode === "sign-up" || mode === "forgot-password" && !resetSent) && <Field label={mode === "sign-up" ? "Work email" : "Email address"} value={email} onChangeText={setEmail} placeholder="you@practice.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType={mode === "sign-in" ? "username" : "emailAddress"} />}
      {(mode === "sign-in" || mode === "sign-up" || mode === "reset-password") && <Field label={mode === "reset-password" ? "New password" : "Password"} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign-in" ? "current-password" : "new-password"} textContentType={mode === "sign-in" ? "password" : "newPassword"} onSubmitEditing={mode === "sign-in" ? submit : undefined} />}
      {mode === "reset-password" && <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />}
      {mode === "sign-in" && <TextButton onPress={() => router.push({ pathname: "/forgot-password", params: { returnTo: destination } })}>Forgot password?</TextButton>}
      {mode === "mfa" && <View style={{
        gap: 8
      }}>{signIn.supportedSecondFactors.filter(f => ["totp", "phone_code", "email_code"].includes(f.strategy)).map(f => <Choice key={f.strategy} selected={factor === f.strategy} title={f.strategy === "totp" ? "Authenticator app" : f.strategy === "phone_code" ? "Text message" : "Email code"} onPress={() => void run(async () => {
          setCode("");
          setFactor(f.strategy as Factor);
          if (f.strategy === "phone_code") check(await signIn.mfa.sendPhoneCode());
          if (f.strategy === "email_code") check(await signIn.mfa.sendEmailCode());
        })} />)}</View>}
      {verify && <Field label={mode === "recovery" ? "Recovery code" : "Verification code"} value={code} onChangeText={setCode} code={mode !== "recovery"} keyboardType={mode === "recovery" ? "default" : "number-pad"} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={mode === "recovery" ? 40 : 6} onSubmitEditing={submit} />}
      <Feedback error={error} message={message} /><Button busy={fetching} onPress={submit}>{mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : mode === "reset-password" ? "Save new password" : mode === "forgot-password" && !resetSent ? "Send reset code" : "Verify and continue"}</Button>
      {(mode === "verify-email" || mode === "forgot-password" && resetSent || mode === "mfa" && ["phone_code", "email_code"].includes(factor)) && <TextButton disabled={fetching || cooldown > 0} onPress={resend}>{cooldown ? `Resend code in ${cooldown}s` : "Resend code"}</TextButton>}
      {mode === "mfa" && signIn.supportedSecondFactors.some(f => f.strategy === "backup_code") && <TextButton onPress={() => router.push({ pathname: "/recovery", params: { returnTo: destination } })}>Use a recovery code</TextButton>}
      {mode === "sign-in" && <TextButton onPress={() => router.push({ pathname: "/sign-up", params: { returnTo: destination } })}>New to CareIQ? Create an account</TextButton>}
      {mode === "sign-up" && <TextButton onPress={() => router.replace({ pathname: "/sign-in", params: { returnTo: destination } })}>Already have an account? Sign in</TextButton>}
      {mode === "verify-email" && <TextButton onPress={() => {
        void signUp.reset();
        router.replace({ pathname: "/sign-up", params: { returnTo: destination } });
      }}>Use a different email</TextButton>}
      {error.includes("Additional") || error.includes("additional") ? <Button secondary onPress={() => router.push({ pathname: "/security", params: { returnTo: destination } })}>Secure account setup</Button> : null}
      {mode === "sign-up" && <View nativeID="clerk-captcha" />}
      {mode === "recovery" && <Note>A recovery code can be used once. Keep your remaining codes somewhere safe.</Note>}
      {mode === "reset-password" && <Text style={styles.note}>Your other sessions will be signed out after your password is changed.</Text>}
    </>}
  </Page>;
}
