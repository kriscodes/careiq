"use client";
import { useI18n } from "@/i18n/provider";
import { accessRoleLabel } from "@/components/access/display";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import type { AccessContext, PracticeAdmin } from "@/lib/api/practice";
import { AccessError, AccessField, AccessHeading, AccessShell, AccessStatus } from "./AccessShell";

export function PracticeManagement({ context, mode, onDone }: { context: AccessContext; mode: "invite" | "owneraccess"; onDone: () => void }) {
  const { t, uiError } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : value instanceof ApiError ? uiError(value, fallback) : authErrorMessage(value, t));
  const { getToken } = useAuth();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [retryInput, setRetryInput] = useState<{ email: string; role: string; locationIds: string[] } | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId!, skipCache: true }); if (!token) throw new Error(onLoadText("access.copy.please_sign_in_again"));
        const result = await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(onLoadText(cause)); }
    })();
    return () => controller.abort();
  }, [context.orgId, getToken, attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current || !data) return;
    const fields = new FormData(event.currentTarget);
    locked.current = true; setBusy(true); setError("");
    try {
      const token = await getToken({ organizationId: context.orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!token) throw new Error(t("access.copy.please_sign_in_again"));
      if (mode === "invite") {
        const input = retryInput || { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds").map(String) };
        setRetryInput(input);
        await apiRequest("/api/v1/practice/invitations", token, { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify(input), signal: lifetime.current?.signal });
        lifetime.current?.signal.throwIfAborted(); setSent(input.email); setRetryInput(null);
      } else {
        const owner = data.members.find(member => member.userId === context.userId && member.isOwner);
        if (!owner?.role || !data.allowedRoles.includes(owner.role)) throw new AccessActionError(t("access.copy.your_current_owner_role_could_not_be_confirmed_refresh_access_and_try_agai"));
        await apiRequest(`/api/v1/practice/members/${encodeURIComponent(owner.userId)}/activate`, token, { method: "POST", body: JSON.stringify({ role: owner.role, locationIds: fields.getAll("locationIds") }), signal: lifetime.current?.signal });
        lifetime.current?.signal.throwIfAborted(); onDone();
      }
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { onDone(); return; }
        setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
        if (cause instanceof ApiError && [400, 409].includes(cause.status) && cause.code !== "INVITATION_RETRY_CONFLICT") { setRetryInput(null); setRequestKey(crypto.randomUUID()); }
      }
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  if (sent) return <AccessShell account={<UserButton />}><AccessHeading title={t("access.copy.invitation_sent")} mark="mail">{t("access.invitation.sent", { email: sent })}</AccessHeading><div className="cq-a-note">{t("access.copy.their_access_will_stay_pending_until_you_confirm_their_role_and_locations")}</div><div className="cq-a-actions"><button className="cq-a-primary" onClick={onDone}>{t("access.copy.back_to_your_practice")}</button><button className="cq-a-secondary" onClick={() => { setSent(""); setRequestKey(crypto.randomUUID()); }}>{t("access.copy.invite_another_teammate")}</button></div></AccessShell>;
  const owner = data?.members.find(member => member.userId === context.userId && member.isOwner);
  return <AccessShell account={<UserButton />} wide><button className="cq-a-link cq-a-back" disabled={busy} onClick={onDone}>{t("access.copy.back_to_your_practice_aec6be")}</button><AccessHeading title={mode === "invite" ? t("access.copy.invite_a_teammate") : t("access.copy.set_your_location_access")}>{mode === "invite" ? t("access.copy.they_ll_receive_an_email_invitation_you_ll_confirm_their_access_after_they") : t("access.copy.owner_access_lets_you_manage_the_practice_choose_where_you_also_need_acces")}</AccessHeading>
    {!data ? <><p role="status">{error ? t("access.copy.settings_are_unavailable") : t("access.copy.checking_your_practice_settings")}</p><AccessError>{error}</AccessError>{error && <button className="cq-a-secondary" onClick={() => setAttempt(n => n + 1)}>{t("access.copy.try_again")}</button>}</> : <form className="cq-a-form" onSubmit={save} aria-busy={busy}><fieldset disabled={busy}>
      {mode === "invite" && <><AccessField label={t("access.copy.work_email")} name="email" type="email" required autoComplete="email" maxLength={254} readOnly={!!retryInput} defaultValue={retryInput?.email} /><div className="cq-a-field"><label htmlFor="cq-invite-role">{t("access.copy.role")}</label><select id="cq-invite-role" className="cq-a-input" name="role" aria-describedby="cq-invite-role-hint" disabled={!!retryInput} defaultValue={retryInput?.role || data.allowedRoles.find(role => role === "org:member") || data.allowedRoles[0]}>{data.allowedRoles.map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select><small id="cq-invite-role-hint">{t("access.copy.roles_do_not_give_access_to_patient_records_on_their_own")}</small></div></>}
      <fieldset disabled={busy || !!retryInput}><legend>{mode === "invite" ? t("access.copy.proposed_location_access") : t("access.copy.assign_yourself_to_a_location")}</legend><div className="cq-a-options">{data.locations.filter(location => location.status !== "closed").map(location => <label className="cq-a-choice" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={mode === "owneraccess" ? owner?.locationIds.includes(location.id) : false} /><span><strong>{location.name}</strong><small>{context.practice?.name}</small></span></label>)}{!data.locations.some(location => location.status !== "closed") && <p>{t("access.copy.no_active_locations_are_available_add_one_in_practice_settings")}</p>}</div></fieldset>
      {retryInput && <div className="cq-a-note">{t("access.copy.this_invitation_may_already_have_been_sent_retry_the_same_invitation_to_ch")}</div>}
      <AccessError>{error}</AccessError><button className="cq-a-primary">{busy ? t("access.copy.saving") : mode === "invite" ? retryInput ? t("access.copy.check_invitation_status") : t("access.copy.send_invitation") : t("access.copy.save_my_location_access")}</button><button className="cq-a-link" type="button" onClick={onDone}>{mode === "invite" ? t("access.copy.i_ll_do_this_later") : owner?.locationIds.length ? t("access.copy.back_to_practice") : t("access.copy.keep_management_access_only")}</button>
    </fieldset><AccessStatus>{mode === "owneraccess" ? t("access.copy.your_current_approved_role_will_stay_the_same") : undefined}</AccessStatus></form>}
  </AccessShell>;
}
