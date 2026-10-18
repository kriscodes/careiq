"use client";

import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessRoleLabel, accessStatusLabel } from "@/components/access/display";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { AccessContext, Location, PracticeAdmin, PracticeMember } from "@/lib/api/practice";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { PracticePicker } from "./PracticeAccess";



function LocationChoices({ locations, selected = [], disabled = false }: { locations: Location[]; selected?: string[]; disabled?: boolean }) {
  const { t } = useI18n();
  return <fieldset className="cq-location-choices" disabled={disabled}><legend>{t("access.copy.assigned_locations")}</legend>{locations.filter(location => location.status !== "closed").map(location => <label className="cq-check" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={selected.includes(location.id)} />{location.name}</label>)}{!locations.length && <p>{t("access.copy.add_a_location_before_assigning_staff")}</p>}</fieldset>;
}

function MemberAccess({ member, data, busy, save }: { member: PracticeMember; data: PracticeAdmin; busy: boolean; save: (path: string, input: object) => Promise<void> }) {
  const { t } = useI18n();
  return <form className="cq-team-member" onSubmit={event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/activate`, { role: fields.get("role"), locationIds: fields.getAll("locationIds") });
  }}>
    <h3>{member.displayName || member.email || (member.isOwner ? t("access.copy.practice_owner") : t("access.copy.team_member"))}</h3><p className="cq-muted">{member.email || member.userId}{member.isOwner ? t("access.member.ownerSuffix") : ""}</p><p>{t("access.member.status", { status: accessStatusLabel(t, member.status) })}</p>
    <label className="cq-field">{t("access.copy.role")}<select name="role" className="cq-input" defaultValue={member.role ?? "org:member"} disabled={busy}>{[...new Set([...data.allowedRoles, ...(member.role ? [member.role] : [])])].map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select></label>
    <LocationChoices locations={data.locations} selected={member.status === "pending_assignment" ? member.proposedLocationIds ?? [] : member.locationIds} disabled={busy} />
    <div className="cq-actions"><button type="submit" className="cq-button cq-primary" disabled={busy}>{t("access.copy.confirm_role_and_locations")}</button>{!member.isOwner && <button type="button" className="cq-button" disabled={busy || member.status === "suspended" || member.status === "revoked"} onClick={() => void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/suspend`, {})}>{t("access.copy.suspend_access")}</button>}</div>
  </form>;
}

