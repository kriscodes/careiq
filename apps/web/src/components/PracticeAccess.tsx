"use client";

import { useI18n } from "@/i18n/provider";
import { accessRoleLabel, accessZoneLabel } from "@/components/access/display";
import { UserButton, useAuth, useOrganizationList, useUser } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { getAccessContext, resolveClinicalScope, type AccessContext } from "@/lib/api/practice";
import { authErrorMessage } from "@/lib/auth-errors";
import { sessionTaskDestination } from "@/lib/auth-intent";
import { invitationEmailMatches } from "@/lib/access-flow";
import { PracticeSettings } from "./PracticeSettings";
import { PracticeOnboarding } from "./access/PracticeOnboarding";
import { PracticeManagement } from "./access/PracticeManagement";
import { SignOutButton } from "./access/SignOutButton";
import { AccessError, AccessHeading, AccessShell, AccessStatus } from "./access/AccessShell";


export type AccessView = "practices" | "entry" | "onboarding" | "invitations" | "settings" | "invite" | "owneraccess";

/** Existing memberships only. Creation always goes through the CareIQ eligibility gate. */
export function PracticePicker() {
  const { t, uiError } = useI18n();
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="cq-practice-picker"><label className="cq-field">{t("access.copy.your_practice")}<select className="cq-input" value={orgId ?? ""} disabled={!isLoaded || busy} onChange={async event => { const organization = event.target.value; if (!organization || !setActive) return; setBusy(true); setError(""); try { await setActive({ organization }); } catch (cause) { setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); } finally { setBusy(false); } }}><option value="" disabled>{t("access.copy.choose_your_practice")}</option>{userMemberships.data?.map(membership => <option key={membership.id} value={membership.organization.id}>{membership.organization.name}</option>)}</select></label>{userMemberships.hasNextPage && <button className="cq-button" onClick={() => void userMemberships.fetchNext()}>{t("access.copy.more_practices")}</button>}{(error || userMemberships.error) && <p className="cq-error" role="alert">{error || t("access.copy.unable_to_load_practices_refresh_to_try_again")}</p>}</div>;
}

function PracticeEntry({ onCreate, onInvitations }: { onCreate: () => void; onInvitations: () => void }) {
  const { t, uiError } = useI18n();
  const { setActive, isLoaded, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });

  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <AccessShell account={<UserButton />}><AccessHeading title={t("access.copy.choose_your_practice")}>{t("access.copy.continue_with_one_of_the_practices_you_belong_to_or_set_up_a_new_practice")}</AccessHeading><div className="cq-a-options">{!isLoaded || userMemberships.isLoading ? <p role="status">{t("access.copy.checking_your_practices")}</p> : userMemberships.data?.length ? userMemberships.data.map(membership => <button className="cq-a-choice" key={membership.id} disabled={busy} onClick={async () => { if (!setActive) return; setBusy(true); setError(""); try { await setActive({ organization: membership.organization.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination("/") : "/")); } }); } catch (cause) { setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); } finally { setBusy(false); } }}><span><strong>{membership.organization.name}</strong><small>{accessRoleLabel(t, membership.role)}</small></span><span aria-hidden="true">→</span></button>) : <div className="cq-a-note">{t("access.copy.you_don_t_belong_to_a_practice_yet_use_an_invitation_from_your_team_or_set")}</div>}</div><AccessError>{error || (userMemberships.error ? t("access.copy.we_couldn_t_check_your_practices_try_again") : "")}</AccessError>{userMemberships.error && <button className="cq-a-secondary" onClick={() => void userMemberships.revalidate?.().catch(cause => setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))))}>{t("access.copy.try_again")}</button>}{userMemberships.hasNextPage && <button className="cq-a-link" onClick={() => void userMemberships.fetchNext()}>{t("access.copy.more_practices")}</button>}<div className="cq-a-actions"><button className="cq-a-primary" onClick={onInvitations}>{t("access.copy.view_my_invitations")}</button><button className="cq-a-secondary" onClick={onCreate}>{t("access.copy.set_up_a_new_practice")}</button><SignOutButton /></div></AccessShell>;
}

