"use client";

import { AccessLoading } from "@/components/access/AccessLoading";

import type { ReactNode } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { useI18n } from "@/i18n/provider";
import { canEnterApplication, canOpenWorkspaceView, preferredWorkspaceView, type AccessContext, type WorkspaceView } from "@/lib/api/practice";
import { AccessError, AccessHeading, AccessShell, AccessStatus } from "./AccessShell";
import { ApplicationFrame } from "../workflow/ApplicationFrame";
import { staffNavigation, workspaceLabel, type ApplicationPageFrame } from "@/lib/application-navigation";

const icons = { Home: "⌂", Today: "◷", Schedule: "▦", Patients: "♧", Documents: "▤", Templates: "▧", Manager: "▦", Insurance: "◇", Communications: "✉", Notifications: "◷", Settings: "⚙" };
export function PracticeHome({ context, notice, receipt, error, busy, practicePicker, section = "Home", workspaceContent, onNavigate, onOpenWorkspace, onSettings, onInvite, onOwnerAccess, onInvitations, onRefresh, onPersonalAccount, onFinishJoining, renderFrame }: {
  renderFrame?: ApplicationPageFrame; context: AccessContext; notice?: string; receipt?: string; error?: string; busy?: boolean; practicePicker: ReactNode;
  section?: "Home" | WorkspaceView; workspaceContent?: ReactNode;
  onNavigate: (section: "Home" | WorkspaceView) => void;
  onOpenWorkspace: (view?: WorkspaceView) => void; onSettings: () => void; onInvite: () => void; onOwnerAccess: () => void;
  onInvitations: () => void; onRefresh: () => void; onPersonalAccount: () => void; onFinishJoining: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useUser();
  const practice = context.practice;
  if (!practice) return null;
  const ready = canEnterApplication(context);
  const manage = ready && (context.management.locations || context.management.members);
  const preferred = preferredWorkspaceView(context);
  const locations = context.locations.filter(location => location.status === undefined || location.status === "active");
  const assigned = practice.authorizationMode === "legacy" || locations.length > 0;
  const pending = practice.status === "active" && context.onboarding === "pending" && !["revoked", "suspended"].includes(context.enrollmentStatus || "");
  const viewLabel = (view: WorkspaceView) => workspaceLabel(t, locale, view);
  if (!ready) return <AccessShell account={<UserButton />} wide><div className="cq-home">
    <AccessHeading title={t("access.home.title")}>{t("access.home.welcome", { practice: practice.name })}</AccessHeading>
    <AccessStatus>{receipt}</AccessStatus><AccessError>{error}</AccessError>
    <p className="cq-a-note" role="status">{t(pending ? "access.copy.your_practice_owner_will_confirm_your_role_and_locations_before_you_can_op" : "access.copy.you_can_t_open_this_practice_right_now_ask_the_practice_owner_to_review_yo")}</p>
    {pending && context.enrollmentStatus !== "pending_assignment" && <button type="button" className="cq-a-primary" disabled={busy} onClick={onFinishJoining}>{busy ? <AccessLoading label={t("access.copy.confirming")} inline /> : t("access.copy.finish_joining_this_practice")}</button>}
    <button type="button" className="cq-a-secondary" disabled={busy} onClick={onRefresh}>{t("access.copy.check_access_again")}</button>{practicePicker}
    <button type="button" className="cq-a-link" onClick={onInvitations}>{t("access.copy.view_invitations")}</button><button type="button" className="cq-a-link" onClick={onPersonalAccount}>{t("access.home.personalAccount")}</button>
  </div></AccessShell>;
  const content = <div className="cq-app-home">
      <div className="cq-app-heading"><span className="cq-app-companion" aria-hidden="true"><span className="cq-a-companion" /></span><div><AccessHeading title={section === "Home" ? t("access.home.greeting") : viewLabel(section)}>{section === "Home" ? t("access.home.appIntro") : workspaceContent ? t("access.home.chooseLocationHint", { area: viewLabel(section) }) : undefined}</AccessHeading></div></div>
      {receipt && <div className="wf-notice" role="status">{receipt}</div>}
      {notice && <div className="wf-notice" role="status">{notice}<button type="button" className="wf-link cq-app-recheck" disabled={busy} onClick={onRefresh}>{t("access.copy.check_access_again")}</button></div>}
      {error && <div className="wf-notice wf-error" role="alert">{error}</div>}
      {workspaceContent ? workspaceContent : section !== "Home" ? <section className="cq-app-restricted" aria-labelledby="cq-app-restricted-title"><span className="cq-app-section-icon" aria-hidden="true">{icons[section]}</span><h2 id="cq-app-restricted-title">{t(canOpenWorkspaceView(context, section) && !assigned ? "access.home.noLocationShort" : "access.home.restrictedTitle")}</h2><p>{canOpenWorkspaceView(context, section) && !assigned ? t("access.home.noLocation") : t("access.home.restrictedBody", { area: viewLabel(section) })}</p><p>{t(manage ? "access.home.ownerRestrictedHelp" : "access.home.restrictedHelp")}</p><div className="wf-actions">{manage && <button type="button" className="wf-button wf-primary" onClick={onSettings}>{t("access.home.manageTeamLocations")}</button>}<button type="button" className="wf-button" onClick={onRefresh}>{t("access.copy.check_access_again")}</button><button type="button" className="wf-link" onClick={() => onNavigate("Home")}>{t("access.home.goHome")}</button></div></section> : <>
        <div className="cq-app-home-grid">
          <section className="cq-app-card cq-app-workspace"><div className="cq-app-card-title"><span aria-hidden="true">◷</span><h2>{t("access.home.workspaceTitle")}</h2></div><p>{t("access.home.workspaceIntro")}</p><div className="cq-app-shortcuts">{(["Today", "Patients", "Documents"] as WorkspaceView[]).map(view => <button type="button" key={view} onClick={() => onNavigate(view)}><span aria-hidden="true">{icons[view]}</span>{viewLabel(view)}<span aria-hidden="true">→</span></button>)}</div><button type="button" className="wf-button wf-primary" onClick={() => preferred && assigned ? onOpenWorkspace(preferred) : onNavigate(preferred ?? "Today")}>{t(preferred && assigned ? "access.home.openWorkspace" : "access.home.exploreWorkspace")}</button></section>
          {manage ? <section className="cq-app-card"><div className="cq-app-card-title"><span aria-hidden="true">⚙</span><h2>{t("access.home.managementTitle")}</h2></div><p>{t("access.home.managementHint")}</p><div className="cq-app-management-actions"><button type="button" className="wf-button" onClick={onSettings}>{t("access.home.manageTeamLocations")}</button><button type="button" className="wf-link" onClick={onInvite}>{t("access.copy.invite_your_team")}<span aria-hidden="true">→</span></button><button type="button" className="wf-link" onClick={onOwnerAccess}>{t("access.copy.set_my_location_access")}<span aria-hidden="true">→</span></button></div></section> : <section className="cq-app-card"><div className="cq-app-card-title"><span aria-hidden="true">♧</span><h2>{t("access.home.personalAccount")}</h2></div><p>{t("access.home.personalHint")}</p><button type="button" className="wf-button" onClick={onPersonalAccount}>{t("access.home.manageAccount")}</button><button type="button" className="wf-link" onClick={onInvitations}>{t("access.copy.your_invitations")}</button></section>}
        </div>
        <section className="cq-app-locations"><div><h2>{t("access.home.availableLocations")}</h2><p>{locations.length ? t("access.home.locationCount", { count: locations.length }) : t("access.home.noLocationShort")}</p></div><div className="cq-app-location-tags">{locations.map(location => <span key={location.id}>{location.name}</span>)}</div></section>
      </>}
    </div>;
  if (renderFrame) return renderFrame(content);
  return <ApplicationFrame practiceName={practice.name} pageLabel={section === "Home" ? t("access.home.navHome") : viewLabel(section)} contextPicker={practicePicker} items={staffNavigation(t, locale, manage, practice.authorizationMode === "location")} activeItem={section} onNavigate={id => id === "Practice" ? onSettings() : onNavigate(id as "Home" | WorkspaceView)} footer={<><button type="button" className="wf-link" onClick={onInvitations}>{t("access.copy.view_invitations")}</button><button type="button" className="wf-link" onClick={onPersonalAccount}>{t("access.home.personalAccount")}</button></>} account={<div className="cq-app-account"><UserButton /><span>{user?.firstName || t("access.copy.your_account")}</span></div>}>{content}</ApplicationFrame>;
}
