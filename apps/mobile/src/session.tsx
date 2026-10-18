import { useI18n, NativeCopyError } from "./i18n";
import { useAuth, useClerk, useOrganizationList, useSession } from "@clerk/expo";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { Redirect, usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { AccessLifecycle, isForeground, type AccessPhase } from "./access-policy";
import { createApi, ScopeChangedError, type Api } from "./api";
import { readAccessContext } from "./access-validation";
import type { AccessContext } from "./contracts";
import { configuration } from "./environment";
import { Button, Feedback, Note, Page, TextButton, Choice } from "./ui";
type SessionContext = {
  api: Api;
  scope: string;
  phase: AccessPhase;
  accessError: string;
  retryAccess: () => void;
  locationId: string | null;
  selectLocation: (id: string | null) => void;
  clear: () => void;
};
const Context = createContext<SessionContext | null>(null);
export function SessionProvider({
  children
}: {
  children: ReactNode;
}) {
  const {
    userId,
    orgId,
    sessionId,
    getToken,
    isSignedIn
  } = useAuth({
    treatPendingAsSignedOut: false
  });
  const {
    session
  } = useSession();
  const identity = `${sessionId ?? ""}:${userId ?? ""}:${orgId ?? ""}`;
  return <ScopeProvider key={identity} identity={identity} userId={userId ?? ""} orgId={orgId ?? null} sessionId={sessionId ?? ""} getToken={getToken} authenticated={!!isSignedIn && session?.status === "active" && !session.currentTask}>{children}</ScopeProvider>;
}
function ScopeProvider({
  children,
  identity,
  userId, orgId, sessionId,
  getToken,
  authenticated
}: {
  children: ReactNode;
  identity: string;
  userId: string; orgId: string | null; sessionId: string;
  getToken: ReturnType<typeof useAuth>["getToken"];
  authenticated: boolean;
}) {
  const { errorMessage } = useI18n();
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState("");
  const [lifecycle] = useState(() => new AccessLifecycle(authenticated ? isForeground(AppState.currentState) ? "checking" : "background" : "ready"));
  const snapshot = useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot, lifecycle.snapshot);
  const phase = authenticated && snapshot.split(":")[0] === "ready" && !lifecycle.hasFreshAccess ? "checking" : snapshot.split(":")[0] as AccessPhase;
  const baseScope = `${identity}:${locationId ?? ""}`;
  const scope = `${baseScope}:${snapshot.split(":")[1]}`;
  const scopeRef = useRef(baseScope);
  const tokenRef = useRef(getToken);
  const clear = useCallback(() => {
    lifecycle.cancel();
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient, lifecycle]);
  useLayoutEffect(() => {
    scopeRef.current = baseScope;
    tokenRef.current = getToken;
  }, [baseScope, getToken]);
  useLayoutEffect(() => {
    clear();
    return clear;
  }, [clear]);
  const getScope = useCallback(() => `${scopeRef.current}:${lifecycle.generation}`, [lifecycle]);
  const readToken = useCallback(() => {
    if (!lifecycle.foreground) throw new ScopeChangedError();
    if (!configuration.apiUrl) throw new NativeCopyError("mobile.copy.careiq_services_are_not_configured_yet_0aaa238");
    return tokenRef.current({
      skipCache: true
    });
  }, [lifecycle]);
  const api = useCallback<Api>(async <T,>(path: string, options?: Parameters<Api>[1]) => {
    const data = await createApi({ origin: configuration.apiUrl ?? "", getScope, getToken: readToken, register: lifecycle.register })<T>(path, options);
    return path === "/api/v1/me" ? readAccessContext(data, { userId, orgId, sessionId }) as T : data;
  }, [getScope, readToken, lifecycle, userId, orgId, sessionId]);
  const checkAccess = useCallback(async () => {
    const generation = lifecycle.beginCheck();
    try {
      const checkedScope = getScope();
      const access = await api<AccessContext>("/api/v1/me");
      if (getScope() !== checkedScope) throw new ScopeChangedError();
      if (lifecycle.completeCheck(generation)) {
        queryClient.setQueryData(["access", checkedScope], access);
        setAccessError("");
      }
    } catch (error) {
      if (lifecycle.failCheck(generation)) setAccessError(errorMessage(error));
    }
  }, [api, getScope, lifecycle, queryClient, errorMessage]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (authenticated && isForeground(AppState.currentState)) void checkAccess();
    }, 0);
    return () => clearTimeout(timer);
  }, [authenticated, checkAccess]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      const active = isForeground(state);
      focusManager.setFocused(active);
      if (!active) {
        lifecycle.suspend();
        clear();
        setLocationId(null);
      } else if (authenticated) {
        void checkAccess();
      } else {
        lifecycle.withoutAuthentication();
      }
    });
    return () => subscription.remove();
  }, [authenticated, checkAccess, clear, lifecycle]);
  const selectLocation = (id: string | null) => {
    if (id !== locationId) {
      scopeRef.current = `${identity}:${id ?? ""}`;
      clear();
      setLocationId(id);
    }
  };
  return <Context.Provider value={{
    api,
    scope,
    phase,
    accessError,
    retryAccess: () => void checkAccess(),
    locationId,
    selectLocation,
    clear
  }}>{children}</Context.Provider>;
}
export function useApiSession() {
  const context = useContext(Context);
  if (!context) throw new Error("Mobile authentication is not configured.");
  return context;
}
export function Configured({
  children
}: {
  children: ReactNode;
}) {
  const { t: tx } = useI18n();
  const router = useRouter();
  return configuration.clerkPublishableKey ? children : <Page title={tx("mobile.copy.careiq_mobile_1a3d2c1")} description={tx("mobile.copy.your_account_connection_is_not_configured_in_this_lo_a943a5d")}><Note>{tx("mobile.copy.connect_careiq_to_sign_in_and_create_or_join_a_pract_43b7dbd")}</Note><Button onPress={() => router.push("/design-preview")}>{tx("mobile.copy.view_the_designs_575c4b3")}</Button><Button secondary onPress={() => router.push("/setup")}>{tx("mobile.copy.connection_settings_618aac5")}</Button></Page>;
}
export function Protected({
  children
}: {
  children: ReactNode;
}) {
  return <Configured><SignedInGate>{children}</SignedInGate></Configured>;
}
function SignedInGate({
  children
}: {
  children: ReactNode;
}) {
  const { t: tx } = useI18n();
  const {
    isLoaded,
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
  const context = useApiSession();
  const pathname = usePathname();
  const organizations = useOrganizationList({
    userMemberships: {
      infinite: true
    }
  });
  if (!isLoaded) return <Page title={tx("mobile.copy.opening_careiq_e7ab89a")}>{null}</Page>;
  if (!isSignedIn) return <Redirect href={{ pathname: "/sign-in", params: { returnTo: pathname === "/join" ? "/join" : "/" } }} />;
  if (!session) return <Page title={tx("mobile.copy.opening_careiq_e7ab89a")}>{null}</Page>;
  if (session.currentTask || session.status !== "active") return <Redirect href={{ pathname: "/security", params: { returnTo: pathname === "/join" ? "/join" : "/" } }} />;
  if (context.phase === "background") return <Page title={tx("mobile.copy.careiq_is_paused_47f5943")}>{null}</Page>;
  if (context.phase === "checking") return <Page title={tx("mobile.copy.confirming_your_access_faf2d96")} description={tx("mobile.copy.checking_your_account_and_practice_before_continuing_87aad7d")}>{null}</Page>;
  if (context.phase === "error") return <Page title={tx("mobile.copy.we_couldn_t_confirm_your_access_d8f2762")} description={tx("mobile.copy.check_again_before_opening_your_practice_17b854a")}><Feedback error={context.accessError} /><Button onPress={context.retryAccess}>{tx("mobile.copy.try_again_042c862")}</Button>{organizations.userMemberships.data?.map(member => <Choice key={member.id} title={tx("mobile.copy.open_value0_a34416a", { value0: member.organization.name })} onPress={() => {
      context.clear();
      void organizations.setActive?.({
        organization: member.organization.id
      });
    }} />)}<TextButton onPress={() => {
      context.clear();
      void signOut().then(() => router.replace("/sign-in"));
    }}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  return <ResetScope key={context.scope}>{children}</ResetScope>;
}
function ResetScope({
  children
}: {
  children: ReactNode;
}) {
  return children;
}
