"use client";

import { useI18n } from "@/i18n/provider";
import { accessRoleLabel, accessZoneLabel } from "@/components/access/display";
import { UserButton, useAuth, useOrganizationList, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { getAccessContext, canEnterApplication, canOpenWorkspaceView, preferredWorkspaceView, resolveClinicalScope, resolveWorkspaceScope, type AccessContext, type WorkspaceView } from "@/lib/api/practice";
import { authErrorMessage } from "@/lib/auth-errors";
import { sessionTaskDestination } from "@/lib/auth-intent";
import { invitationEmailMatches } from "@/lib/access-flow";
import { PracticeSettings, type PracticeSettingsCloseResult } from "./PracticeSettings";
import { PracticeOnboarding } from "./access/PracticeOnboarding";
import { PracticeManagement } from "./access/PracticeManagement";
import { SignOutButton } from "./access/SignOutButton";
import { PracticeHome } from "./access/PracticeHome";
import { AccessLoading } from "./access/AccessLoading";
import { PersonalAccountSettings } from "./access/PersonalAccountSettings";
import { AccessError, AccessHeading, AccessShell, AccessStatus } from "./access/AccessShell";
import { ApplicationFrame } from "./workflow/ApplicationFrame";
import { AuditConsole } from "./AuditConsole";
import { isWorkspaceDestination, staffNavigation, workspaceLabel, type ApplicationPageFrame } from "@/lib/application-navigation";


export type AccessView = "practices" | "entry" | "onboarding" | "invitations" | "settings" | "invite" | "owneraccess" | "workspace" | "account" | "audit";

/** Existing memberships only. Creation always goes through the CareIQ eligibility gate. */
export function PracticePicker({ currentPracticeName, onNavigate, label }: { currentPracticeName?: string; onNavigate?: (action: () => void) => void; label?: string } = {}) {
  const { t, uiError } = useI18n();
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const currentInPage = userMemberships.data?.some(membership => membership.organization.id === orgId);
  return <div className="cq-practice-picker"><label className="cq-field">{label ?? t("access.copy.your_practice")}<select className="cq-input" value={orgId ?? ""} disabled={!isLoaded || busy} onChange={event => { const organization = event.target.value; if (!organization || !setActive) return; const changePractice = async () => { setBusy(true); setError(""); try { await setActive({ organization }); } catch (cause) { setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); } finally { setBusy(false); } }; if (onNavigate) onNavigate(() => void changePractice()); else void changePractice(); }}><option value="" disabled>{t("access.copy.choose_your_practice")}</option>{orgId && !currentInPage && <option value={orgId} disabled>{currentPracticeName?.trim() || t("access.copy.checking_your_practices")}</option>}{userMemberships.data?.map(membership => <option key={membership.id} value={membership.organization.id}>{membership.organization.name}</option>)}</select></label>{(!isLoaded || userMemberships.isLoading) && <AccessLoading label={t("access.copy.checking_your_practices")} inline announce />}{userMemberships.hasNextPage && <button className="cq-button" onClick={() => void userMemberships.fetchNext()}>{t("access.copy.more_practices")}</button>}{(error || userMemberships.error) && <p className="cq-error" role="alert">{error || t("access.copy.unable_to_load_practices_refresh_to_try_again")}</p>}</div>;
}

function PracticeEntry({ onCreate, onInvitations, onPersonalAccount }: { onCreate: () => void; onInvitations: () => void; onPersonalAccount: () => void }) {
  const { t, uiError } = useI18n();
  const { setActive, isLoaded, userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });

  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <AccessShell account={<UserButton />}><AccessHeading title={t("access.copy.choose_your_practice")}>{t("access.copy.continue_with_one_of_the_practices_you_belong_to_or_set_up_a_new_practice")}</AccessHeading><div className="cq-a-options">{!isLoaded || userMemberships.isLoading ? <AccessLoading label={t("access.copy.checking_your_practices")} panel /> : userMemberships.data?.length ? userMemberships.data.map(membership => <button className="cq-a-choice" key={membership.id} disabled={busy} onClick={async () => { if (!setActive) return; setBusy(true); setError(""); try { await setActive({ organization: membership.organization.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination("/") : "/")); } }); } catch (cause) { setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); } finally { setBusy(false); } }}><span><strong>{membership.organization.name}</strong><small>{accessRoleLabel(t, membership.role)}</small></span><span aria-hidden="true">→</span></button>) : <div className="cq-a-note">{t("access.copy.you_don_t_belong_to_a_practice_yet_use_an_invitation_from_your_team_or_set")}</div>}</div><AccessError>{error || (userMemberships.error ? t("access.copy.we_couldn_t_check_your_practices_try_again") : "")}</AccessError>{userMemberships.error && <button className="cq-a-secondary" onClick={() => void userMemberships.revalidate?.().catch(cause => setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))))}>{t("access.copy.try_again")}</button>}{userMemberships.hasNextPage && <button className="cq-a-link" onClick={() => void userMemberships.fetchNext()}>{t("access.copy.more_practices")}</button>}<div className="cq-a-actions"><button className="cq-a-primary" onClick={onInvitations}>{t("access.copy.view_my_invitations")}</button><button className="cq-a-secondary" onClick={onCreate}>{t("access.copy.set_up_a_new_practice")}</button><button type="button" className="cq-a-link" onClick={onPersonalAccount}>{t("access.home.personalAccount")}</button><SignOutButton /></div></AccessShell>;
}

