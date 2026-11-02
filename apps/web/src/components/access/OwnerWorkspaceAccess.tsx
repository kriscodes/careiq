"use client";

import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useI18n } from "@/i18n/provider";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { AccessContext, OwnerAccessProfile, PracticeAdmin } from "@/lib/api/practice";
import { authErrorMessage } from "@/lib/auth-errors";
import { canManagePatientAccounts, OWNER_ACCESS_AREAS, PAPERWORK_PERMISSION, readOwnerAccessProfile } from "@/lib/owner-access";
import { ApplicationPage, AccessError, AccessHeading, AccessShell } from "./AccessShell";
import { AccessLoading } from "./AccessLoading";

type Draft = { disabledPermissions: string[]; allLocations: boolean; locationIds: string[] };
const fingerprint = (draft: Draft) => JSON.stringify({ disabledPermissions: [...draft.disabledPermissions].sort(), allLocations: draft.allLocations, locationIds: draft.allLocations ? [] : [...draft.locationIds].sort() });

export function OwnerWorkspaceAccess({ context, onDone, renderFrame }: { context: AccessContext; onDone: () => void; renderFrame?: ApplicationPageFrame }) {
  const { t, uiError } = useI18n();
  const { getToken } = useAuth();
  const prefix = useId();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [profile, setProfile] = useState<OwnerAccessProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const draftDirty = useRef(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const disabled = busy || loading;
  const onLoadError = useEffectEvent((cause: unknown) => cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t));
  const leaveAfterAuthorityLoss = useEffectEvent(() => { draftDirty.current = false; onDone(); });
  const dirty = draft !== null && fingerprint(draft) !== baseline;
  useEffect(() => { draftDirty.current = dirty; }, [dirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draftDirty.current || locked.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true }); controller.signal.throwIfAborted();
        if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
        const result = (await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal })).data;
        controller.signal.throwIfAborted();
        const current = readOwnerAccessProfile(result.ownerAccess);
        const owner = result.members.find(member => member.userId === context.userId && member.isOwner && member.status === "active" && member.role === "org:admin");
        if (!current || !owner) throw new ApiError(503, "OWNER_ACCESS_UNAVAILABLE", "OWNER_ACCESS_UNAVAILABLE");
        const activeIds = new Set(result.locations.filter(location => location.status !== "closed").map(location => location.id));
        // Reflect effective binding access, without re-enabling a latent grant when its prerequisites return.
        const disabledPermissions = canManagePatientAccounts(current.disabledPermissions) ? current.disabledPermissions : [...new Set([...current.disabledPermissions, PAPERWORK_PERMISSION])].sort();
        const next = { disabledPermissions, allLocations: current.allLocations, locationIds: owner.locationIds.filter(id => activeIds.has(id)) };
        setData(result); setProfile(current); setDraft(next); setBaseline(fingerprint(next)); setConflict(false); setError("");
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) leaveAfterAuthorityLoss();
          else setError(onLoadError(cause));
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [context.orgId, context.userId, getToken, attempt]);

  function reload() { setLoading(true); setData(null); setProfile(null); setDraft(null); setBaseline(""); setError(""); setAttempt(value => value + 1); }
  const guardNavigation: NavigationGuard = (action, source) => {
    if (busy || locked.current) return;
    if (!dirty) { action(); return; }
    pending.current = action; opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); dialog.current?.showModal(); keepEditing.current?.focus();
  };
  function homeClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.cq-a-brand") : null;
    if (!target) return; event.preventDefault(); event.stopPropagation(); guardNavigation(onDone, target);
  }
  function toggleArea(permissions: readonly string[], enabled: boolean) {
    setDraft(current => {
      if (!current) return current;
      const next = new Set(current.disabledPermissions);
      for (const permission of permissions) { if (enabled) next.delete(permission); else next.add(permission); }
      if (!canManagePatientAccounts([...next])) next.add(PAPERWORK_PERMISSION);
      return { ...current, disabledPermissions: [...next].sort() };
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft || !profile || locked.current || conflict) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const signal = lifetime.current!.signal;
      const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true }); signal.throwIfAborted();
      if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
      await apiRequest("/api/v1/practice/owner-access", token, { method: "POST", body: JSON.stringify({ disabledPermissions: [...draft.disabledPermissions].sort(), allLocations: draft.allLocations, locationIds: draft.allLocations ? [] : draft.locationIds, revision: profile.revision }), signal });
      signal.throwIfAborted(); draftDirty.current = false; onDone();
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { draftDirty.current = false; setData(null); setDraft(null); onDone(); }
        else { setError(cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t)); if (cause instanceof ApiError && cause.code === "OWNER_ACCESS_CHANGED") setConflict(true); }
      }
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  const locations = data?.locations.filter(location => location.status !== "closed") ?? [];
  const canBind = draft ? canManagePatientAccounts(draft.disabledPermissions) : false;
  const content = <div onClickCapture={homeClick}><AccessShell embedded={!!renderFrame} account={<span inert={busy}><UserButton /></span>} wide>
    <button type="button" className="cq-a-link cq-a-back" disabled={disabled} onClick={event => guardNavigation(onDone, event.currentTarget)}>{t("access.copy.back_to_your_practice_aec6be")}</button>
    <AccessHeading title={t("access.ownerAccess.title")}>{t("access.ownerAccess.intro")}</AccessHeading>
    {!data || !draft || !profile ? <>{loading ? <AccessLoading label={t("access.ownerAccess.loading")} panel /> : <><AccessError>{error}</AccessError><button type="button" className="cq-a-secondary" onClick={reload}>{t("access.copy.try_again")}</button></>}</> : <form className="cq-a-form" onSubmit={save} aria-busy={busy} aria-describedby={`${prefix}-owner-hint`}>
      <fieldset disabled={disabled}>
        <fieldset><legend>{t("access.ownerAccess.areas")}</legend><div className="cq-a-options">{OWNER_ACCESS_AREAS.map(area => {
          const enabledCount = area.permissions.filter(permission => !draft.disabledPermissions.includes(permission)).length;
          const partial = enabledCount > 0 && enabledCount < area.permissions.length;
          return <label className="cq-a-choice" key={area.id}><input type="checkbox" name="area" value={area.id} checked={enabledCount === area.permissions.length} disabled={area.id === "patientAccounts" && !canBind} ref={element => { if (element) element.indeterminate = partial; }} aria-labelledby={`${prefix}-${area.id}-label`} aria-describedby={`${prefix}-${area.id}-hint${area.id === "patientAccounts" ? ` ${prefix}-binding-hint` : ""}`} onChange={event => toggleArea(area.permissions, event.target.checked)} /><span><strong id={`${prefix}-${area.id}-label`}>{t(`access.ownerAccess.${area.id}`)}</strong><small id={`${prefix}-${area.id}-hint`}>{t(`access.ownerAccess.${area.id}Hint`)}{partial && <> {t("access.ownerAccess.partial")}</>}{area.id === "patientAccounts" && !canBind && <> {t("access.ownerAccess.bindingUnavailable")}</>}</small></span></label>;
        })}</div><p className="cq-a-hint" id={`${prefix}-binding-hint`}>{t("access.ownerAccess.bindingHint")}</p>{draft.disabledPermissions.length > 0 && <button type="button" className="cq-a-secondary" onClick={() => setDraft(current => current && { ...current, disabledPermissions: [] })}>{t("access.ownerAccess.enableAll")}</button>}</fieldset>
        <fieldset><legend>{t("access.copy.locations")}</legend><label className="cq-a-choice"><input type="checkbox" name="allLocations" aria-label={t("access.ownerAccess.allLocations")} checked={draft.allLocations} onChange={event => setDraft(current => current && { ...current, allLocations: event.target.checked })} /><span><strong>{t("access.ownerAccess.allLocations")}</strong><small>{t("access.ownerAccess.allLocationsHint")}</small></span></label><div className="cq-a-options">{locations.map(location => <label className="cq-a-choice" key={location.id}><input type="checkbox" name="locationIds" value={location.id} checked={draft.allLocations || draft.locationIds.includes(location.id)} disabled={draft.allLocations} onChange={event => { const checked = event.target.checked; setDraft(current => current && { ...current, locationIds: checked ? [...new Set([...current.locationIds, location.id])] : current.locationIds.filter(id => id !== location.id) }); }} /><span><strong>{location.name}</strong></span></label>)}{!locations.length && <p>{t("access.copy.no_active_locations_are_available_add_one_in_practice_settings")}</p>}</div>{!draft.allLocations && locations.length > 0 && <button type="button" className="cq-a-secondary" onClick={() => setDraft(current => current && { ...current, locationIds: locations.map(location => location.id) })}>{t("access.ownerAccess.selectLocations")}</button>}</fieldset>
        <p className="cq-a-hint" id={`${prefix}-owner-hint`}>{t("access.ownerAccess.ownerHint")}</p>
        <AccessError>{error}</AccessError>{error && <button type="button" className="cq-a-secondary" onClick={event => guardNavigation(reload, event.currentTarget)}>{t("access.ownerAccess.reviewCurrent")}</button>}
        {busy && <AccessLoading label={t("access.copy.saving")} />}<button type="submit" className="cq-a-primary" disabled={conflict}>{busy ? <AccessLoading label={t("access.copy.saving")} inline /> : t("access.ownerAccess.save")}</button>
      </fieldset>
    </form>}
    <dialog className="cq-settings-unsaved" ref={dialog} aria-labelledby={`${prefix}-unsaved-title`} aria-describedby={`${prefix}-unsaved-body`} onClose={() => { if (opener.current?.isConnected) opener.current.focus(); }} onKeyDown={event => {
      if (event.key !== "Tab") return; const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")]; const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><h2 id={`${prefix}-unsaved-title`}>{t("access.settings.unsavedTitle")}</h2><p id={`${prefix}-unsaved-body`}>{t("access.ownerAccess.unsavedBody")}</p><div className="cq-settings-dialog-actions"><button ref={keepEditing} type="button" className="cq-a-primary" onClick={() => dialog.current?.close()}>{t("access.settings.keepEditing")}</button><button type="button" className="cq-a-secondary" onClick={() => { const action = pending.current; dialog.current?.close(); draftDirty.current = false; action?.(); }}>{t("access.settings.discardChanges")}</button></div></dialog>
  </AccessShell></div>;
  return <ApplicationPage renderFrame={renderFrame} guard={guardNavigation} blocked={busy}>{content}</ApplicationPage>;
}
