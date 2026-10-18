import { View, Text, useI18n, NativeCopyError } from "./i18n";
import { useAuth, useSignIn, useSignUp } from "@clerk/expo";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { authenticationDestination } from "./invitation-policy";
import { Configured } from "./session";
import { styles } from "./styles";
import { Button, Choice, Feedback, Field, Note, Page, TextButton } from "./ui";
type Mode = "sign-in" | "sign-up" | "verify-email" | "forgot-password" | "reset-password" | "mfa" | "recovery";
type Factor = "totp" | "phone_code" | "email_code" | "backup_code";
const titles: Record<Mode, string> = {
  "sign-in": "mobile.copy.welcome_back_b807833",
  "sign-up": "mobile.copy.create_your_account_4046b58",
  "verify-email": "mobile.copy.check_your_email_fab9f40",
  "forgot-password": "mobile.copy.forgot_your_password_a2f060b",
  "reset-password": "mobile.copy.choose_a_new_password_3f657f2",
  mfa: "mobile.copy.one_more_step_a9123ad",
  recovery: "mobile.copy.use_a_recovery_code_5043c82"
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
  const { errorMessage, t: tx } = useI18n();
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
      setError(errorMessage(e));
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
    } else if (signIn.status === "needs_new_password") router.push({ pathname: "/reset-password", params: { returnTo: destination } });else throw new NativeCopyError("mobile.copy.an_additional_account_step_is_required_use_secure_ac_1a1c26e");
  };
  const submit = () => void run(async () => {
    if (mode === "sign-in") {
      if (!email.trim() || !password) throw new NativeCopyError("mobile.copy.enter_your_email_and_password_5453c55");
      check(await signIn.password({
        emailAddress: email.trim(),
        password
      }));
      await finish();
    }
    if (mode === "sign-up") {
      if (!name.trim() || !email.trim() || !password) throw new NativeCopyError("mobile.copy.enter_your_name_email_and_password_c8d3bd0");
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
      if (signUp.status !== "complete") throw new NativeCopyError("mobile.copy.additional_account_information_is_required_continue__1955da9");
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
        if (!email.trim()) throw new NativeCopyError("mobile.copy.enter_your_email_address_14864a3");
        check(await signIn.create({
          identifier: email.trim()
        }));
        check(await signIn.resetPasswordEmailCode.sendCode());
        setResetSent(true);
        setCooldown(30);
      }
    }
    if (mode === "reset-password") {
      if (!password || password !== confirm) throw new NativeCopyError("mobile.copy.your_passwords_must_match_1a0b8ee");
      check(await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true
      }));
      setPassword("");
      setConfirm("");
      await finish();
    }
    if (mode === "mfa" || mode === "recovery") {
      if (!code.trim()) throw new NativeCopyError("mobile.copy.enter_your_verification_code_82d8f56");
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
    setMessage("mobile.copy.a_new_code_has_been_sent_7d4b682");
  });
  if (isLoaded && isSignedIn) return <Redirect href={destination} />;
  const verify = mode === "verify-email" || mode === "mfa" || mode === "recovery" || mode === "forgot-password" && resetSent;
  const expired = mode === "verify-email" && !signUp.id || (mode === "mfa" || mode === "recovery" || mode === "reset-password") && !signIn.id;
  const description = mode === "sign-in" ? tx("mobile.copy.sign_in_to_your_careiq_account_a229846") : mode === "sign-up" ? tx("mobile.copy.a_little_more_room_to_care_start_with_your_account_376b7e6") : mode === "verify-email" ? tx("mobile.copy.enter_the_code_sent_to_value0_bb62969", { value0: signUp.emailAddress || tx("mobile.auth.emailFallback") }) : mode === "mfa" ? tx("mobile.copy.confirm_it_s_you_to_finish_signing_in_76db897") : mode === "recovery" ? tx("mobile.copy.enter_one_of_the_recovery_codes_you_saved_when_setti_d9b8c8d") : mode === "reset-password" ? tx("mobile.copy.use_a_strong_password_you_haven_t_used_before_13c663f") : resetSent ? tx("mobile.copy.enter_the_reset_code_sent_to_value0_49096ba", { value0: email }) : tx("mobile.copy.enter_your_email_and_we_ll_help_you_reset_it_1d76ee6");
  return <Page title={expired ? tx("mobile.copy.this_step_has_expired_6dc4b1a") : titles[mode]} description={expired ? tx("mobile.copy.start_again_to_get_a_fresh_verification_code_8bb4233") : description} onBack={mode === "sign-in" ? undefined : () => router.canGoBack() ? router.back() : router.replace({ pathname: "/sign-in", params: { returnTo: destination } })}>
    {expired ? <Button onPress={() => router.replace(mode === "verify-email" ? "/sign-up" : "/sign-in")}>{tx("mobile.copy.start_again_b6fffc5")}</Button> : <>
      {mode === "sign-up" && <Field label={tx("mobile.copy.full_name_eeb6920")} value={name} onChangeText={setName} placeholder="Alex Morgan" autoComplete="name" textContentType="name" maxLength={120} />}
      {(mode === "sign-in" || mode === "sign-up" || mode === "forgot-password" && !resetSent) && <Field label={mode === "sign-up" ? tx("mobile.copy.work_email_4320576") : tx("mobile.copy.email_address_c94d317")} value={email} onChangeText={setEmail} placeholder="you@practice.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType={mode === "sign-in" ? "username" : "emailAddress"} />}
      {(mode === "sign-in" || mode === "sign-up" || mode === "reset-password") && <Field label={mode === "reset-password" ? tx("mobile.copy.new_password_d850ee1") : tx("mobile.copy.password_8be3c94")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign-in" ? "current-password" : "new-password"} textContentType={mode === "sign-in" ? "password" : "newPassword"} onSubmitEditing={mode === "sign-in" ? submit : undefined} />}
      {mode === "reset-password" && <Field label={tx("mobile.copy.confirm_new_password_f85039f")} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />}
      {mode === "sign-in" && <TextButton onPress={() => router.push({ pathname: "/forgot-password", params: { returnTo: destination } })}>{tx("mobile.copy.forgot_password_4c29f7f")}</TextButton>}
      {mode === "mfa" && <View style={{
        gap: 8
      }}>{signIn.supportedSecondFactors.filter(f => ["totp", "phone_code", "email_code"].includes(f.strategy)).map(f => <Choice key={f.strategy} selected={factor === f.strategy} title={f.strategy === "totp" ? tx("mobile.copy.authenticator_app_9e715f5") : f.strategy === "phone_code" ? tx("mobile.copy.text_message_7cfcf84") : tx("mobile.copy.email_code_5cb76e8")} onPress={() => void run(async () => {
          setCode("");
          setFactor(f.strategy as Factor);
          if (f.strategy === "phone_code") check(await signIn.mfa.sendPhoneCode());
          if (f.strategy === "email_code") check(await signIn.mfa.sendEmailCode());
        })} />)}</View>}
      {verify && <Field label={mode === "recovery" ? tx("mobile.copy.recovery_code_3cb5fd8") : tx("mobile.copy.verification_code_80f2f29")} value={code} onChangeText={setCode} code={mode !== "recovery"} keyboardType={mode === "recovery" ? "default" : "number-pad"} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={mode === "recovery" ? 40 : 6} onSubmitEditing={submit} />}
      <Feedback error={error} message={message} /><Button busy={fetching} onPress={submit}>{mode === "sign-in" ? tx("mobile.copy.sign_in_ada2e9e") : mode === "sign-up" ? tx("mobile.copy.create_account_aaf3744") : mode === "reset-password" ? tx("mobile.copy.save_new_password_2a76cbe") : mode === "forgot-password" && !resetSent ? tx("mobile.copy.send_reset_code_6252acc") : tx("mobile.copy.verify_and_continue_882666b")}</Button>
      {(mode === "verify-email" || mode === "forgot-password" && resetSent || mode === "mfa" && ["phone_code", "email_code"].includes(factor)) && <TextButton disabled={fetching || cooldown > 0} onPress={resend}>{cooldown ? tx("mobile.copy.resend_code_in_value0_s_0476e26", { value0: cooldown }) : tx("mobile.copy.resend_code_1d3cb8a")}</TextButton>}
      {mode === "mfa" && signIn.supportedSecondFactors.some(f => f.strategy === "backup_code") && <TextButton onPress={() => router.push({ pathname: "/recovery", params: { returnTo: destination } })}>{tx("mobile.copy.use_a_recovery_code_5043c82")}</TextButton>}
      {mode === "sign-in" && <TextButton onPress={() => router.push({ pathname: "/sign-up", params: { returnTo: destination } })}>{tx("mobile.copy.new_to_careiq_create_an_account_ebcb1fb")}</TextButton>}
      {mode === "sign-up" && <TextButton onPress={() => router.replace({ pathname: "/sign-in", params: { returnTo: destination } })}>{tx("mobile.copy.already_have_an_account_sign_in_6603c2f")}</TextButton>}
      {mode === "verify-email" && <TextButton onPress={() => {
        void signUp.reset();
        router.replace({ pathname: "/sign-up", params: { returnTo: destination } });
      }}>{tx("mobile.copy.use_a_different_email_9725dd7")}</TextButton>}
      {error.includes("additional") || error.includes("additional_account") ? <Button secondary onPress={() => router.push({ pathname: "/security", params: { returnTo: destination } })}>{tx("mobile.copy.secure_account_setup_94f925a")}</Button> : null}
      {mode === "sign-up" && <View nativeID="clerk-captcha" />}
      {mode === "recovery" && <Note>{tx("mobile.copy.a_recovery_code_can_be_used_once_keep_your_remaining_0ac5fd7")}</Note>}
      {mode === "reset-password" && <Text style={styles.note}>{tx("mobile.copy.your_other_sessions_will_be_signed_out_after_your_pa_1cdb746")}</Text>}
    </>}
  </Page>;
}