function Invitations({ onBack, onPersonalAccount, renderFrame }: { onBack: () => void; onPersonalAccount: () => void; renderFrame?: ApplicationPageFrame }) {
  const { t, uiError } = useI18n();
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({ userInvitations: { infinite: true, status: "pending", pageSize: 50 }, userMemberships: true });
  const { user } = useUser();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const content = <AccessShell embedded={!!renderFrame} account={<UserButton />}><button className="cq-a-link cq-a-back" disabled={busy} onClick={onBack}>{t("access.copy.back_to_your_practices")}</button><AccessHeading title={t("access.copy.join_your_team")} mark="users">{t("access.copy.sign_in_with_the_email_address_that_received_your_invitation_your_practice")}</AccessHeading><p className="cq-a-account">{user?.primaryEmailAddress?.emailAddress}</p><div className="cq-a-options">{!isLoaded || userInvitations.isLoading ? <AccessLoading label={t("access.copy.checking_invitations")} panel /> : !userInvitations.data?.length && <div className="cq-a-note">{t("access.copy.no_pending_invitations_for_this_account_if_your_invitation_has_expired_or")}</div>}{userInvitations.data?.map(invitation => <section className="cq-a-summary" key={invitation.id}><section><h2>{t("access.invitation.for", { email: invitation.emailAddress })}</h2><strong>{invitation.publicOrganizationData.name}</strong><button className="cq-a-primary" disabled={busy} style={{ marginTop: 20 }} onClick={async () => {
    if (!setActive) return;
    const verified = user?.emailAddresses.filter(address => address.verification.status === "verified").map(address => address.emailAddress) || [];
    if (!invitationEmailMatches(verified, invitation.emailAddress)) { setError(t("access.invitation.verifyEmail", { email: invitation.emailAddress })); return; }
    setBusy(true); setError("");
    try { const signal = lifetime.current?.signal; signal?.throwIfAborted(); await invitation.accept(); signal?.throwIfAborted(); await userMemberships.revalidate?.(); signal?.throwIfAborted(); await setActive({ organization: invitation.publicOrganizationData.id, navigate: ({ session, decorateUrl }) => { window.location.assign(decorateUrl(session.currentTask ? sessionTaskDestination(`/join?confirm=${invitation.publicOrganizationData.id}`) : `/join?confirm=${invitation.publicOrganizationData.id}`)); } }); }
    catch (cause) { if (!lifetime.current?.signal.aborted) setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }}>{busy ? <AccessLoading label={t("access.copy.joining")} inline /> : t("access.copy.accept_invitation")}</button></section></section>)}</div><AccessError>{error || (userInvitations.error ? t("access.copy.we_couldn_t_check_invitations_try_again") : "")}</AccessError>{userInvitations.error && <button className="cq-a-secondary" onClick={() => void userInvitations.revalidate?.().catch(cause => setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))))}>{t("access.copy.try_again")}</button>}{userInvitations.hasNextPage && <button className="cq-a-link" disabled={busy} onClick={() => void userInvitations.fetchNext()}>{t("access.copy.more_invitations")}</button>}<button type="button" className="cq-a-link" onClick={onPersonalAccount}>{t("access.home.personalAccount")}</button><SignOutButton redirectUrl="/sign-in?returnTo=%2F%3Finvitations%3D1">{t("access.copy.use_another_account")}</SignOutButton></AccessShell>;
  return renderFrame ? renderFrame(content, { blocked: busy }) : content;
}

