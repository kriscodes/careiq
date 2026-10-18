import { Text, View, useI18n, NativeCopyError } from "./i18n";
import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";

import { ApiError } from "./api";
import { type Admin } from "./contracts";
import { useApiSession } from "./session";
import { styles } from "./styles";
import { Button, Choice, Feedback, Field, Note, Page, TextButton } from "./ui";

export function TeamScreen() {
  const { errorMessage, t: tx } = useI18n();
  const roleLabel = (role:string) => tx(role === "org:admin" ? "mobile.role.admin" : role === "org:member" ? "mobile.role.member" : "mobile.status.other");
  const router = useRouter();
  const {
    userId
  } = useAuth();
  const {
    api,
    scope
  } = useApiSession();
  const queries = useQueryClient();
  const params = useLocalSearchParams<{
    self?: string;
  }>();
  const admin = useQuery({
    queryKey: ["admin", scope],
    queryFn: ({
      signal
    }) => api<Admin>("/api/v1/practice/admin", {
      signal
    })
  });
  const [mode, setMode] = useState<"list" | "invite" | "member">(params.self === "1" ? "member" : "list");
  const [selectedUser, setSelectedUser] = useState<string | null>(params.self === "1" ? userId ?? null : null);
  const [email, setEmail] = useState("");
  const [chosenRole, setRole] = useState<string | null>(null);
  const [chosenLocations, setLocationIds] = useState<string[] | null>(null);
  const [invitationPending, setInvitationPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const invitationAttempt = useRef<{
    key: string;
    body: {
      email: string;
      role: string;
      locationIds: string[];
    };
  } | null>(null);
  const own = selectedUser === userId;
  const member = admin.data?.members.find(m => m.userId === selectedUser);
  const role = chosenRole ?? member?.role ?? "org:member";
  const locationIds = chosenLocations ?? member?.locationIds ?? [];
  const openMember = (id: string) => {
    const target = admin.data?.members.find(m => m.userId === id);
    if (!target?.role) return;
    setSelectedUser(id);
    setRole(target.role);
    setLocationIds(target.status === "pending_assignment" ? target.proposedLocationIds : target.locationIds);
    setMode("member");
    setMessage("");
    setError("");
  };
  const toggle = (id: string) => {
    if (invitationAttempt.current) return;
    setLocationIds(current => {
      const previous = current ?? member?.locationIds ?? [];
      return previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id];
    });
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "invite") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new NativeCopyError("mobile.copy.enter_a_valid_teammate_email_fe9e402");
        if (!invitationAttempt.current) {
          invitationAttempt.current = {
            key: randomUUID(),
            body: {
              email: email.trim(),
              role,
              locationIds
            }
          };
          setInvitationPending(true);
        }
        await api("/api/v1/practice/invitations", {
          method: "POST",
          body: invitationAttempt.current.body,
          key: invitationAttempt.current.key
        });
        setMessage("mobile.copy.invitation_sent_after_they_accept_confirm_their_acce_89bef55");
        invitationAttempt.current = null;
        setInvitationPending(false);
        setEmail("");
        setMode("list");
      } else {
        if (!member?.role || !selectedUser) throw new NativeCopyError("mobile.copy.choose_a_current_member_first_c6498ea");
        await api(`/api/v1/practice/members/${encodeURIComponent(selectedUser)}/activate`, {
          method: "POST",
          body: {
            role: own ? member.role : role,
            locationIds
          }
        });
        setMessage(own ? "mobile.copy.your_location_access_is_confirmed_a83966e" : "mobile.copy.teammate_access_confirmed_b93ca67");
        if (own) {
          await queries.invalidateQueries({
            queryKey: ["access"]
          });
          router.replace("/");
        } else setMode("list");
      }
      await admin.refetch();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) {
        invitationAttempt.current = null;
        setInvitationPending(false);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (admin.isPending) return <Page title={tx("mobile.copy.checking_team_access_7068bbe")} onBack={() => router.replace("/")}>{null}</Page>;
  if (admin.isError) return <Page title={tx("mobile.copy.team_management_is_unavailable_9b693f2")} description={tx("mobile.copy.your_practice_owner_manages_invitations_and_access_9971b71")} onBack={() => router.replace("/")}><Feedback error={errorMessage(admin.error)} /><Button onPress={() => void admin.refetch()}>{tx("mobile.copy.check_again_e185048")}</Button></Page>;
  const data = admin.data;
  const activeLocations = data.locations.filter(l => l.status === "active");
  if (mode === "invite" || mode === "member") return <Page title={mode === "invite" ? tx("mobile.copy.invite_a_teammate_bb56a15") : own ? tx("mobile.copy.set_your_location_access_926643f") : tx("mobile.copy.confirm_teammate_access_a7b76c8")} description={mode === "invite" ? tx("mobile.copy.send_an_invitation_to_their_own_work_email_d165162") : own ? tx("mobile.copy.choose_where_you_ll_work_your_owner_role_stays_the_s_6c51e0b") : member?.displayName || member?.email || tx("mobile.copy.choose_their_role_and_locations_before_granting_acce_2f8abbb")} onBack={() => {
    if (invitationAttempt.current) return;
    setMode("list");
    setError("");
  }}>
    {mode === "invite" && <Field label={tx("mobile.copy.teammate_email_4497939")} value={email} onChangeText={setEmail} editable={!invitationPending} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" placeholder="sam@practice.com" />}
    {!own && <View style={{
      gap: 8
    }}><Text style={styles.label}>{tx("mobile.copy.role_c3f104d")}</Text>{data.allowedRoles.map(option => <Choice key={option} title={roleLabel(option)} selected={role === option} onPress={() => {
        if (!invitationAttempt.current) setRole(option);
      }} />)}</View>}
    <View style={{
      gap: 8
    }}><Text style={styles.label}>{tx("mobile.copy.location_access_3b68001")}</Text>{activeLocations.length ? activeLocations.map(location => <Choice key={location.id} title={location.name} description={location.timeZone} selected={locationIds.includes(location.id)} onPress={() => toggle(location.id)} />) : <Note>{tx("mobile.copy.no_active_locations_are_available_your_owner_can_add_a67d391")}</Note>}</View><Note>{mode === "invite" ? tx("mobile.copy.these_are_proposed_locations_accepting_an_invitation_0968f52") : locationIds.length ? tx("mobile.copy.only_the_selected_active_locations_will_be_available_8a6fb50") : tx("mobile.copy.with_no_locations_selected_this_person_won_t_have_a__97de1f2")}</Note><Feedback error={error} message={message} />{invitationPending && <Note>{tx("mobile.copy.your_invitation_is_still_being_confirmed_retry_with__f672508")}</Note>}<Button busy={busy} onPress={() => void submit()}>{mode === "invite" ? tx("mobile.copy.send_invitation_abb6cb2") : tx("mobile.copy.confirm_access_6832c99")}</Button></Page>;
  return <Page title={tx("mobile.copy.your_team_80b3016")} description={tx("mobile.copy.invite_teammates_and_confirm_access_after_they_join_0c3e1b1")} onBack={() => router.replace("/")}><Feedback error={error} message={message} /><Button onPress={() => {
      setMode("invite");
      setEmail("");
      setRole(data.allowedRoles.includes("org:member") ? "org:member" : data.allowedRoles[0]);
      setLocationIds([]);
      setMessage("");
      setError("");
    }}>{tx("mobile.copy.invite_a_teammate_bb56a15")}</Button><TextButton onPress={() => {
      if (userId) openMember(userId);
    }}>{tx("mobile.copy.set_my_location_access_17a4a93")}</TextButton><Text accessibilityRole="header" style={styles.label}>{tx("mobile.copy.practice_members_071e19f")}</Text>{data.members.map(person => <View key={person.userId} style={styles.card}><Text style={styles.label}>{person.displayName || person.email || (person.isOwner ? tx("mobile.copy.practice_owner_c2c115e") : tx("mobile.copy.teammate_39811b9"))}</Text><Text style={styles.note}>{person.role ? roleLabel(person.role) : tx("mobile.copy.membership_unavailable_853a6f1")} · {tx(`mobile.status.${person.status}`)}</Text>{person.role && <Button secondary onPress={() => openMember(person.userId)}>{person.userId === userId ? tx("mobile.copy.edit_my_location_access_bcb835a") : person.status === "pending_assignment" ? tx("mobile.copy.confirm_access_6832c99") : tx("mobile.copy.edit_access_e381a89")}</Button>}</View>)}{data.invitations.length > 0 && <Text accessibilityRole="header" style={styles.label}>{tx("mobile.copy.invitations_9b69a35")}</Text>}{data.invitations.map(invitation => <View key={invitation.id} style={styles.card}><Text style={styles.label}>{invitation.email}</Text><Text style={styles.note}>{roleLabel(invitation.role)} · {tx(`mobile.status.${invitation.status}`)}</Text></View>)}<Button secondary busy={admin.isFetching} onPress={() => void admin.refetch()}>{tx("mobile.copy.refresh_team_e4d3b8b")}</Button></Page>;
}
