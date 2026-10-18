import { View, useI18n } from "../src/i18n";
import { useAuth, useClerk, useSession } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { SignIn, UserProfile } from "@clerk/expo/web";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { authenticationDestination } from "../src/invitation-policy";
import { Configured } from "../src/session";
import { Note, Page, TextButton } from "../src/ui";
export default function Screen() {
  return <Configured><Security /></Configured>;
}
function Security() {
  const { t: tx } = useI18n();
  const {
    isSignedIn
  } = useAuth({
    treatPendingAsSignedOut: false
  });
  const {
    session
  } = useSession();
  const {
    signOut
  } = useClerk();
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const destination = authenticationDestination(params.returnTo);
  const pending = useRef(!!session?.currentTask || session?.status === "pending");
  useEffect(() => {
    if (pending.current && session?.status === "active" && !session.currentTask) router.replace(destination);
  }, [session?.status, session?.currentTask, router, destination]);
  return <Page title={tx("mobile.copy.secure_account_setup_94f925a")} description={tx("mobile.copy.complete_the_account_steps_required_to_continue_87fae7d")} onBack={() => router.replace("/")}><Note>{tx("mobile.copy.careiq_waits_until_your_required_account_steps_are_c_daf8c29")}</Note><View style={{
      minHeight: 540
    }}>{Platform.OS === "web" ? isSignedIn && !session?.currentTask ? <UserProfile /> : <SignIn /> : isSignedIn && !session?.currentTask ? <UserProfileView /> : <AuthView />}</View><TextButton onPress={() => void signOut().then(() => router.replace("/sign-in"))}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
}