export function PracticeAccess({ orgId, initialView = "entry", intendedOrganizationId, children }: { orgId: string | null | undefined; initialView?: AccessView; intendedOrganizationId?: string; children: (context: AccessContext, locationId: string | undefined, onAccessDenied: () => void, requestedView?: WorkspaceView, onHome?: () => void, accessTools?: (navigate: (action: () => void) => void) => ReactNode, renderFrame?: ApplicationPageFrame, onWorkspaceViewChange?: (view: WorkspaceView) => void) => ReactNode }) {
  const { t, uiError, locale } = useI18n();
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : value instanceof ApiError ? uiError(value, fallback) : authErrorMessage(value, t));
  const { getToken } = useAuth();
  const { user } = useUser();
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [context, setContext] = useState<AccessContext | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"" | "access.home.workspaceDenied" | "access.home.workspaceChanged">("");
  const [receipt, setReceipt] = useState<{ practice: string; recipient: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [view, setView] = useState<AccessView>(initialView);
  const [applicationSection, setApplicationSection] = useState<"Home" | WorkspaceView>("Home");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const concealed = useRef(false);
  const resuming = useRef(false);
  const scope = context ? resolveWorkspaceScope(context, locationId) : { kind: "blocked" as const };
  const clinicalVisible = view === "workspace" && scope.kind !== "blocked";
  const refresh = useCallback(() => {
    setApplicationSection("Home"); setView("entry"); setContext(null); setError(""); setAttempt(value => value + 1);
  }, []);
  // A denied read clears protected content immediately, then rechecks only the
  // nonclinical home context. It must never reopen/retry the rejected workflow.
  const workspaceDenied = useCallback(() => {
    setNotice("access.home.workspaceDenied"); setApplicationSection("Home"); setView("entry"); setContext(null); setError(""); setAttempt(value => value + 1);
  }, []);
  const receiveContext = useEffectEvent((result: AccessContext) => {
    const selected = resolveWorkspaceScope(result, locationId);
    if (view === "workspace" && (applicationSection === "Home" || !canOpenWorkspaceView(result, applicationSection) || (locationId && selected.kind === "blocked"))) {
      setApplicationSection("Home"); setView("entry"); setNotice("access.home.workspaceChanged");
    }
    resuming.current = false;
    setContext(result); setError("");
  });
  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true });
        if (!token) throw new ApiError(401, "UNAUTHENTICATED", onLoadText("access.copy.your_session_has_expired_please_sign_in_again"));
        const result = await getAccessContext(token, controller.signal);
        if (controller.signal.aborted) return;
        if ((result.orgId ?? null) !== (orgId ?? null)) throw new Error(onLoadText("access.copy.your_practice_changed_please_try_again"));
        receiveContext(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (resuming.current) { setApplicationSection("Home"); setView("entry"); setNotice("access.home.workspaceChanged"); resuming.current = false; }
          setContext(null); setError(onLoadText(cause));
        }
      }
    })();
    return () => controller.abort();
  }, [getToken, orgId, attempt, hidden]);
  useEffect(() => {
    const conceal = () => {
      if (!clinicalVisible || concealed.current) return;
      concealed.current = true; resuming.current = true;
      // Keep only the selected location as intent. Unmount records and discard
      // the authorization context before a fresh check can reopen the workspace.
      setHidden(true); setContext(null);
    };
    const reveal = () => {
      if (!concealed.current || document.visibilityState !== "visible") return;
      concealed.current = false; setHidden(false); setAttempt(value => value + 1);
    };
    const visibility = () => document.visibilityState === "hidden" ? conceal() : reveal();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", conceal); window.addEventListener("focus", reveal);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", conceal); window.removeEventListener("focus", reveal); };
  }, [clinicalVisible]);
  async function finishJoining() {
    if (busy) return; setBusy(true); setError("");
    try {
      const token = await getToken({ organizationId: orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted();
      if (!token) throw new Error(t("access.copy.please_sign_in_again"));
      await apiRequest("/api/v1/practice/invitations/accept", token, { method: "POST", body: "{}", signal: lifetime.current?.signal });
      lifetime.current?.signal.throwIfAborted(); refresh();
    } catch (cause) { if (!lifetime.current?.signal.aborted) setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t)); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  function navigateApplication(section: "Home" | WorkspaceView) {
    if (!context || !canEnterApplication(context)) return;
    setApplicationSection(section); setNotice(""); setError("");
    if (section === "Home" || !canOpenWorkspaceView(context, section)) { setView("entry"); return; }
    if (resolveWorkspaceScope(context, locationId).kind === "blocked") setLocationId("");
    setView("workspace");
  }
  function openWorkspace(requestedView?: WorkspaceView) {
    if (context) navigateApplication(requestedView ?? preferredWorkspaceView(context) ?? "Today");
  }
  function closeSettings(result?: PracticeSettingsCloseResult) {
    if (result?.kind === "ownershipTransferred") setReceipt({ practice: context?.practice?.name || t("access.copy.your_practice_sentence"), recipient: result.recipientName });
    refresh();
  }
  const personalAccount = () => setView("account");
  const personalAction = <button type="button" className="cq-a-link" onClick={personalAccount}>{t("access.home.personalAccount")}</button>;
  const receiptText = receipt ? t("access.home.ownershipReceipt", receipt) : undefined;
  if (view === "account" && !context) return <PersonalAccountSettings onBack={refresh} />;
  if (hidden) return <AccessShell><AccessHeading title={t("access.copy.your_workspace_is_paused")}>{t("access.copy.return_to_this_window_to_check_access_and_reopen_your_workspace")}</AccessHeading></AccessShell>;
  if (!context) return <AccessShell account={<UserButton />}>
    <AccessHeading title={receipt || notice ? t("access.home.title") : error ? t("access.copy.we_couldn_t_check_your_access") : t("access.copy.checking_your_practice_access")}>{error ? t("access.home.accessUnavailable") : undefined}</AccessHeading>
    <AccessStatus>{receiptText}</AccessStatus>
    {notice && <p className="cq-a-note" role="status">{t(notice)}</p>}
    {error ? <><AccessError>{error}</AccessError><div className="cq-a-actions"><button type="button" className="cq-a-primary" onClick={refresh}>{t("access.copy.try_again")}</button>{personalAction}<SignOutButton /></div></> : <AccessLoading label={t("access.home.rechecking")} />}
  </AccessShell>;
  const ready = !!context && canEnterApplication(context);
  if (view === "account" && !ready) return <PersonalAccountSettings onBack={refresh} />;
  if (view === "invitations" && !ready) return <Invitations onBack={refresh} onPersonalAccount={personalAccount} />;
  if (view === "onboarding") return <PracticeOnboarding onInvitations={() => setView("invitations")} />;
  if (view === "practices" || (intendedOrganizationId && intendedOrganizationId !== context.orgId)) return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} onPersonalAccount={personalAccount} />;
  if (context.orgId && !context.practice) return <AccessShell account={<UserButton />}>
    <AccessHeading title={t("access.practice.unconfiguredTitle")} mark="building">{t("access.practice.unconfiguredDescription")}</AccessHeading>
    <div className="cq-a-actions"><button type="button" className="cq-a-primary" onClick={() => setView("onboarding")}>{t("access.copy.set_up_a_new_practice")}</button><button type="button" className="cq-a-secondary" onClick={() => setView("practices")}>{t("access.practice.chooseAnother")}</button><button type="button" className="cq-a-link" onClick={() => setView("invitations")}>{t("access.copy.view_my_invitations")}</button>{personalAction}<SignOutButton /></div>
  </AccessShell>;
  if (!context.practice || context.onboarding === "required") return <PracticeEntry onCreate={() => setView("onboarding")} onInvitations={() => setView("invitations")} onPersonalAccount={personalAccount} />;
  const manage = context.management.locations || context.management.members;
  const frameFor = (destination: string): ApplicationPageFrame => function renderStaffPage(content, options = {}) {
    const activeItem = options.activeItem ?? destination;
    const leave = (action: () => void, source?: HTMLElement) => { if (options.blocked) return; if (options.guard) options.guard(action, source); else action(); };
    const source = () => document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const navigate = (id: string) => { if (id === activeItem && !(id === "Practice" && view !== "settings")) return; leave(() => {
      if (isWorkspaceDestination(id)) {
        if (options.navigate && canOpenWorkspaceView(context, id)) options.navigate(id);
        else navigateApplication(id);
      } else if (id === "Practice" && manage) setView("settings");
      else if (id === "Invitations") setView("invitations");
      else if (id === "Account") setView("account");
      else if (id === "Audit") setView("audit");
      else navigateApplication("Home");
    }, source()); };
    const pageLabel = isWorkspaceDestination(activeItem) ? workspaceLabel(t, locale, activeItem) : activeItem === "Practice" ? t("access.home.settingsLabel") : activeItem === "Account" ? t("access.home.personalAccount") : activeItem === "Invitations" ? t("access.copy.your_invitations") : activeItem === "Audit" ? t("access.navigation.audit") : t("access.home.navHome");
    return <ApplicationFrame practiceName={context.practice!.name} pageLabel={pageLabel} locationName={context.locations.find(location => location.id === locationId)?.name}
      contextPicker={<div className="cq-app-pickers"><PracticePicker currentPracticeName={context.practice!.name} label={t("access.home.pickerLabel")} onNavigate={action => leave(action, source())} />{context.practice!.authorizationMode === "location" && context.locations.length > 0 && <label className="cq-app-working-location">{t("access.copy.working_location")}<select value={locationId} disabled={options.blocked} onChange={event => { const id = event.target.value; if (resolveClinicalScope(context, id).kind !== "blocked") { if (view === "workspace") leave(() => setLocationId(id), event.currentTarget); else setLocationId(id); } }}><option value="" disabled>{t("access.navigation.chooseLocation")}</option>{context.locations.filter(location => location.status === undefined || location.status === "active").map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}</div>}
      items={staffNavigation(t, locale, manage, context.practice!.authorizationMode === "location")} activeItem={activeItem} onNavigate={navigate}
      collapsed={navigationCollapsed} onCollapsedChange={setNavigationCollapsed} navigationDisabled={options.blocked}
      footer={<>{[{ id: "Invitations", label: t("access.copy.view_invitations") }, { id: "Account", label: t("access.home.personalAccount") }, { id: "Audit", label: t("access.navigation.audit") }].map(item => <button type="button" key={item.id} className="wf-link" aria-current={activeItem === item.id ? "page" : undefined} disabled={options.blocked} onClick={() => navigate(item.id)}>{item.label}</button>)}</>}
      account={<div className="cq-app-account"><UserButton /><span>{user?.firstName || t("access.copy.your_account")}</span></div>}
      tools={options.tools}>
      <div className="careiq cq-application-page">{content}</div>
    </ApplicationFrame>;
  };
  if (view === "account") return <PersonalAccountSettings onBack={refresh} renderFrame={ready ? frameFor("Account") : undefined} />;
  if (view === "invitations") return <Invitations onBack={refresh} onPersonalAccount={personalAccount} renderFrame={ready ? frameFor("Invitations") : undefined} />;
  if (view === "audit" && ready) return frameFor("Audit")(<AuditConsole embedded />);
  if (view === "settings" && manage) return <PracticeSettings key={context.practice.id} context={context} onClose={closeSettings} onOwnerAccess={() => setView("owneraccess")} renderFrame={frameFor("Practice")} />;
  if ((view === "invite" || view === "owneraccess") && manage) return <PracticeManagement context={context} mode={view} onDone={refresh} renderFrame={frameFor("Practice")} />;
  function renderHome(workspaceContent?: ReactNode) {
    return <PracticeHome context={context!} notice={notice ? t(notice) : undefined} receipt={receiptText} error={error} busy={busy} practicePicker={<PracticePicker currentPracticeName={context!.practice!.name} label={canEnterApplication(context!) ? t("access.home.pickerLabel") : undefined} />} section={applicationSection} workspaceContent={workspaceContent} onNavigate={navigateApplication} onOpenWorkspace={openWorkspace} onSettings={() => setView("settings")} onInvite={() => setView("invite")} onOwnerAccess={() => setView("owneraccess")} onInvitations={() => setView("invitations")} onRefresh={refresh} onPersonalAccount={personalAccount} onFinishJoining={() => void finishJoining()} renderFrame={ready ? frameFor(applicationSection) : undefined} />;
  }
  if (view === "workspace" && applicationSection !== "Home" && canEnterApplication(context) && canOpenWorkspaceView(context, applicationSection)) {
    if (scope.kind === "blocked") {
      const locations = context.locations.filter(location => location.status === undefined || location.status === "active");
      if (locations.length) return renderHome(<section className="cq-app-location-choice">
        <h2>{t("access.copy.where_are_you_working")}</h2><p>{t("access.location.chooseAssigned", { practice: context.practice.name })}</p>
        <form onSubmit={event => {
          event.preventDefault(); const id = String(new FormData(event.currentTarget).get("working"));
          if (resolveWorkspaceScope(context, id).kind !== "blocked") setLocationId(id);
        }}><fieldset><legend>{t("access.copy.working_location")}</legend><div className="cq-app-location-options">{locations.map((location, index) => <label key={location.id}><input type="radio" name="working" value={location.id} required defaultChecked={index === 0 && locations.length === 1} /><span><strong>{location.name}</strong><small>{accessZoneLabel(locale, location.timeZone)}</small></span></label>)}</div><button type="submit" className="wf-button wf-primary">{t("access.copy.continue_496267")}</button></fieldset></form>
      </section>);
    } else {
      return children(context, scope.kind === "location" ? scope.locationId : undefined, workspaceDenied, applicationSection, refresh, undefined, frameFor(applicationSection), setApplicationSection);
    }
  }
  return renderHome();
}
