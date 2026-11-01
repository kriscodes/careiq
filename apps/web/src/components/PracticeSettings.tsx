"use client";

import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessRoleLabel, accessStatusLabel, accessZoneLabel } from "@/components/access/display";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { AccessContext, Location, PracticeAdmin, PracticeMember } from "@/lib/api/practice";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { ApplicationPage, AccessHeading, AccessShell } from "./access/AccessShell";
import { AccessLoading } from "./access/AccessLoading";
import { OwnershipTransfer } from "./access/OwnershipTransfer";
import { availableTimeZones, timeZoneOptionLabelKey } from "@/lib/access-flow";

export type PracticeSettingsCloseResult = { kind: "ownershipTransferred"; recipientName: string };
type Tab = "locations" | "team" | "invitations" | "ownership";
const tabs: readonly Tab[] = ["locations", "team", "invitations", "ownership"];
type SettingsNavigation = Tab | "close" | "owneraccess";
type SaveAction = (path: string, input: object, form?: HTMLFormElement) => Promise<void>;

function formSnapshot(form: HTMLFormElement) {
  return JSON.stringify([...form.elements].flatMap(element => {
    if (element instanceof HTMLInputElement) return [[element.name, element.type, element.value, element.checked]];
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return [[element.name, element.value]];
    return [];
  }));
}
async function readSettings(getToken: ReturnType<typeof useAuth>["getToken"], orgId: string | null, signal: AbortSignal) {
  const token = await getToken({ organizationId: orgId ?? undefined, skipCache: true });
  signal.throwIfAborted();
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
  return (await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal })).data;
}
function LocationChoices({ locations, selected = [], disabled = false }: { locations: Location[]; selected?: string[]; disabled?: boolean }) {
  const { t } = useI18n();
  return <fieldset className="cq-location-choices" disabled={disabled}><legend>{t("access.copy.assigned_locations")}</legend>{locations.filter(location => location.status !== "closed").map(location => <label className="cq-check" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={selected.includes(location.id)} />{location.name}</label>)}{!locations.length && <p>{t("access.copy.add_a_location_before_assigning_staff")}</p>}</fieldset>;
}
function MemberAccess({ member, data, busy, save, onOwnerAccess }: { member: PracticeMember; data: PracticeAdmin; busy: boolean; save: SaveAction; onOwnerAccess?: (source: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  if (member.isOwner) return <div className="cq-team-member">
    <h3>{member.displayName || member.email || t("access.copy.practice_owner")}</h3>{member.email && <p className="cq-muted">{member.email}{t("access.member.ownerSuffix")}</p>}<p>{t("access.member.status", { status: accessStatusLabel(t, member.status) })}</p>
    <p className="cq-muted">{t("access.ownerAccess.intro")}</p>{onOwnerAccess && <div className="cq-actions"><button type="button" className="cq-button cq-primary" disabled={busy} onClick={event => onOwnerAccess(event.currentTarget)}>{t("access.ownerAccess.title")}</button></div>}
  </div>;
  return <form className="cq-team-member" onSubmit={event => {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/activate`, { role: fields.get("role"), locationIds: fields.getAll("locationIds") }, form);
  }}>
    <h3>{member.displayName || member.email || (member.isOwner ? t("access.copy.practice_owner") : t("access.copy.team_member"))}</h3><p className="cq-muted">{member.email || member.userId}{member.isOwner ? t("access.member.ownerSuffix") : ""}</p><p>{t("access.member.status", { status: accessStatusLabel(t, member.status) })}</p>
    <label className="cq-field">{t("access.copy.role")}<select name="role" className="cq-input" defaultValue={member.role ?? "org:member"} disabled={busy}>{[...new Set([...data.allowedRoles, ...(member.role ? [member.role] : [])])].map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select></label>
    <LocationChoices locations={data.locations} selected={member.status === "pending_assignment" ? member.proposedLocationIds ?? [] : member.locationIds} disabled={busy} />
    <div className="cq-actions"><button type="submit" className="cq-button cq-primary" disabled={busy}>{t("access.copy.confirm_role_and_locations")}</button>{!member.isOwner && <button type="button" className="cq-button" disabled={busy || member.status === "suspended" || member.status === "revoked"} onClick={() => void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/suspend`, {})}>{t("access.copy.suspend_access")}</button>}</div>
  </form>;
}
function LocationPanel({ data, busy, save }: { data: PracticeAdmin; busy: boolean; save: SaveAction }) {
  const { t, locale } = useI18n();
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  const zoneLabel = (value: string) => { const key = timeZoneOptionLabelKey(value); return key ? t(key) : accessZoneLabel(locale, value); };
  return <section className="cq-setup-section"><h2>{t("access.copy.locations")}</h2>
    {data.locations.map(location => <div className="cq-team-row" key={location.id}><div><strong>{location.name}</strong><p>{zoneLabel(location.timeZone)} · {accessStatusLabel(t, location.status)}</p></div><button className="cq-button" disabled={busy} onClick={() => void save(`/api/v1/locations/${location.id}/status`, { status: location.status === "closed" ? "active" : "closed" })}>{location.status === "closed" ? t("access.copy.reopen_location") : t("access.copy.close_location")}</button></div>)}
    <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); void save("/api/v1/locations", { name: String(fields.get("name")).trim(), timeZone: String(fields.get("timeZone")), address: String(fields.get("address")).trim() || undefined }, form); }}>
      <fieldset className="cq-setup-fields" disabled={busy}><legend>{t("access.copy.add_a_location")}</legend><label className="cq-field">{t("access.copy.name")}<input className="cq-input" name="name" required maxLength={120} /></label><label className="cq-field">{t("access.copy.time_zone")}<select className="cq-input" name="timeZone" required value={zone} onChange={event => setZone(event.target.value)}>{availableTimeZones(zone).map(value => <option key={value} value={value}>{zoneLabel(value)}</option>)}</select></label><label className="cq-field">{t("access.copy.address_optional")}<input className="cq-input" name="address" autoComplete="street-address" maxLength={500} /></label><button className="cq-button cq-primary" type="submit">{t("access.copy.add_location")}</button></fieldset>
    </form>
  </section>;
}

