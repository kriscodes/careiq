import { useAuth, useClerk, useOrganizationList, useUser } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { userMessage } from "./api";
import { invitationConfirmation } from "./invitation-policy";
import { canEnterLocation, type AccessContext } from "./contracts";
import { useApiSession } from "./session";
import { styles } from "./styles";
import { Button, Choice, Feedback, Note, Page, TextButton } from "./ui";
export function AccessScreen({
  created = false
}: {
  created?: boolean;
}) {
  const router = useRouter();
  const {
    orgId,
    userId
  } = useAuth();
  const {
    signOut
  } = useClerk();
  const {
    api,
    scope,
    locationId,
    selectLocation,
    clear
  } = useApiSession();
  const organizations = useOrganizationList({
    userMemberships: {
      infinite: true
    },
    userInvitations: {
      infinite: true,
      status: "pending"
    }
  });
  const [showPractices, setShowPractices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const context = useQuery({
    queryKey: ["access", scope],
    queryFn: ({
      signal
    }) => api<AccessContext>("/api/v1/me", {
      signal
    }),
    refetchInterval: query => foreground && query.state.data?.onboarding === "pending" ? 15000 : false
  });
  const refreshAccess = context.refetch;
  useEffect(() => {
    const listener = AppState.addEventListener("change", status => {
      setForeground(status === "active");
      if (status === "active") void refreshAccess();
    });
    return () => listener.remove();
  }, [refreshAccess]);
  const switchPractice = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      selectLocation(null);
      clear();
      await organizations.setActive?.({
        organization: id
      });
      setShowPractices(false);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const logout = () => {
    clear();
    void signOut().then(() => router.replace("/sign-in")).catch(e => setError(userMessage(e)));
  };
  const memberships = organizations.userMemberships.data ?? [];
  const invitations = organizations.userInvitations.data ?? [];
  if (showPractices || !orgId && memberships.length) return <Page title="Choose your practice" description="Open a practice you’re a member of." onBack={orgId ? () => setShowPractices(false) : undefined}>{memberships.map(member => <Choice key={member.id} title={member.organization.name} description={member.organization.id === orgId ? "Current practice" : "Tap to continue"} selected={member.organization.id === orgId} onPress={() => void switchPractice(member.organization.id)} />)}{organizations.userMemberships.hasNextPage && <Button secondary busy={organizations.userMemberships.isFetching} onPress={() => void organizations.userMemberships.fetchNext?.()}>Show more practices</Button>}<Feedback error={error} />{invitations.length > 0 && <Button secondary onPress={() => router.push("/join")}>View invitations</Button>}<TextButton onPress={logout}>Sign out</TextButton></Page>;
  if (context.isError) return <Page title="We couldn’t confirm your access" description="Check again before opening your practice."><Feedback error={userMessage(context.error)} /><Button busy={context.isFetching} onPress={() => void context.refetch()}>Try again</Button>{memberships.length > 0 && <Button secondary onPress={() => setShowPractices(true)}>Choose a practice</Button>}<TextButton onPress={logout}>Sign out</TextButton></Page>;
  if (context.isPending || !organizations.isLoaded || organizations.userMemberships.isLoading) return <Page title="Opening your practice…">{null}</Page>;
  const access = context.data;
  if (access.onboarding === "required" || !access.practice) return <Page title="Welcome to CareIQ" description="Create your practice or join the team that invited you.">{invitations.length > 0 && <Button onPress={() => router.push("/join")}>View your invitations</Button>}{access.onboardingOrgId && <Button onPress={() => void switchPractice(access.onboardingOrgId!)}>Continue practice setup</Button>}<Button secondary={invitations.length > 0} onPress={() => router.push("/onboarding")}>Set up a new practice</Button><Button secondary onPress={() => router.push("/join")}>Join a practice</Button><Feedback error={error} /><TextButton onPress={logout}>Sign out</TextButton></Page>;
  if (access.onboarding === "pending" || access.enrollmentStatus !== "active") {
    const removed = ["suspended", "revoked"].includes(access.enrollmentStatus ?? "");
    return <Page title={removed ? "Your access has changed" : "You’ve joined the practice"} description={removed ? "Your practice owner can help confirm your access." : "Your invitation was accepted. Your owner needs to confirm your role and locations."}><View style={styles.card}><Text style={styles.label}>{access.practice.name}</Text><Text style={styles.note}>{removed ? "Access unavailable" : "Waiting for access confirmation"}</Text></View><Button busy={context.isFetching} onPress={() => void context.refetch()}>Check access again</Button>{memberships.length > 1 && <Button secondary onPress={() => setShowPractices(true)}>Switch practice</Button>}<Feedback error={error} /><TextButton onPress={logout}>Sign out</TextButton></Page>;
  }
  if (created) return <Page title="Your practice is ready" description={`${access.practice.name} and its first location have been created.`}><View style={styles.success}><Text style={{
        fontSize: 25
      }}>✓</Text></View><Note>You’re the practice owner. You can invite your team and choose your own location access when you’re ready.</Note><Button onPress={() => router.replace("/")}>Continue to practice</Button>{access.management.members && <Button secondary onPress={() => router.push("/team")}>Invite a teammate</Button>}<TextButton onPress={() => router.push("/team?self=1")}>Set my location access</TextButton></Page>;
  const locations = access.locations.filter(location => canEnterLocation(access, location.id));
  if (!locations.length) return <Page title={access.practice.ownerUserId === userId ? "Choose your location access" : "Location access is needed"} description={access.practice.ownerUserId === userId ? "Your practice is ready. Choose a working location before accessing its workspace." : "Ask your practice owner to assign an active location to you."}><Note>{access.practice.name}</Note>{access.management.members && <><Button onPress={() => router.push("/team?self=1")}>Set my location access</Button><Button secondary onPress={() => router.push("/team")}>Invite and manage teammates</Button></>}<Button secondary busy={context.isFetching} onPress={() => void context.refetch()}>Check access again</Button>{memberships.length > 1 && <TextButton onPress={() => setShowPractices(true)}>Switch practice</TextButton>}<TextButton onPress={logout}>Sign out</TextButton></Page>;
  if (!locationId || !canEnterLocation(access, locationId)) return <Page title="Choose your working location" description={access.practice.name}>{locations.map(location => <Choice key={location.id} title={location.name} description={location.timeZone} onPress={() => selectLocation(location.id)} />)}{access.management.members && <TextButton onPress={() => router.push("/team")}>Manage team access</TextButton>}{memberships.length > 1 && <TextButton onPress={() => setShowPractices(true)}>Switch practice</TextButton>}<TextButton onPress={logout}>Sign out</TextButton></Page>;
  const location = locations.find(l => l.id === locationId)!;
  return <Page title="You’re ready to get started" description={access.practice.name}><View style={styles.card}><Text style={styles.label}>{location.name}</Text><Text style={styles.note}>{location.timeZone}</Text></View><Note>Your account and assigned location are confirmed. Scheduling and patient workflows will use this practice and location.</Note><Button secondary onPress={() => selectLocation(null)}>Change location</Button>{access.management.members && <Button secondary onPress={() => router.push("/team")}>Manage team access</Button>}{memberships.length > 1 && <TextButton onPress={() => setShowPractices(true)}>Switch practice</TextButton>}<TextButton onPress={logout}>Sign out</TextButton></Page>;
}
export function JoinScreen() {
  const {
    user
  } = useUser();
  const router = useRouter();
  const params = useLocalSearchParams<{
    confirm?: string;
  }>();
  const {
    api,
    scope
  } = useApiSession();
  const {
    orgId
  } = useAuth();
  const organizations = useOrganizationList({
    userInvitations: {
      infinite: true,
      status: "pending"
    }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptedOrg, setAcceptedOrg] = useState<string | null>(null);
  const confirmation = invitationConfirmation(params.confirm, orgId);
  const confirmAccess = async (signal?: AbortSignal) => {
    await api("/api/v1/practice/invitations/accept", { method: "POST", body: {}, signal });
    router.replace("/");
  };
  // After Clerk activates the accepted organization, confirm enrollment using a fresh organization JWT.
  useEffect(() => {
    if (confirmation !== "confirm") return;
    let live = true;
    const controller = new AbortController();
    void api("/api/v1/practice/invitations/accept", {
      method: "POST",
      body: {},
      signal: controller.signal
    }).then(() => {
      if (live) router.replace("/");
    }).catch(e => {
      if (live) setError(userMessage(e));
    }).finally(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [confirmation, orgId, api, scope, router]);
  if (confirmation === "confirm") return <Page title={error ? "We couldn’t confirm your practice" : "Confirming your practice…"} description="Your invitation is accepted. Confirming your account with the practice." onBack={() => router.replace("/")}><Feedback error={error} />{error && <Button busy={busy} onPress={() => {
    setBusy(true); setError("");
    void confirmAccess().catch(e => setError(userMessage(e))).finally(() => setBusy(false));
  }}>Confirm practice access again</Button>}<TextButton onPress={() => router.replace("/")}>Back to my practices</TextButton></Page>;
  return <Page title="Join your practice" description={`Invitations for ${user?.primaryEmailAddress?.emailAddress || "your account"}.`} onBack={() => router.replace("/")}>{organizations.userInvitations.isLoading ? <Text style={styles.body}>Checking your invitations…</Text> : organizations.userInvitations.data?.length ? organizations.userInvitations.data.map(invitation => <View key={invitation.id} style={styles.card}><Text style={styles.label}>{invitation.publicOrganizationData.name}</Text><Text style={styles.note}>Your owner will confirm your role and locations after you accept.</Text><Button busy={busy} onPress={() => {
        setBusy(true);
        setError("");
        void invitation.accept().then(async accepted => {
          const id = accepted.publicOrganizationData.id;
          setAcceptedOrg(id);
          if (!organizations.setActive) throw new Error("Your practice connection is still loading. Try again.");
          await organizations.setActive({ organization: id });
          router.replace({ pathname: "/join", params: { confirm: id } });
        }).catch(e => {
          setError(userMessage(e));
          setBusy(false);
        });
      }}>Accept invitation</Button></View>) : <Note>No pending invitations were found for this account. If your invitation was sent to another email, sign out and use that email. Expired or revoked invitations need to be resent by the practice owner.</Note>}{organizations.userInvitations.hasNextPage && <Button secondary busy={organizations.userInvitations.isFetching} onPress={() => void organizations.userInvitations.fetchNext?.()}>Show more invitations</Button>}<Feedback error={confirmation === "wrong-practice" ? "Open the invitation from this account to confirm the correct practice." : error || (organizations.userInvitations.error ? userMessage(organizations.userInvitations.error) : "")} />{acceptedOrg && error && <Button busy={busy} onPress={() => {
      setBusy(true); setError("");
      if (!organizations.setActive) { setError("Your practice connection is still loading. Try again."); setBusy(false); return; }
      void organizations.setActive({ organization: acceptedOrg }).then(() => router.replace({ pathname: "/join", params: { confirm: acceptedOrg } })).catch(e => setError(userMessage(e))).finally(() => setBusy(false));
    }}>Open accepted practice</Button>}<TextButton onPress={() => void organizations.userInvitations.revalidate?.()}>Check again</TextButton><TextButton onPress={() => router.replace("/")}>Back to my practices</TextButton></Page>;
}
