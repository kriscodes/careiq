"use client";

import { AccessLoading } from "@/components/access/AccessLoading";
import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { useI18n } from "@/i18n/provider";
import { accessRoleLabel } from "@/components/access/display";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { authErrorMessage } from "@/lib/auth-errors";
import type { AccessContext, PracticeAdmin } from "@/lib/api/practice";
import { ApplicationPage, AccessDiscardDialog, AccessError, AccessField, AccessHeading, AccessShell } from "./AccessShell";
import { OwnerWorkspaceAccess } from "./OwnerWorkspaceAccess";

export function PracticeManagement({ context, mode, onDone, renderFrame }: { context: AccessContext; mode: "invite" | "owneraccess"; onDone: () => void; renderFrame?: ApplicationPageFrame }) {
  return mode === "owneraccess" ? <OwnerWorkspaceAccess context={context} onDone={onDone} renderFrame={renderFrame} /> : <InvitationManagement context={context} onDone={onDone} renderFrame={renderFrame} />;
}

function InvitationManagement({ context, onDone, renderFrame }: { context: AccessContext; onDone: () => void; renderFrame?: ApplicationPageFrame }) {
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
  const form = useRef<HTMLFormElement | null>(null);
  const baseline = useRef(new WeakMap<HTMLFormElement, string>());
  const dirty = useRef(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const leaveAfterAuthorityLoss = useEffectEvent(() => { dirty.current = false; onDone(); });
  const snapshot = (element: HTMLFormElement) => JSON.stringify([...element.elements].flatMap(field => field instanceof HTMLInputElement ? [[field.name, field.value, field.checked]] : field instanceof HTMLSelectElement ? [[field.name, field.value]] : []));
  function rememberForm(element: HTMLFormElement | null) { if (element && !baseline.current.has(element)) { baseline.current.set(element, snapshot(element)); dirty.current = false; } form.current = element; }
  function trackDraft() { if (form.current) dirty.current = baseline.current.get(form.current) !== snapshot(form.current); }
  const guardNavigation: NavigationGuard = (action, source) => {
    if (busy || locked.current) return;
    if (!dirty.current) { action(); return; }
    pending.current = action; opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); dialog.current?.showModal(); keepEditing.current?.focus();
  };
  function homeClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.cq-a-brand") : null;
    if (!target) return; event.preventDefault(); event.stopPropagation(); guardNavigation(onDone, target);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || locked.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId!, skipCache: true }); if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
        const result = await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) { if (cause instanceof ApiError && [401, 403].includes(cause.status)) leaveAfterAuthorityLoss(); else setError(onLoadText(cause)); } }
    })();
    return () => controller.abort();
  }, [context.orgId, getToken, attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current || !data) return;
    const fields = new FormData(event.currentTarget);
    locked.current = true; setBusy(true); setError("");
    try {
      const token = await getToken({ organizationId: context.orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
        const input = retryInput || { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds").map(String) };
        setRetryInput(input);
        await apiRequest("/api/v1/practice/invitations", token, { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify(input), signal: lifetime.current?.signal });
        lifetime.current?.signal.throwIfAborted(); dirty.current = false; setSent(input.email); setRetryInput(null);
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { dirty.current = false; onDone(); return; }
        setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
        if (cause instanceof ApiError && [400, 409].includes(cause.status) && cause.code !== "INVITATION_RETRY_CONFLICT") { setRetryInput(null); setRequestKey(crypto.randomUUID()); }
      }
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  const content = sent ? <AccessShell embedded={!!renderFrame} account={<span inert={busy}><UserButton /></span>}><AccessHeading title={t("access.copy.invitation_sent")} mark="mail">{t("access.invitation.sent", { email: sent })}</AccessHeading><div className="cq-a-note">{t("access.copy.their_access_will_stay_pending_until_you_confirm_their_role_and_locations")}</div><div className="cq-a-actions"><button className="cq-a-primary" onClick={onDone}>{t("access.copy.back_to_your_practice")}</button><button className="cq-a-secondary" onClick={() => { setSent(""); setRequestKey(crypto.randomUUID()); }}>{t("access.copy.invite_another_teammate")}</button></div></AccessShell> : <AccessShell embedded={!!renderFrame} account={<span inert={busy}><UserButton /></span>} wide><button className="cq-a-link cq-a-back" disabled={busy} onClick={event => guardNavigation(onDone, event.currentTarget)}>{t("access.copy.back_to_your_practice_aec6be")}</button><AccessHeading title={t("access.copy.invite_a_teammate")}>{t("access.copy.they_ll_receive_an_email_invitation_you_ll_confirm_their_access_after_they")}</AccessHeading>
    {!data ? <>{error ? <p role="status">{t("access.copy.settings_are_unavailable")}</p> : <AccessLoading label={t("access.copy.checking_your_practice_settings")} panel />}<AccessError>{error}</AccessError>{error && <button className="cq-a-secondary" onClick={() => setAttempt(n => n + 1)}>{t("access.copy.try_again")}</button>}</> : <form ref={rememberForm} className="cq-a-form" onSubmit={save} onChange={trackDraft} aria-busy={busy}><fieldset disabled={busy}>
      <AccessField label={t("access.copy.work_email")} name="email" type="email" required autoComplete="email" maxLength={254} readOnly={!!retryInput} defaultValue={retryInput?.email} /><div className="cq-a-field"><label htmlFor="cq-invite-role">{t("access.copy.role")}</label><select id="cq-invite-role" className="cq-a-input" name="role" aria-describedby="cq-invite-role-hint" disabled={!!retryInput} defaultValue={retryInput?.role || data.allowedRoles.find(role => role === "org:member") || data.allowedRoles[0]}>{data.allowedRoles.map(role => <option key={role} value={role}>{accessRoleLabel(t, role)}</option>)}</select><small id="cq-invite-role-hint">{t("access.copy.roles_do_not_give_access_to_patient_records_on_their_own")}</small></div>
      <fieldset disabled={busy || !!retryInput}><legend>{t("access.copy.proposed_location_access")}</legend><div className="cq-a-options">{data.locations.filter(location => location.status !== "closed").map(location => <label className="cq-a-choice" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={false} /><span><strong>{location.name}</strong><small>{context.practice?.name}</small></span></label>)}{!data.locations.some(location => location.status !== "closed") && <p>{t("access.copy.no_active_locations_are_available_add_one_in_practice_settings")}</p>}</div></fieldset>
      {retryInput && <div className="cq-a-note">{t("access.copy.this_invitation_may_already_have_been_sent_retry_the_same_invitation_to_ch")}</div>}
      <AccessError>{error}</AccessError><button className="cq-a-primary">{busy ? <AccessLoading label={t("access.copy.saving")} inline /> : retryInput ? t("access.copy.check_invitation_status") : t("access.copy.send_invitation")}</button><button className="cq-a-link" type="button" onClick={event => guardNavigation(onDone, event.currentTarget)}>{t("access.copy.i_ll_do_this_later")}</button>
    </fieldset></form>}
    <AccessDiscardDialog id="cq-invitation-leave" dialog={dialog} keepEditing={keepEditing} opener={opener} onDiscard={() => { const action = pending.current; dialog.current?.close(); dirty.current = false; action?.(); }}>{t("access.invitation.unsavedBody")}</AccessDiscardDialog>
  </AccessShell>;
  return <ApplicationPage renderFrame={renderFrame} guard={guardNavigation} blocked={busy}><div onClickCapture={homeClick}>{content}</div></ApplicationPage>;
}