function Invitations({ onBack }: { onBack: () => void }) {
  const { t, uiError } = useI18n();
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({ userInvitations: { infinite: true, status: "pending", pageSize: 50 }, userMemberships: true });
  const { user } = useUser();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  return <AccessShell account={<UserButton />}><button className="cq-a-link cq-a-back" disabled={busy} onClick={onBack}>{t("access.copy.back_to_your_practices")}</button><AccessHeading title={t("access.copy.join_your_team")} mark="users">{t("access.copy.sign_in_with_the_email_address_that_received_your_invitation_your_practice")}</AccessHeading><p className="cq-a-account">{user?.primaryEmailAddress?.emailAddress}</p><div className="cq-a-options">{!isLoaded || userInvitations.isLoading ? <p role="status">{t("access.copy.checking_invitations")}</p> : !userInvitations.data?.length && <div className="cq-a-note">{t("access.copy.no_pending_invitations_for_this_account_if_your_invitation_has_expired_or")}</div>}{userInvitations.data?.map(invitation => <section className="cq-a-summary" key={invitation.id}><section><h2>{t("access.invitation.for", { email: invitation.emailAddress })}</h2><strong>{invitation.publicOrganizationData.name}</strong><button className="cq-a-primary" disabled={busy} style={{ marginTop: 20 }} onClick={async () => {
    if (!setActive) return;
    const verified = user?.emailAddresses.filter(address => address.verification.status === "verified").map(address => address.emailAddress) || [];
    if (!invitationEmailMatches(verified, invitation.emailAddress)) { setError(t("access.invitation.verifyEmail", { email: invitation.emailAddress })); return; }
    setBusy(true); setError("");
    try { const signal = lifetime.current?.signal; signal?.throwIfAborted(); await invitation.accept(); signal?.throwIfAborted(); await userMemberships.revalidate?.(); signal?.throwIfAborted(); await setActive({ organization: invitation.publicOrganizationData.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination(`/join?confirm=${invitation.publicOrganizationData.id}`) : `/join?confirm=${invitation.publicOrganizationData.id}`)); } }); }
    catch (cause) { if (!lifetime.current?.signal.aborted) setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }}>{busy ? t("access.copy.joining") : t("access.copy.accept_invitation")}</button></section></section>)}</div><AccessError>{error || (userInvitations.error ? t("access.copy.we_couldn_t_check_invitations_try_again") : "")}</AccessError>{userInvitations.error && <button className="cq-a-secondary" onClick={() => void userInvitations.revalidate?.().catch(cause => setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))))}>{t("access.copy.try_again")}</button>}{userInvitations.hasNextPage && <button className="cq-a-link" disabled={busy} onClick={() => void userInvitations.fetchNext()}>{t("access.copy.more_invitations")}</button>}<SignOutButton redirectUrl="/sign-in?returnTo=%2F%3Finvitations%3D1">{t("access.copy.use_another_account")}</SignOutButton></AccessShell>;
}