export function PracticeSettings({ context, onClose }: { context: AccessContext; onClose: () => void }) {
  const { t, uiError } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : value instanceof ApiError ? uiError(value, fallback) : authErrorMessage(value, t));
  const { getToken } = useAuth();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [invitationAttempt] = useState(() => createSubmissionAttempt());
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true });
        if (!token) throw new AccessActionError(onLoadText("access.copy.please_sign_in_again"));
        const result = await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) { setData(null); setError(onLoadText(cause)); } }
    })();
    return () => controller.abort();
  }, [getToken, context.orgId, version]);

  async function save(path: string, input: object, key?: string) {
    if (locked.current) throw new AccessActionError(t("access.copy.another_update_is_in_progress_please_wait"));
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true });
      if (!token) throw new AccessActionError(t("access.copy.please_sign_in_again"));
      if (lifetime.current?.signal.aborted) return;
      await apiRequest(path, token, { method: "POST", headers: key ? { "Idempotency-Key": key } : undefined, body: JSON.stringify(input), signal: lifetime.current?.signal });
      if (!lifetime.current?.signal.aborted) { setMessage(t("access.copy.saved_access_changes_apply_to_new_requests")); setData(null); setVersion(value => value + 1); }
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403].includes(cause.status) && !lifetime.current?.signal.aborted) { setData(null); onClose(); }
      if (!lifetime.current?.signal.aborted) setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
      throw cause;
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }

  // Forms consume the rejection; keeping save rejecting preserves invitation retry keys.
  const saveAction = async (path: string, input: object) => { await save(path, input).catch(() => {}); };
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input = { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds") };
    await invitationAttempt.submit(input, async key => {
      await save("/api/v1/practice/invitations", input, key);
      if (!lifetime.current?.signal.aborted) form.reset();
    }).catch(() => {});
  }

  return <main className="cq-setup cq-settings">
    <header className="cq-heading"><div><h1>{t("access.copy.practice_settings")}</h1><p>{context.practice?.name}</p></div><button className="cq-button" onClick={onClose}>{t("access.copy.done")}</button></header><PracticePicker />
    {error && <p className="cq-error" role="alert">{localizeAccessText(t, error)}</p>}{message && <p role="status">{localizeAccessText(t, message)}</p>}
    {!data ? <><p role="status">{error ? t("access.copy.settings_could_not_be_loaded") : t("access.copy.loading_locations_and_team")}</p>{error && <button className="cq-button" onClick={() => setVersion(value => value + 1)}>{t("access.copy.try_again")}</button>}</> : <>
      <section className="cq-setup-section"><h2>{t("access.copy.locations")}</h2>{data.locations.map(location => <div className="cq-team-row" key={location.id}><div><strong>{location.name}</strong><p>{location.timeZone} · {accessStatusLabel(t, location.status)}</p></div><button className="cq-button" disabled={busy} onClick={() => void saveAction(`/api/v1/locations/${location.id}/status`, { status: location.status === "closed" ? "active" : "closed" })}>{location.status === "closed" ? t("access.copy.reopen_location") : t("access.copy.close_location")}</button></div>)}
        <form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void saveAction("/api/v1/locations", { name: String(fields.get("name")).trim(), timeZone: String(fields.get("timeZone")).trim(), address: String(fields.get("address")).trim() || undefined }); }}><fieldset className="cq-setup-fields" disabled={busy}><legend>{t("access.copy.add_a_location")}</legend><label className="cq-field">{t("access.copy.name")}<input className="cq-input" name="name" required maxLength={120} /></label><label className="cq-field">{t("access.copy.time_zone")}<input className="cq-input" name="timeZone" required maxLength={80} defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} /></label><label className="cq-field">{t("access.copy.address_optional")}<input className="cq-input" name="address" maxLength={500} /></label><button className="cq-button" type="submit">{t("access.copy.add_location")}</button></fieldset></form>
      </section>
      <section className="cq-setup-section"><h2>{t("access.copy.invite_your_team")}</h2><p>{t("access.copy.select_a_role_and_locations_for_the_invitation_after_your_employee_joins_c")}</p><form onSubmit={event => void invite(event)}><fieldset className="cq-setup-fields" disabled={busy}><label className="cq-field">{t("access.copy.employee_email")}<input className="cq-input" name="email" type="email" required autoComplete="email" maxLength={254} /></label><label className="cq-field">{t("access.copy.role")}<select className="cq-input" name="role">{data.allowedRoles.map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select></label><LocationChoices locations={data.locations} /><button className="cq-button cq-primary" type="submit">{t("access.copy.send_invitation")}</button></fieldset></form>
        {data.invitations.map(invitation => <div className="cq-team-row" key={invitation.id}><div><strong>{invitation.email}</strong><p>{accessRoleLabel(t, invitation.role)} · {accessStatusLabel(t, invitation.status)}{invitation.providerRevocationPending ? t("access.invitation.providerPending") : ""}</p></div>{(["sending", "invited"].includes(invitation.status) || invitation.providerRevocationPending) && <button className="cq-button" disabled={busy} onClick={() => void saveAction(`/api/v1/practice/invitations/${invitation.id}/revoke`, {})}>{invitation.providerRevocationPending ? t("access.copy.retry_revocation") : t("access.copy.revoke_invitation")}</button>}</div>)}
      </section>
      <section className="cq-setup-section"><h2>{t("access.copy.team_access")}</h2><p>{t("access.copy.roles_grant_specific_actions_location_assignments_determine_where_those_ac")}</p>{data.members.map(member => <MemberAccess key={`${member.userId}:${version}`} member={member} data={data} busy={busy} save={saveAction} />)}</section>
      <section className="cq-setup-section"><h2>{t("access.copy.transfer_practice_ownership")}</h2><p>{t("access.copy.the_new_owner_must_already_be_an_active_administrator_this_transfers_your")}</p><form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void saveAction("/api/v1/practice/ownership", { userId: fields.get("userId") }); }}><fieldset className="cq-setup-fields" disabled={busy}><label className="cq-field">{t("access.copy.new_owner")}<select className="cq-input" name="userId" required defaultValue=""><option value="" disabled>{t("access.copy.select_an_active_administrator")}</option>{data.members.filter(member => !member.isOwner && member.status === "active" && member.role === "org:admin").map(member => <option key={member.userId} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}</select></label><label className="cq-check"><input type="checkbox" required />{t("access.copy.i_confirm_the_ownership_transfer")}</label><button className="cq-button" type="submit">{t("access.copy.transfer_ownership")}</button></fieldset></form></section>
    </>}
  </main>;
}
