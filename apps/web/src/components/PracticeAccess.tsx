"use client";

import { UserButton, useAuth, useOrganizationList, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { getAccessContext, resolveClinicalScope, type AccessContext } from "@/lib/api/practice";
import { authErrorMessage } from "@/lib/auth-errors";
import { sessionTaskDestination } from "@/lib/auth-intent";
import { invitationEmailMatches, timeZoneLabel } from "@/lib/access-flow";
import { PracticeSettings } from "./PracticeSettings";
import { PracticeOnboarding } from "./access/PracticeOnboarding";
import { PracticeManagement } from "./access/PracticeManagement";
import { SignOutButton } from "./access/SignOutButton";
import { AccessError, AccessHeading, AccessShell, AccessStatus } from "./access/AccessShell";

const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : authErrorMessage(error);
export type AccessView = "practices" | "entry" | "onboarding" | "invitations" | "settings" | "invite" | "owneraccess";

/** Existing memberships only. Creation always goes through the CareIQ eligibility gate. */
export function PracticePicker() {
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="cq-practice-picker"><label className="cq-field">Your practice<select className="cq-input" value={orgId ?? ""} disabled={!isLoaded || busy} onChange={async event => { const organization = event.target.value; if (!organization || !setActive) return; setBusy(true); setError(""); try { await setActive({ organization }); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}><option value="" disabled>Choose your practice</option>{userMemberships.data?.map(membership => <option key={membership.id} value={membership.organization.id}>{membership.organization.name}</option>)}</select></label>{userMemberships.hasNextPage && <button className="cq-button" onClick={() => void userMemberships.fetchNext()}>More practices</button>}{(error || userMemberships.error) && <p className="cq-error" role="alert">{error || "Unable to load practices. Refresh to try again."}</p>}</div>;
}

function PracticeEntry({ onCreate, onInvitations }: { onCreate: () => void; onInvitations: () => void }) {
  const { setActive, isLoaded, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
 
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <AccessShell account={<UserButton />}><AccessHeading title="Choose your practice">Continue with one of the practices you belong to, or set up a new practice.</AccessHeading><div className="cq-a-options">{!isLoaded || userMemberships.isLoading ? <p role="status">Checking your practices…</p> : userMemberships.data?.length ? userMemberships.data.map(membership => <button className="cq-a-choice" key={membership.id} disabled={busy} onClick={async () => { if (!setActive) return; setBusy(true); setError(""); try { await setActive({ organization: membership.organization.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination("/") : "/")); } }); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}><span><strong>{membership.organization.name}</strong><small>{membership.role.replace(/^org:/, "").replaceAll("_", " ")}</small></span><span aria-hidden="true">→</span></button>) : <div className="cq-a-note">You don’t belong to a practice yet. Use an invitation from your team, or set up a practice if you’re an approved owner.</div>}</div><AccessError>{error || (userMemberships.error ? "We couldn’t check your practices. Try again." : "")}</AccessError>{userMemberships.error && <button className="cq-a-secondary" onClick={() => void userMemberships.revalidate?.().catch(cause => setError(errorMessage(cause)))}>Try again</button>}{userMemberships.hasNextPage && <button className="cq-a-link" onClick={() => void userMemberships.fetchNext()}>More practices</button>}<div className="cq-a-actions"><button className="cq-a-primary" onClick={onInvitations}>View my invitations</button><button className="cq-a-secondary" onClick={onCreate}>Set up a new practice</button><SignOutButton /></div></AccessShell>;
}

function Invitations({ onBack }: { onBack: () => void }) {
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({ userInvitations: { infinite: true, status: "pending", pageSize: 50 }, userMemberships: true });
  const { user } = useUser();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  return <AccessShell account={<UserButton />}><button className="cq-a-link cq-a-back" disabled={busy} onClick={onBack}>← Back to your practices</button><AccessHeading title="Join your team" mark="users">Sign in with the email address that received your invitation. Your practice owner confirms your role and locations after you join.</AccessHeading><p className="cq-a-account">{user?.primaryEmailAddress?.emailAddress}</p><div className="cq-a-options">{!isLoaded || userInvitations.isLoading ? <p role="status">Checking invitations…</p> : !userInvitations.data?.length && <div className="cq-a-note">No pending invitations for this account. If your invitation has expired or was revoked, ask your practice owner to send a new one.</div>}{userInvitations.data?.map(invitation => <section className="cq-a-summary" key={invitation.id}><section><h2>Invitation for {invitation.emailAddress}</h2><strong>{invitation.publicOrganizationData.name}</strong><button className="cq-a-primary" disabled={busy} style={{ marginTop: 20 }} onClick={async () => {
    if (!setActive) return;
    const verified = user?.emailAddresses.filter(address => address.verification.status === "verified").map(address => address.emailAddress) || [];
    if (!invitationEmailMatches(verified, invitation.emailAddress)) { setError(`Use your invited email: ${invitation.emailAddress}. Verify that address or sign in with another account.`); return; }
    setBusy(true); setError("");
    try { const signal = lifetime.current?.signal; signal?.throwIfAborted(); await invitation.accept(); signal?.throwIfAborted(); await userMemberships.revalidate?.(); signal?.throwIfAborted(); await setActive({ organization: invitation.publicOrganizationData.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination(`/join?confirm=${invitation.publicOrganizationData.id}`) : `/join?confirm=${invitation.publicOrganizationData.id}`)); } }); }
    catch (cause) { if (!lifetime.current?.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }}>{busy ? "Joining…" : "Accept invitation"}</button></section></section>)}</div><AccessError>{error || (userInvitations.error ? "We couldn’t check invitations. Try again." : "")}</AccessError>{userInvitations.error && <button className="cq-a-secondary" onClick={() => void userInvitations.revalidate?.().catch(cause => setError(errorMessage(cause)))}>Try again</button>}{userInvitations.hasNextPage && <button className="cq-a-link" disabled={busy} onClick={() => void userInvitations.fetchNext()}>More invitations</button>}<SignOutButton redirectUrl="/sign-in?returnTo=%2F%3Finvitations%3D1">Use another account</SignOutButton></AccessShell>;
}

export function PracticeAccess({ orgId, initialView = "entry", intendedOrganizationId, children }: { orgId: string | null | undefined; initialView?: AccessView; intendedOrganizationId?: string; children: (context: AccessContext, locationId: string | undefined, onAccessDenied: () => void) => ReactNode }) {
  const { getToken } = useAuth();
  const [context, setContext] = useState<AccessContext | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0); const [locationId, setLocationId] = useState("");
  const [view, setView] = useState<AccessView>(initialView); const [busy, setBusy] = useState(false); const [hidden, setHidden] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const concealed = useRef(false);
  const clinicalVisible = view === "entry" && !!context && resolveClinicalScope(context, locationId).kind !== "blocked";
  function refresh() { setContext(null); setLocationId(""); setAttempt(n => n + 1); }
  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true }); if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Your session has expired. Please sign in again.");
        const result = await getAccessContext(token, controller.signal); if (controller.signal.aborted) return;
        if ((result.orgId ?? null) !== (orgId ?? null)) throw new Error("Your practice changed. Please try again.");
        setContext(result); setError("");
      } catch (cause) { if (!controller.signal.aborted) { setError(errorMessage(cause)); if (cause instanceof ApiError && cause.status === 401) window.location.replace("/sign-in?reason=expired"); } }
    })();
    return () => controller.abort();
  }, [getToken, orgId, attempt, hidden]);
  useEffect(() => {
    const conceal = () => {
      // Conceal clinical records on backgrounding; account/setup forms contain no records.
      if (!clinicalVisible) return;
      concealed.current = true; setHidden(true); setContext(null); setLocationId("");
    };
    const reveal = () => { if (concealed.current && document.visibilityState === "visible") { concealed.current = false; setContext(null); setHidden(false); setAttempt(n => n + 1); } };
    const visibility = () => document.visibilityState === "hidden" ? conceal() : reveal();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", conceal); window.addEventListener("focus", reveal);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", conceal); window.removeEventListener("focus", reveal); };
  }, [clinicalVisible]);
  async function finishJoining() {
    if (busy) return; setBusy(true); setError("");
    try { const token = await getToken({ organizationId: orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!token) throw new Error("Please sign in again."); await apiRequest("/api/v1/practice/invitations/accept", token, { method: "POST", body: "{}", signal: lifetime.current?.signal }); lifetime.current?.signal.throwIfAborted(); refresh(); }
    catch (cause) { if (!lifetime.current?.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  if (hidden) return <AccessShell><AccessHeading title="Your workspace is paused">Return to this window to check access and reopen your workspace.</AccessHeading></AccessShell>;
  if (!context) return <AccessShell account={<UserButton />}><AccessHeading title={error ? "We couldn’t check your access" : "Checking your practice access…"}>{error ? "Try again to continue." : "One moment while we check your membership."}</AccessHeading><AccessError>{error}</AccessError>{error && <div className="cq-a-actions"><button className="cq-a-primary" onClick={refresh}>Try again</button><PracticePicker /><SignOutButton /></div>}</AccessShell>;
  if (view === "invitations") return <Invitations onBack={() => setView("entry")} />;
  if (view === "onboarding") return <PracticeOnboarding onInvitations={() => setView("invitations")} />;
  if (view === "practices" || (intendedOrganizationId && intendedOrganizationId !== context.orgId)) return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} />;
  if (!context.practice || context.onboarding === "required") return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} />;
  const manage = context.management.locations || context.management.members;
  if (context.practice.status !== "active" || ["suspended", "revoked"].includes(context.enrollmentStatus || "")) return <AccessShell account={<UserButton />}><AccessHeading title="Your access has changed">You can’t open this practice right now. Ask the practice owner to review your access.</AccessHeading><PracticePicker /><div className="cq-a-actions"><button className="cq-a-secondary" onClick={refresh}>Check again</button><SignOutButton /></div></AccessShell>;
  if (context.onboarding === "pending" || (context.practice.authorizationMode === "location" && context.enrollmentStatus !== "active")) return <AccessShell account={<UserButton />}><AccessHeading title={context.enrollmentStatus === "pending_assignment" ? "You’ve joined the team" : "Finish joining your practice"} mark="clock">Your practice owner will confirm your role and locations before you can open patient records.</AccessHeading><div className="cq-a-summary"><section><h2>Practice</h2><strong>{context.practice.name}</strong><small>Awaiting owner approval</small></section></div><AccessError>{error}</AccessError><div className="cq-a-actions">{context.enrollmentStatus !== "pending_assignment" && <button className="cq-a-primary" disabled={busy} onClick={() => void finishJoining()}>{busy ? "Confirming…" : "Finish joining this practice"}</button>}<button className={context.enrollmentStatus === "pending_assignment" ? "cq-a-primary" : "cq-a-secondary"} onClick={() => { setMessage("Checking for updated access…"); refresh(); }}>Check again</button><PracticePicker /><button className="cq-a-link" onClick={() => setView("invitations")}>View my invitations</button><SignOutButton /></div><AccessStatus>{message}</AccessStatus></AccessShell>;
  if (view === "settings" && manage) return <div className="careiq"><PracticeSettings key={context.practice.id} context={context} onClose={() => { setView("entry"); refresh(); }} /></div>;
  if ((view === "invite" || view === "owneraccess") && manage) return <PracticeManagement context={context} mode={view} onDone={() => { setView("entry"); refresh(); }} />;
  if (["settings", "invite", "owneraccess"].includes(view) && !manage) return <AccessShell account={<UserButton />}><AccessHeading title="Practice management needs owner access">Ask your practice owner to manage team invitations and location assignments.</AccessHeading><button className="cq-a-primary" onClick={() => setView("entry")}>Back to your practice</button><PracticePicker /></AccessShell>;
  const scope = resolveClinicalScope(context, locationId);
  if (scope.kind === "blocked") {
    const locations = context.locations.filter(location => location.status !== "closed");
    return <AccessShell account={<UserButton />}><AccessHeading title={locations.length ? "Where are you working?" : manage ? "Choose your next step" : "A location is needed"}>{locations.length ? `Choose an assigned location in ${context.practice.name}.` : manage ? "You can manage your practice. Patient records will be available after you assign yourself a location." : "Your role has been confirmed. Ask your practice owner to assign an active location before opening patient records."}</AccessHeading>
      {locations.length > 0 && <form className="cq-a-form" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("working")); if (resolveClinicalScope(context, id).kind !== "blocked") setLocationId(id); }}><fieldset><legend>Working location</legend><div className="cq-a-options">{locations.map((location, index) => <label className="cq-a-choice" key={location.id}><input type="radio" name="working" value={location.id} required defaultChecked={index === 0 && locations.length === 1} /><span><strong>{location.name}</strong><small>{timeZoneLabel(location.timeZone)}</small></span></label>)}</div><button className="cq-a-primary">Continue →</button></fieldset></form>}
      <div className="cq-a-actions">{manage && <><button className={locations.length ? "cq-a-secondary" : "cq-a-primary"} onClick={() => setView("owneraccess")}>Set my location access</button><button className="cq-a-secondary" onClick={() => setView("invite")}>Invite your team</button><button className="cq-a-link" onClick={() => setView("settings")}>Practice settings & team access</button></>}<PracticePicker /><button className="cq-a-link" onClick={refresh}>Check access again</button><button className="cq-a-link" onClick={() => setView("invitations")}>View invitations</button></div>
    </AccessShell>;
  }
  return <div className="careiq"><div className="cq-access-toolbar">{context.practice.authorizationMode === "location" && <label className="cq-field">Working location<select className="cq-input" value={locationId} onChange={event => setLocationId(event.target.value)}>{context.locations.filter(location => location.status !== "closed").map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}{manage && <button className="cq-button" onClick={() => { setLocationId(""); setView("settings"); }}>Practice settings</button>}<button className="cq-button" onClick={() => { setLocationId(""); setView("invitations"); }}>Your invitations</button><button className="cq-button" onClick={refresh}>Refresh access</button></div>{children(context, scope.kind === "location" ? scope.locationId : undefined, refresh)}</div>;
}