export function PracticeAccess({ orgId, initialView = "entry", intendedOrganizationId, children }: { orgId: string | null | undefined; initialView?: AccessView; intendedOrganizationId?: string; children: (context: AccessContext, locationId: string | undefined, onAccessDenied: () => void) => ReactNode }) {
  const { t, uiError, locale } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : value instanceof ApiError ? uiError(value, fallback) : authErrorMessage(value, t));
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
        const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true }); if (!token) throw new ApiError(401, "UNAUTHENTICATED", onLoadText("access.copy.your_session_has_expired_please_sign_in_again"));
        const result = await getAccessContext(token, controller.signal); if (controller.signal.aborted) return;
        if ((result.orgId ?? null) !== (orgId ?? null)) throw new Error(onLoadText("access.copy.your_practice_changed_please_try_again"));
        setContext(result); setError("");
      } catch (cause) { if (!controller.signal.aborted) { setError(onLoadText(cause)); if (cause instanceof ApiError && cause.status === 401) window.location.replace("/sign-in?reason=expired"); } }
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
    try { const token = await getToken({ organizationId: orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!token) throw new Error(t("access.copy.please_sign_in_again")); await apiRequest("/api/v1/practice/invitations/accept", token, { method: "POST", body: "{}", signal: lifetime.current?.signal }); lifetime.current?.signal.throwIfAborted(); refresh(); }
    catch (cause) { if (!lifetime.current?.signal.aborted) setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  if (hidden) return <AccessShell><AccessHeading title={t("access.copy.your_workspace_is_paused")}>{t("access.copy.return_to_this_window_to_check_access_and_reopen_your_workspace")}</AccessHeading></AccessShell>;
  if (!context) return <AccessShell account={<UserButton />}><AccessHeading title={error ? t("access.copy.we_couldn_t_check_your_access") : t("access.copy.checking_your_practice_access")}>{error ? t("access.copy.try_again_to_continue") : t("access.copy.one_moment_while_we_check_your_membership")}</AccessHeading><AccessError>{error}</AccessError>{error && <div className="cq-a-actions"><button className="cq-a-primary" onClick={refresh}>{t("access.copy.try_again")}</button><PracticePicker /><SignOutButton /></div>}</AccessShell>;
  if (view === "invitations") return <Invitations onBack={() => setView("entry")} />;
  if (view === "onboarding") return <PracticeOnboarding onInvitations={() => setView("invitations")} />;
  if (view === "practices" || (intendedOrganizationId && intendedOrganizationId !== context.orgId)) return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} />;
  if (context.orgId && !context.practice) return <AccessShell account={<UserButton />}>
    <AccessHeading title={t("access.practice.unconfiguredTitle")} mark="building">{t("access.practice.unconfiguredDescription")}</AccessHeading>
    <div className="cq-a-actions">
      <button className="cq-a-primary" onClick={() => setView("onboarding")}>{t("access.copy.set_up_a_new_practice")}</button>
      <button className="cq-a-secondary" onClick={() => setView("practices")}>{t("access.practice.chooseAnother")}</button>
      <button className="cq-a-link" onClick={() => setView("invitations")}>{t("access.copy.view_my_invitations")}</button>
      <SignOutButton />
    </div>
  </AccessShell>;
  if (!context.practice || context.onboarding === "required") return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} />;
  const manage = context.management.locations || context.management.members;
  if (context.practice.status !== "active" || ["suspended", "revoked"].includes(context.enrollmentStatus || "")) return <AccessShell account={<UserButton />}><AccessHeading title={t("access.copy.your_access_has_changed")}>{t("access.copy.you_can_t_open_this_practice_right_now_ask_the_practice_owner_to_review_yo")}</AccessHeading><PracticePicker /><div className="cq-a-actions"><button className="cq-a-secondary" onClick={refresh}>{t("access.copy.check_again")}</button><SignOutButton /></div></AccessShell>;
  if (context.onboarding === "pending" || (context.practice.authorizationMode === "location" && context.enrollmentStatus !== "active")) return <AccessShell account={<UserButton />}><AccessHeading title={context.enrollmentStatus === "pending_assignment" ? t("access.copy.you_ve_joined_the_team") : t("access.copy.finish_joining_your_practice")} mark="clock">{t("access.copy.your_practice_owner_will_confirm_your_role_and_locations_before_you_can_op")}</AccessHeading><div className="cq-a-summary"><section><h2>{t("access.copy.practice")}</h2><strong>{context.practice.name}</strong><small>{t("access.copy.awaiting_owner_approval")}</small></section></div><AccessError>{error}</AccessError><div className="cq-a-actions">{context.enrollmentStatus !== "pending_assignment" && <button className="cq-a-primary" disabled={busy} onClick={() => void finishJoining()}>{busy ? t("access.copy.confirming") : t("access.copy.finish_joining_this_practice")}</button>}<button className={context.enrollmentStatus === "pending_assignment" ? "cq-a-primary" : "cq-a-secondary"} onClick={() => { setMessage(t("access.copy.checking_for_updated_access")); refresh(); }}>{t("access.copy.check_again")}</button><PracticePicker /><button className="cq-a-link" onClick={() => setView("invitations")}>{t("access.copy.view_my_invitations")}</button><SignOutButton /></div><AccessStatus>{message}</AccessStatus></AccessShell>;
  if (view === "settings" && manage) return <div className="careiq"><PracticeSettings key={context.practice.id} context={context} onClose={() => { setView("entry"); refresh(); }} /></div>;
  if ((view === "invite" || view === "owneraccess") && manage) return <PracticeManagement context={context} mode={view} onDone={() => { setView("entry"); refresh(); }} />;
  if (["settings", "invite", "owneraccess"].includes(view) && !manage) return <AccessShell account={<UserButton />}><AccessHeading title={t("access.copy.practice_management_needs_owner_access")}>{t("access.copy.ask_your_practice_owner_to_manage_team_invitations_and_location_assignment")}</AccessHeading><button className="cq-a-primary" onClick={() => setView("entry")}>{t("access.copy.back_to_your_practice")}</button><PracticePicker /></AccessShell>;
  const scope = resolveClinicalScope(context, locationId);
  if (scope.kind === "blocked") {
    const locations = context.locations.filter(location => location.status !== "closed");
    return <AccessShell account={<UserButton />}><AccessHeading title={locations.length ? t("access.copy.where_are_you_working") : manage ? t("access.copy.choose_your_next_step") : t("access.copy.a_location_is_needed")}>{locations.length ? t("access.location.chooseAssigned", { practice: context.practice.name }) : manage ? t("access.copy.you_can_manage_your_practice_patient_records_will_be_available_after_you_a") : t("access.copy.your_role_has_been_confirmed_ask_your_practice_owner_to_assign_an_active_l")}</AccessHeading>
      {locations.length > 0 && <form className="cq-a-form" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("working")); if (resolveClinicalScope(context, id).kind !== "blocked") setLocationId(id); }}><fieldset><legend>{t("access.copy.working_location")}</legend><div className="cq-a-options">{locations.map((location, index) => <label className="cq-a-choice" key={location.id}><input type="radio" name="working" value={location.id} required defaultChecked={index === 0 && locations.length === 1} /><span><strong>{location.name}</strong><small>{accessZoneLabel(locale, location.timeZone)}</small></span></label>)}</div><button className="cq-a-primary">{t("access.copy.continue_496267")}</button></fieldset></form>}
      <div className="cq-a-actions">{manage && <><button className={locations.length ? "cq-a-secondary" : "cq-a-primary"} onClick={() => setView("owneraccess")}>{t("access.copy.set_my_location_access")}</button><button className="cq-a-secondary" onClick={() => setView("invite")}>{t("access.copy.invite_your_team")}</button><button className="cq-a-link" onClick={() => setView("settings")}>{t("access.copy.practice_settings_team_access")}</button></>}<PracticePicker /><button className="cq-a-link" onClick={refresh}>{t("access.copy.check_access_again")}</button><button className="cq-a-link" onClick={() => setView("invitations")}>{t("access.copy.view_invitations")}</button></div>
    </AccessShell>;
  }
  return <div className="careiq"><div className="cq-access-toolbar">{context.practice.authorizationMode === "location" && <label className="cq-field">{t("access.copy.working_location")}<select className="cq-input" value={locationId} onChange={event => setLocationId(event.target.value)}>{context.locations.filter(location => location.status !== "closed").map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}{manage && <button className="cq-button" onClick={() => { setLocationId(""); setView("settings"); }}>{t("access.copy.practice_settings")}</button>}<button className="cq-button" onClick={() => { setLocationId(""); setView("invitations"); }}>{t("access.copy.your_invitations")}</button><button className="cq-button" onClick={refresh}>{t("access.copy.refresh_access")}</button></div>{children(context, scope.kind === "location" ? scope.locationId : undefined, refresh)}</div>;
}
