"use client";

import { useAuth, useOrganizationList, UserButton } from "@clerk/nextjs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api/client";
import { getAccessContext, resolveClinicalScope, type AccessContext } from "@/lib/api/practice";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { PracticeSettings } from "./PracticeSettings";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "CareIQ could not complete this request. Please try again.";

/** Only existing memberships are selectable. Practice creation goes through CareIQ. */
export function PracticePicker() {
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="cq-practice-picker">
    <label className="cq-field">Your practice<select className="cq-input" value={orgId ?? ""} disabled={!isLoaded || busy} onChange={async event => {
      const organization = event.target.value;
      if (!organization || !setActive) return;
      setBusy(true); setError("");
      try { await setActive({ organization }); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
    }}><option value="" disabled>Choose your practice</option>{userMemberships.data?.map(membership => <option key={membership.id} value={membership.organization.id}>{membership.organization.name}</option>)}</select></label>
    {userMemberships.hasNextPage && <button className="cq-button" onClick={() => void userMemberships.fetchNext()}>More practices</button>}
    {(error || userMemberships.error) && <p className="cq-error" role="alert">{error || "Unable to load your practices. Refresh to try again."}</p>}
  </div>;
}

function Invitations() {
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({ userInvitations: { infinite: true, status: "pending", pageSize: 50 }, userMemberships: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  return <section className="cq-setup-section" aria-label="Practice invitations">
    <h2>Your invitations</h2><p>Sign in with the email address that received your invitation.</p>
    {!isLoaded || userInvitations.isLoading ? <p role="status">Checking invitations…</p> : !userInvitations.data?.length && <p>No pending invitations for this account.</p>}
    {userInvitations.data?.map(invitation => <div className="cq-team-row" key={invitation.id}><span>{invitation.publicOrganizationData.name}</span><button className="cq-button cq-primary" disabled={busy} onClick={async () => {
      if (!setActive) return;
      setBusy(true); setError("");
      try {
        const signal = lifetime.current?.signal;
        signal?.throwIfAborted();
        await invitation.accept();
        signal?.throwIfAborted();
        await userMemberships.revalidate?.();
        signal?.throwIfAborted();
        await setActive({ organization: invitation.publicOrganizationData.id });
      } catch (cause) { if (!lifetime.current?.signal.aborted) setError(errorMessage(cause)); } finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
    }}>Accept invitation</button></div>)}
    {userInvitations.hasNextPage && <button className="cq-button" disabled={busy} onClick={() => void userInvitations.fetchNext()}>More invitations</button>}
    {(error || userInvitations.error) && <p className="cq-error" role="alert">{error || "Unable to check invitations. Refresh to try again."}</p>}
  </section>;
}

function CreatePractice() {
  const { getToken } = useAuth();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submission] = useState(() => createSubmissionAttempt());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  return <form className="cq-setup-section" onSubmit={async event => {
    event.preventDefault();
    if (busy || !setActive) return;
    const fields = new FormData(event.currentTarget);
    const input = { name: String(fields.get("name")).trim(), location: { name: String(fields.get("location")).trim(), timeZone: String(fields.get("timeZone")).trim(), address: String(fields.get("address")).trim() || undefined } };
    setBusy(true); setError("");
    try {
      await submission.submit(input, async key => {
        const signal = lifetime.current?.signal;
        const token = await getToken({ skipCache: true });
        signal?.throwIfAborted();
        if (!token) throw new Error("Please sign in again.");
        const { data } = await apiRequest<{ data: { orgId: string } }>("/api/v1/onboarding", token, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input), signal });
        signal?.throwIfAborted();
        await userMemberships.revalidate?.();
        signal?.throwIfAborted();
        await setActive({ organization: data.orgId });
      });
    } catch (cause) { if (!lifetime.current?.signal.aborted) setError(errorMessage(cause)); } finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }}>
    <h2>Create your practice</h2><p>Start with your first location. You can add locations and invite your team in settings.</p>
    <fieldset className="cq-setup-fields" disabled={busy}>
      <label className="cq-field">Practice name<input name="name" className="cq-input" required maxLength={120} autoComplete="organization" /></label>
      <label className="cq-field">First location name<input name="location" className="cq-input" required maxLength={120} placeholder="Downtown office" /></label>
      <label className="cq-field">Time zone<input name="timeZone" className="cq-input" required maxLength={80} defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} placeholder="America/Los_Angeles" /></label>
      <label className="cq-field">Address (optional)<input name="address" className="cq-input" maxLength={500} autoComplete="street-address" /></label>
      <label className="cq-check"><input type="checkbox" required />I’m authorized to set up and manage this practice.</label>
      <button className="cq-button cq-primary" type="submit">{busy ? "Setting up your practice…" : "Create practice and location"}</button>
    </fieldset>
    {error && <p className="cq-error" role="alert">{error}</p>}
  </form>;
}

