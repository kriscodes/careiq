import { useAuth, useClerk, useOrganizationList, useSession } from "@clerk/expo";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { Redirect, usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { AccessLifecycle, isForeground, type AccessPhase } from "./access-policy";
import { createApi, ScopeChangedError, userMessage, type Api } from "./api";
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
    if (!configuration.apiUrl) throw new Error("CareIQ services are not configured yet.");
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
      if (lifecycle.failCheck(generation)) setAccessError(userMessage(error));
    }
  }, [api, getScope, lifecycle, queryClient]);
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
  const router = useRouter();
  return configuration.clerkPublishableKey ? children : <Page title="CareIQ mobile" description="Your account connection is not configured in this local build."><Note>Connect CareIQ to sign in and create or join a practice.</Note><Button onPress={() => router.push("/design-preview")}>View the designs</Button><Button secondary onPress={() => router.push("/setup")}>Connection settings</Button></Page>;
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
  if (!isLoaded) return <Page title="Opening CareIQ…">{null}</Page>;
  if (!isSignedIn) return <Redirect href={{ pathname: "/sign-in", params: { returnTo: pathname === "/join" ? "/join" : "/" } }} />;
  if (!session) return <Page title="Opening CareIQ…">{null}</Page>;
  if (session.currentTask || session.status !== "active") return <Redirect href={{ pathname: "/security", params: { returnTo: pathname === "/join" ? "/join" : "/" } }} />;
  if (context.phase === "background") return <Page title="CareIQ is paused">{null}</Page>;
  if (context.phase === "checking") return <Page title="Confirming your access…" description="Checking your account and practice before continuing.">{null}</Page>;
  if (context.phase === "error") return <Page title="We couldn’t confirm your access" description="Check again before opening your practice."><Feedback error={context.accessError} /><Button onPress={context.retryAccess}>Try again</Button>{organizations.userMemberships.data?.map(member => <Choice key={member.id} title={`Open ${member.organization.name}`} onPress={() => {
      context.clear();
      void organizations.setActive?.({
        organization: member.organization.id
      });
    }} />)}<TextButton onPress={() => {
      context.clear();
      void signOut().then(() => router.replace("/sign-in"));
    }}>Sign out</TextButton></Page>;
  return <ResetScope key={context.scope}>{children}</ResetScope>;
}
function ResetScope({
  children
}: {
  children: ReactNode;
}) {
  return children;
}