export function PracticeSettings({ context, onClose, onOwnerAccess, renderFrame }: { context: AccessContext; onClose: (result?: PracticeSettingsCloseResult) => void; onOwnerAccess?: () => void; renderFrame?: ApplicationPageFrame }) {
  const { t, uiError } = useI18n();
  const { getToken } = useAuth();
  const id = useId();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [tab, setTab] = useState<Tab>("locations");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const [invitationAttempt] = useState(() => createSubmissionAttempt());
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const dirtyRef = useRef(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const baselines = useRef(new WeakMap<HTMLFormElement, string>());
  const dialog = useRef<HTMLDialogElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = busy || loading;
  const label = (value: Tab) => t(`access.settings.${value}`);
  const onLoadText = useEffectEvent((cause: unknown) => cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
  const onAccessLost = useEffectEvent(() => { dirtyRef.current = false; setData(null); onClose(); });

  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { const result = await readSettings(getToken, context.orgId, controller.signal); if (!controller.signal.aborted) { setData(result); setError(""); } }
      catch (cause) { if (!controller.signal.aborted) { if (cause instanceof ApiError && [401, 403].includes(cause.status)) onAccessLost(); else setError(onLoadText(cause)); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [getToken, context.orgId, version]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || locked.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function rememberForms(element: HTMLDivElement | null) {
    panel.current = element;
    element?.querySelectorAll("form").forEach(form => { if (!baselines.current.has(form)) baselines.current.set(form, formSnapshot(form)); });
  }
  // Let each controlled field handle its change before tracking the resulting draft.
  function updateDirty() {
    const changed = [...panel.current?.querySelectorAll("form") ?? []].some(form => baselines.current.get(form) !== formSnapshot(form));
    dirtyRef.current = changed; setDirty(changed);
  }
  function acceptForm(form?: HTMLFormElement) {
    if (form) baselines.current.set(form, formSnapshot(form));
    updateDirty();
  }
  function transition(next: SettingsNavigation) {
    dirtyRef.current = false; setDirty(false); setError(""); setMessage("");
    if (next === "close") onClose(); else if (next === "owneraccess") onOwnerAccess?.(); else { setTab(next); requestAnimationFrame(() => tabButtons.current[tabs.indexOf(next)]?.focus()); }
  }
  const guardNavigation: NavigationGuard = (action, source) => {
    if (busy || locked.current) return;
    if (!dirtyRef.current) { action(); return; }
    opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    pending.current = action; dialog.current?.showModal(); keepEditing.current?.focus();
  };
  function requestTransition(next: SettingsNavigation, source: HTMLElement) {
    if (!disabled) guardNavigation(() => transition(next), source);
  }
  function restoreFocus() { pending.current = null; if (opener.current?.isConnected) opener.current.focus(); }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); tabButtons.current[next]?.focus(); }
  }
  function homeClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.cq-a-brand") : null;
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); requestTransition("close", target);
  }
  async function save(path: string, input: object, form?: HTMLFormElement, key?: string, refresh = true) {
    if (locked.current) throw new AccessActionError(t("access.copy.another_update_is_in_progress_please_wait"));
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const signal = lifetime.current!.signal;
      const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true }); signal.throwIfAborted();
      if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
      await apiRequest(path, token, { method: "POST", headers: key ? { "Idempotency-Key": key } : undefined, body: JSON.stringify(input), signal }); signal.throwIfAborted();
      acceptForm(form); setMessage(t("access.copy.saved_access_changes_apply_to_new_requests"));
      if (refresh) {
        setLoading(true);
        try { const result = await readSettings(getToken, context.orgId, signal); signal.throwIfAborted(); setData(result); }
        catch (cause) {
          if (signal.aborted) throw cause;
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) { dirtyRef.current = false; setData(null); onClose(); }
          else setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
        } finally { if (!signal.aborted) setLoading(false); }
      }
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { dirtyRef.current = false; setData(null); onClose(); }
        else setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
      }
      throw cause;
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  const saveAction: SaveAction = async (path, input, form) => { await save(path, input, form).catch(() => {}); };
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    const input = { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds") };
    await invitationAttempt.submit(input, async key => { await save("/api/v1/practice/invitations", input, form, key); if (!lifetime.current?.signal.aborted) { form.reset(); acceptForm(form); } }).catch(() => {});
  }
  function retry() { if (!disabled) { setLoading(true); setVersion(value => value + 1); } }

  const content = <div className="cq-settings-page" onClickCapture={homeClick}><AccessShell embedded={!!renderFrame} account={<span inert={busy}><UserButton /></span>} wide><div className="cq-settings" data-unsaved={dirty || undefined}>
    <div><AccessHeading title={t("access.copy.practice_settings")}>{context.practice?.name}</AccessHeading></div>
    <div className="cq-settings-tabs" role="tablist" aria-label={t("access.settings.sections")}>{tabs.map((value, index) => <button key={value} ref={button => { tabButtons.current[index] = button; }} type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={disabled || !data} onKeyDown={event => tabKey(event, index)} onClick={event => { if (tab !== value) requestTransition(value, event.currentTarget); }}>{label(value)}</button>)}</div>
    {error && <div className="cq-settings-error"><p className="cq-error" role="alert">{localizeAccessText(t, error)}</p><button type="button" className="cq-button" disabled={disabled} onClick={retry}>{t("access.copy.try_again")}</button></div>}
    {message && <p role="status">{localizeAccessText(t, message)}</p>}
    {busy && !loading && <AccessLoading label={t("access.copy.saving")} />}
    {!data ? error ? <p>{t("access.copy.settings_could_not_be_loaded")}</p> : <AccessLoading label={t("access.settings.loading")} panel /> : <>
      {loading && <AccessLoading label={t("access.settings.refreshing")} />}
      {tabs.map(value => <div key={value} hidden={tab !== value} id={`${id}-${value}-panel`} role="tabpanel" aria-labelledby={`${id}-${value}-tab`} aria-busy={disabled} tabIndex={tab === value ? 0 : -1} ref={tab === value ? rememberForms : undefined} onChange={updateDirty}>{tab === value && <>
        {tab === "locations" && <LocationPanel data={data} busy={disabled} save={saveAction} />}
        {tab === "team" && <section className="cq-setup-section"><h2>{t("access.copy.team_access")}</h2><p>{t("access.copy.roles_grant_specific_actions_location_assignments_determine_where_those_ac")}</p>{data.members.map(member => <MemberAccess key={member.userId} member={member} data={data} busy={disabled} save={saveAction} onOwnerAccess={onOwnerAccess ? source => requestTransition("owneraccess", source) : undefined} />)}</section>}
        {tab === "invitations" && <section className="cq-setup-section"><h2>{t("access.copy.invite_your_team")}</h2><p>{t("access.copy.select_a_role_and_locations_for_the_invitation_after_your_employee_joins_c")}</p>
          {data.invitations.map(invitation => <div className="cq-team-row" key={invitation.id}><div><strong>{invitation.email}</strong><p>{accessRoleLabel(t, invitation.role)} · {accessStatusLabel(t, invitation.status)}{invitation.providerRevocationPending ? t("access.invitation.providerPending") : ""}</p></div>{(["sending", "invited"].includes(invitation.status) || invitation.providerRevocationPending) && <button className="cq-button" disabled={disabled} onClick={() => void saveAction(`/api/v1/practice/invitations/${invitation.id}/revoke`, {})}>{invitation.providerRevocationPending ? t("access.copy.retry_revocation") : t("access.copy.revoke_invitation")}</button>}</div>)}
          <form onSubmit={event => void invite(event)}><fieldset className="cq-setup-fields" disabled={disabled}><label className="cq-field">{t("access.copy.employee_email")}<input className="cq-input" name="email" type="email" required autoComplete="email" maxLength={254} /></label><label className="cq-field">{t("access.copy.role")}<select className="cq-input" name="role">{data.allowedRoles.map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select></label><LocationChoices locations={data.locations} /><button className="cq-button cq-primary" type="submit">{t("access.copy.send_invitation")}</button></fieldset></form>
        </section>}
        {tab === "ownership" && context.practice && <OwnershipTransfer practice={context.practice} members={data.members} busy={disabled} onTransfer={async payload => {
          const recipient = data.members.find(member => member.userId === payload.userId);
          const recipientName = recipient?.displayName && recipient.email ? `${recipient.displayName} (${recipient.email})` : recipient?.displayName || recipient?.email || t("access.copy.new_owner");
          await save("/api/v1/practice/ownership", payload, panel.current?.querySelector("form") ?? undefined, undefined, false);
          if (!lifetime.current?.signal.aborted) { dirtyRef.current = false; onClose({ kind: "ownershipTransferred", recipientName }); }
        }} />}
      </>}</div>)}
    </>}
    <footer className="cq-settings-done"><button type="button" className="cq-button cq-primary" disabled={disabled} onClick={event => requestTransition("close", event.currentTarget)}>{t("access.copy.done")}</button></footer>
    <dialog className="cq-settings-unsaved" ref={dialog} aria-labelledby={`${id}-unsaved-title`} aria-describedby={`${id}-unsaved-body`} onClose={restoreFocus} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id={`${id}-unsaved-title`}>{t("access.settings.unsavedTitle")}</h2><p id={`${id}-unsaved-body`}>{t("access.settings.unsavedBody", { tab: label(tab) })}</p><div className="cq-settings-dialog-actions"><button type="button" ref={keepEditing} className="cq-button cq-primary" onClick={() => dialog.current?.close()}>{t("access.settings.keepEditing")}</button><button type="button" className="cq-button" onClick={() => { const action = pending.current; dialog.current?.close(); dirtyRef.current = false; setDirty(false); action?.(); }}>{t("access.settings.discardChanges")}</button></div>
    </dialog>
  </div></AccessShell></div>;
  return <ApplicationPage renderFrame={renderFrame} guard={guardNavigation} blocked={busy}>{content}</ApplicationPage>;
}
