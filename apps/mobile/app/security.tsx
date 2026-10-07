import { useAuth, useClerk, useSession } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { SignIn, UserProfile } from "@clerk/expo/web";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { authenticationDestination } from "../src/invitation-policy";
import { Configured } from "../src/session";
import { Note, Page, TextButton } from "../src/ui";
export default function Screen() {
  return <Configured><Security /></Configured>;
}
function Security() {
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
  return <Page title="Secure account setup" description="Complete the account steps required to continue." onBack={() => router.replace("/")}><Note>CareIQ waits until your required account steps are complete before checking practice access.</Note><View style={{
      minHeight: 540
    }}>{Platform.OS === "web" ? isSignedIn && !session?.currentTask ? <UserProfile /> : <SignIn /> : isSignedIn && !session?.currentTask ? <UserProfileView /> : <AuthView />}</View><TextButton onPress={() => void signOut().then(() => router.replace("/sign-in"))}>Sign out</TextButton></Page>;
}