export function PracticeAccess({ orgId, children }: { orgId: string | null | undefined; children: (context: AccessContext, locationId: string | undefined, onAccessDenied: () => void) => ReactNode }) {
  const { getToken } = useAuth();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [context, setContext] = useState<AccessContext | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [settings, setSettings] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [hidden, setHidden] = useState(false);
  const alive = useRef(true);

  function refresh() { setContext(null); setAttempt(value => value + 1); }

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true });
        if (!token) throw new Error("Your session has expired. Please sign in again.");
        const value = await getAccessContext(token, controller.signal);
        if (controller.signal.aborted) return;
        if ((value.orgId ?? null) !== (orgId ?? null)) throw new Error("Your practice changed. Please try again.");
        setContext(value); setError("");
      } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    })();
    return () => controller.abort();
  }, [getToken, orgId, attempt, hidden]);

  useEffect(() => {
    // Unmount records and drafts while hidden; obtain fresh authorization on return.
    const conceal = () => { setHidden(true); setContext(null); };
    const reveal = () => { if (document.visibilityState === "visible") { setContext(null); setHidden(false); setAttempt(value => value + 1); } };
    const visibility = () => document.visibilityState === "hidden" ? conceal() : reveal();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", conceal);
    window.addEventListener("focus", reveal);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", conceal); window.removeEventListener("focus", reveal); };
  }, []);

  async function completeInvitation() {
    setJoining(true); setError("");
    try {
      const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true });
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      if (!alive.current) return;
      await apiRequest("/api/v1/practice/invitations/accept", token, { method: "POST", body: "{}" });
      if (alive.current) refresh();
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); } finally { if (alive.current) setJoining(false); }
  }

  async function resumePractice(organization: string) {
    if (!setActive) return;
    setJoining(true); setError("");
    try {
      await userMemberships.revalidate?.();
      if (alive.current) await setActive({ organization });
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); } finally { if (alive.current) setJoining(false); }
  }

  if (hidden) return <main className="cq-welcome"><h1>Your workspace is paused.</h1><p>Return to this window to check access and reopen your workspace.</p></main>;
  if (!context) return <main className="cq-welcome"><h1>{error ? "We couldn’t open your practice." : "Checking your practice access…"}</h1>{error ? <><p className="cq-error" role="alert">{error}</p><button className="cq-button" onClick={refresh}>Try again</button><PracticePicker /><UserButton /></> : <p role="status">One moment while we check your membership.</p>}</main>;
  if (!context.practice || context.onboarding === "required") return <main className="cq-setup"><header className="cq-heading"><div><h1>Welcome to CareIQ.</h1><p>Join your team or set up a new practice.</p></div><UserButton /></header><PracticePicker />{context.onboardingOrgId && <button className="cq-button cq-primary" disabled={joining} onClick={() => void resumePractice(context.onboardingOrgId!)}>Open your newly created practice</button>}{error && <p className="cq-error" role="alert">{error}</p>}<Invitations />{!context.onboardingOrgId && <CreatePractice />}</main>;
  const manage = context.management?.locations || context.management?.members;
  if (context.onboarding === "pending" || (context.practice.authorizationMode === "location" && context.enrollmentStatus !== "active")) {
    return <main className="cq-setup"><h1>Your practice access</h1><PracticePicker /><p>Your membership status is {context.enrollmentStatus?.replaceAll("_", " ") || "awaiting confirmation"}. Your practice owner confirms your role and locations before you can open records.</p>
      {!['active', 'suspended', 'revoked'].includes(context.enrollmentStatus ?? '') && <button className="cq-button cq-primary" disabled={joining} onClick={() => void completeInvitation()}>{joining ? "Confirming…" : "Finish joining this practice"}</button>}
      <button className="cq-button" onClick={refresh}>Check access again</button>{error && <p className="cq-error" role="alert">{error}</p>}<Invitations /><UserButton /></main>;
  }
  const selected = context.locations.find(location => location.id === locationId);
  const scope = resolveClinicalScope(context, locationId);
  return <>
    <div className="cq-access-toolbar">
      {context.practice.authorizationMode === "location" && <label className="cq-field">Working location<select className="cq-input" value={selected?.id ?? ""} onChange={event => setLocationId(event.target.value)}><option value="">Choose a location</option>{context.locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}
      {manage && <button className="cq-button" onClick={() => { setInvitesOpen(false); setSettings(value => !value); }}>{settings ? "Back to workspace" : "Practice settings"}</button>}
      <button className="cq-button" onClick={() => { setSettings(false); setInvitesOpen(value => !value); }}>{invitesOpen ? "Back to workspace" : "Your invitations"}</button>
      <button className="cq-button" onClick={refresh}>Refresh access</button>
    </div>
    {invitesOpen ? <main className="cq-setup"><h1>Join another practice</h1><Invitations /></main> : settings && manage ? <PracticeSettings key={context.practice.id} context={context} onClose={() => { setSettings(false); refresh(); }} /> : scope.kind === "blocked" ? <main className="cq-setup"><h1>{context.practice.name}</h1><PracticePicker /><p>{context.locations.length ? "Choose an active location to open patients and appointments. If access is unavailable, ask your practice owner to review your membership." : "No active location assignments yet. The practice owner can assign locations in settings."}</p>{manage && <p>Start in practice settings to add locations, invite employees, and confirm their access.</p>}<UserButton /></main> : children(context, scope.kind === "location" ? scope.locationId : undefined, refresh)}
  </>;
}
