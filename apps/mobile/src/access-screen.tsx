import { Text, View, useI18n, NativeCopyError } from "./i18n";
import { WorkflowScreen } from "./workflow-screen";
import { useAuth, useClerk, useOrganizationList, useUser } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
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
  const { errorMessage, t: tx } = useI18n();
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
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const logout = () => {
    clear();
    void signOut().then(() => router.replace("/sign-in")).catch(e => setError(errorMessage(e)));
  };
  const memberships = organizations.userMemberships.data ?? [];
  const invitations = organizations.userInvitations.data ?? [];
  if (showPractices || !orgId && memberships.length) return <Page title={tx("mobile.copy.choose_your_practice_b5a03b7")} description={tx("mobile.copy.open_a_practice_you_re_a_member_of_e02f7fd")} onBack={orgId ? () => setShowPractices(false) : undefined}>{memberships.map(member => <Choice key={member.id} title={member.organization.name} description={member.organization.id === orgId ? tx("mobile.copy.current_practice_0d5bbd2") : tx("mobile.copy.tap_to_continue_cbaabfd")} selected={member.organization.id === orgId} onPress={() => void switchPractice(member.organization.id)} />)}{organizations.userMemberships.hasNextPage && <Button secondary busy={organizations.userMemberships.isFetching} onPress={() => void organizations.userMemberships.fetchNext?.()}>{tx("mobile.copy.show_more_practices_e75819c")}</Button>}<Feedback error={error} />{invitations.length > 0 && <Button secondary onPress={() => router.push("/join")}>{tx("mobile.copy.view_invitations_9749155")}</Button>}<TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  if (context.isError) return <Page title={tx("mobile.copy.we_couldn_t_confirm_your_access_d8f2762")} description={tx("mobile.copy.check_again_before_opening_your_practice_17b854a")}><Feedback error={errorMessage(context.error)} /><Button busy={context.isFetching} onPress={() => void context.refetch()}>{tx("mobile.copy.try_again_042c862")}</Button>{memberships.length > 0 && <Button secondary onPress={() => setShowPractices(true)}>{tx("mobile.copy.choose_a_practice_155a4fb")}</Button>}<TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  if (context.isPending || !organizations.isLoaded || organizations.userMemberships.isLoading) return <Page title={tx("mobile.copy.opening_your_practice_7458ad4")}>{null}</Page>;
  const access = context.data;
  if (access.onboarding === "required" || !access.practice) return <Page title={tx("mobile.copy.welcome_to_careiq_dbffa1a")} description={tx("mobile.copy.create_your_practice_or_join_the_team_that_invited_y_422d7b5")}>{invitations.length > 0 && <Button onPress={() => router.push("/join")}>{tx("mobile.copy.view_your_invitations_0892d4e")}</Button>}{access.onboardingOrgId && <Button onPress={() => void switchPractice(access.onboardingOrgId!)}>{tx("mobile.copy.continue_practice_setup_865fb7c")}</Button>}<Button secondary={invitations.length > 0} onPress={() => router.push("/onboarding")}>{tx("mobile.copy.set_up_a_new_practice_62f661b")}</Button><Button secondary onPress={() => router.push("/join")}>{tx("mobile.copy.join_a_practice_a805a4f")}</Button><Feedback error={error} /><TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  if (access.onboarding === "pending" || access.enrollmentStatus !== "active") {
    const removed = ["suspended", "revoked"].includes(access.enrollmentStatus ?? "");
    return <Page title={removed ? tx("mobile.copy.your_access_has_changed_0464d28") : tx("mobile.copy.you_ve_joined_the_practice_ef915df")} description={removed ? tx("mobile.copy.your_practice_owner_can_help_confirm_your_access_1836e5c") : tx("mobile.copy.your_invitation_was_accepted_your_owner_needs_to_con_c93cf55")}><View style={styles.card}><Text style={styles.label}>{access.practice.name}</Text><Text style={styles.note}>{removed ? tx("mobile.copy.access_unavailable_bc1b06f") : tx("mobile.copy.waiting_for_access_confirmation_77a133e")}</Text></View><Button busy={context.isFetching} onPress={() => void context.refetch()}>{tx("mobile.copy.check_access_again_ab00d01")}</Button>{memberships.length > 1 && <Button secondary onPress={() => setShowPractices(true)}>{tx("mobile.copy.switch_practice_29938f9")}</Button>}<Feedback error={error} /><TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  }
  if (created) return <Page title={tx("mobile.copy.your_practice_is_ready_55f31d7")} description={tx("mobile.copy.value0_and_its_first_location_have_been_created_9463f29", { value0: access.practice.name })}><View style={styles.success}><Text style={{
        fontSize: 25
      }}>✓</Text></View><Note>{tx("mobile.copy.you_re_the_practice_owner_you_can_invite_your_team_a_ae8634d")}</Note><Button onPress={() => router.replace("/")}>{tx("mobile.copy.continue_to_practice_91f5815")}</Button>{access.management.members && <Button secondary onPress={() => router.push("/team")}>{tx("mobile.copy.invite_a_teammate_bb56a15")}</Button>}<TextButton onPress={() => router.push("/team?self=1")}>{tx("mobile.copy.set_my_location_access_17a4a93")}</TextButton></Page>;
  const locations = access.locations.filter(location => canEnterLocation(access, location.id));
  if (!locations.length) return <Page title={access.practice.ownerUserId === userId ? tx("mobile.copy.choose_your_location_access_fbe14ba") : tx("mobile.copy.location_access_is_needed_e300d00")} description={access.practice.ownerUserId === userId ? tx("mobile.copy.your_practice_is_ready_choose_a_working_location_bef_1f0fb73") : tx("mobile.copy.ask_your_practice_owner_to_assign_an_active_location_f373eca")}><Note>{access.practice.name}</Note>{access.management.members && <><Button onPress={() => router.push("/team?self=1")}>{tx("mobile.copy.set_my_location_access_17a4a93")}</Button><Button secondary onPress={() => router.push("/team")}>{tx("mobile.copy.invite_and_manage_teammates_1ec85ba")}</Button></>}<Button secondary busy={context.isFetching} onPress={() => void context.refetch()}>{tx("mobile.copy.check_access_again_ab00d01")}</Button>{memberships.length > 1 && <TextButton onPress={() => setShowPractices(true)}>{tx("mobile.copy.switch_practice_29938f9")}</TextButton>}<TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  if (!locationId || !canEnterLocation(access, locationId)) return <Page title={tx("mobile.copy.choose_your_working_location_d490f58")} description={access.practice.name}>{locations.map(location => <Choice key={location.id} title={location.name} description={location.timeZone} onPress={() => selectLocation(location.id)} />)}{access.management.members && <TextButton onPress={() => router.push("/team")}>{tx("mobile.copy.manage_team_access_db8b531")}</TextButton>}{memberships.length > 1 && <TextButton onPress={() => setShowPractices(true)}>{tx("mobile.copy.switch_practice_29938f9")}</TextButton>}<TextButton onPress={logout}>{tx("mobile.copy.sign_out_dc1649a")}</TextButton></Page>;
  const location = locations.find(l => l.id === locationId)!;
  return <WorkflowScreen practiceName={access.practice.name} locationName={location.name} onChangeLocation={() => selectLocation(null)} />;
}
export function JoinScreen() {
  const { errorMessage, t: tx } = useI18n();
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
      if (live) setError(errorMessage(e));
    }).finally(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [confirmation, orgId, api, scope, router, errorMessage]);
  if (confirmation === "confirm") return <Page title={error ? tx("mobile.copy.we_couldn_t_confirm_your_practice_6410554") : tx("mobile.copy.confirming_your_practice_05e8bd7")} description={tx("mobile.copy.your_invitation_is_accepted_confirming_your_account__988790d")} onBack={() => router.replace("/")}><Feedback error={error} />{error && <Button busy={busy} onPress={() => {
    setBusy(true); setError("");
    void confirmAccess().catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
  }}>{tx("mobile.copy.confirm_practice_access_again_b25255a")}</Button>}<TextButton onPress={() => router.replace("/")}>{tx("mobile.copy.back_to_my_practices_0ab2796")}</TextButton></Page>;
  return <Page title={tx("mobile.copy.join_your_practice_19966f6")} description={tx("mobile.copy.invitations_for_value0_84ed33c", { value0: user?.primaryEmailAddress?.emailAddress || tx("mobile.copy.your_account_637395c") })} onBack={() => router.replace("/")}>{organizations.userInvitations.isLoading ? <Text style={styles.body}>{tx("mobile.copy.checking_your_invitations_54399c4")}</Text> : organizations.userInvitations.data?.length ? organizations.userInvitations.data.map(invitation => <View key={invitation.id} style={styles.card}><Text style={styles.label}>{invitation.publicOrganizationData.name}</Text><Text style={styles.note}>{tx("mobile.copy.your_owner_will_confirm_your_role_and_locations_afte_b4fd22a")}</Text><Button busy={busy} onPress={() => {
        setBusy(true);
        setError("");
        void invitation.accept().then(async accepted => {
          const id = accepted.publicOrganizationData.id;
          setAcceptedOrg(id);
          if (!organizations.setActive) throw new NativeCopyError("mobile.copy.your_practice_connection_is_still_loading_try_again_0a43cfa");
          await organizations.setActive({ organization: id });
          router.replace({ pathname: "/join", params: { confirm: id } });
        }).catch(e => {
          setError(errorMessage(e));
          setBusy(false);
        });
      }}>{tx("mobile.copy.accept_invitation_0b918ca")}</Button></View>) : <Note>{tx("mobile.copy.no_pending_invitations_were_found_for_this_account_i_64ac518")}</Note>}{organizations.userInvitations.hasNextPage && <Button secondary busy={organizations.userInvitations.isFetching} onPress={() => void organizations.userInvitations.fetchNext?.()}>{tx("mobile.copy.show_more_invitations_1efe88b")}</Button>}<Feedback error={confirmation === "wrong-practice" ? "Open the invitation from this account to confirm the correct practice." : error || (organizations.userInvitations.error ? errorMessage(organizations.userInvitations.error) : "")} />{acceptedOrg && error && <Button busy={busy} onPress={() => {
      setBusy(true); setError("");
      if (!organizations.setActive) { setError("mobile.copy.your_practice_connection_is_still_loading_try_again_0a43cfa"); setBusy(false); return; }
      void organizations.setActive({ organization: acceptedOrg }).then(() => router.replace({ pathname: "/join", params: { confirm: acceptedOrg } })).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>{tx("mobile.copy.open_accepted_practice_6b2f054")}</Button>}<TextButton onPress={() => void organizations.userInvitations.revalidate?.()}>{tx("mobile.copy.check_again_e185048")}</TextButton><TextButton onPress={() => router.replace("/")}>{tx("mobile.copy.back_to_my_practices_0ab2796")}</TextButton></Page>;
}
