import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, userMessage } from "./api";
import { type Admin } from "./contracts";
import { useApiSession } from "./session";
import { styles } from "./styles";
import { Button, Choice, Feedback, Field, Note, Page, TextButton } from "./ui";
const roleLabel = (role: string) => role === "org:admin" ? "Administrator" : role === "org:member" ? "Team member" : role.replace(/^org:/, "").replaceAll("_", " ");
export function TeamScreen() {
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
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("Enter a valid teammate email.");
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
        setMessage("Invitation sent. After they accept, confirm their access here.");
        invitationAttempt.current = null;
        setInvitationPending(false);
        setEmail("");
        setMode("list");
      } else {
        if (!member?.role || !selectedUser) throw new Error("Choose a current member first.");
        await api(`/api/v1/practice/members/${encodeURIComponent(selectedUser)}/activate`, {
          method: "POST",
          body: {
            role: own ? member.role : role,
            locationIds
          }
        });
        setMessage(own ? "Your location access is confirmed." : "Teammate access confirmed.");
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
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (admin.isPending) return <Page title="Checking team access…" onBack={() => router.replace("/")}>{null}</Page>;
  if (admin.isError) return <Page title="Team management is unavailable" description="Your practice owner manages invitations and access." onBack={() => router.replace("/")}><Feedback error={userMessage(admin.error)} /><Button onPress={() => void admin.refetch()}>Check again</Button></Page>;
  const data = admin.data;
  const activeLocations = data.locations.filter(l => l.status === "active");
  if (mode === "invite" || mode === "member") return <Page title={mode === "invite" ? "Invite a teammate" : own ? "Set your location access" : "Confirm teammate access"} description={mode === "invite" ? "Send an invitation to their own work email." : own ? "Choose where you’ll work. Your owner role stays the same." : member?.displayName || member?.email || "Choose their role and locations before granting access."} onBack={() => {
    if (invitationAttempt.current) return;
    setMode("list");
    setError("");
  }}>
    {mode === "invite" && <Field label="Teammate email" value={email} onChangeText={setEmail} editable={!invitationPending} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" placeholder="sam@practice.com" />}
    {!own && <View style={{
      gap: 8
    }}><Text style={styles.label}>Role</Text>{data.allowedRoles.map(option => <Choice key={option} title={roleLabel(option)} selected={role === option} onPress={() => {
        if (!invitationAttempt.current) setRole(option);
      }} />)}</View>}
    <View style={{
      gap: 8
    }}><Text style={styles.label}>Location access</Text>{activeLocations.length ? activeLocations.map(location => <Choice key={location.id} title={location.name} description={location.timeZone} selected={locationIds.includes(location.id)} onPress={() => toggle(location.id)} />) : <Note>No active locations are available. Your owner can add one first.</Note>}</View><Note>{mode === "invite" ? "These are proposed locations. Accepting an invitation does not grant clinical access until you confirm the member’s role and locations." : locationIds.length ? "Only the selected active locations will be available." : "With no locations selected, this person won’t have a clinical workspace."}</Note><Feedback error={error} message={message} />{invitationPending && <Note>Your invitation is still being confirmed. Retry with these same details.</Note>}<Button busy={busy} onPress={() => void submit()}>{mode === "invite" ? "Send invitation" : "Confirm access"}</Button></Page>;
  return <Page title="Your team" description="Invite teammates and confirm access after they join." onBack={() => router.replace("/")}><Feedback error={error} message={message} /><Button onPress={() => {
      setMode("invite");
      setEmail("");
      setRole(data.allowedRoles.includes("org:member") ? "org:member" : data.allowedRoles[0]);
      setLocationIds([]);
      setMessage("");
      setError("");
    }}>Invite a teammate</Button><TextButton onPress={() => {
      if (userId) openMember(userId);
    }}>Set my location access</TextButton><Text accessibilityRole="header" style={styles.label}>Practice members</Text>{data.members.map(person => <View key={person.userId} style={styles.card}><Text style={styles.label}>{person.displayName || person.email || (person.isOwner ? "Practice owner" : "Teammate")}</Text><Text style={styles.note}>{person.role ? roleLabel(person.role) : "Membership unavailable"} · {person.status.replaceAll("_", " ")}</Text>{person.role && <Button secondary onPress={() => openMember(person.userId)}>{person.userId === userId ? "Edit my location access" : person.status === "pending_assignment" ? "Confirm access" : "Edit access"}</Button>}</View>)}{data.invitations.length > 0 && <Text accessibilityRole="header" style={styles.label}>Invitations</Text>}{data.invitations.map(invitation => <View key={invitation.id} style={styles.card}><Text style={styles.label}>{invitation.email}</Text><Text style={styles.note}>{roleLabel(invitation.role)} · {invitation.status.replaceAll("_", " ")}</Text></View>)}<Button secondary busy={admin.isFetching} onPress={() => void admin.refetch()}>Refresh team</Button></Page>;
}
