"use client";

import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { UserButton, useAuth, useReverification } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useI18n } from "@/i18n/provider";
import { apiRequest, ApiError } from "@/lib/api/client";
import { ApplicationPage, AccessDiscardDialog, AccessHeading, AccessShell } from "./AccessShell";
import { AccessLoading } from "./AccessLoading";
import { SignOutButton } from "./SignOutButton";

type Action = "archive" | "delete";
type ClosureRequest = { id: string; action: Action; status: "pending"; requestedAt: string };
type ArchiveState = { status: "active" | "archiving" | "archived" | "restoring"; archiveRequestedAt: string | null; archivedAt: string | null; restoredAt: string | null };
type AccountState = { account: ArchiveState; ownedPractices: { id: string; name: string }[]; closureRequest: ClosureRequest | null };

export function PersonalAccountSettings({ onBack, renderFrame }: { onBack: () => void; renderFrame?: ApplicationPageFrame }) {
  const { userId } = useAuth();
  return <PersonalAccountForm key={userId ?? "signed-out"} onBack={onBack} renderFrame={renderFrame} />;
}
function PersonalAccountForm({ onBack, renderFrame }: { onBack: () => void; renderFrame?: ApplicationPageFrame }) {
  const { getToken } = useAuth();
  const { t, uiError } = useI18n();
  const prefix = useId();
  const [data, setData] = useState<AccountState | null>(null);
  const [selectedAction, setAction] = useState<Action>("archive");
  const action = data?.account?.status === "archiving" ? "archive" : selectedAction;
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [authorityLost, setAuthorityLost] = useState(false);
  const locked = useRef(false);
  const dirty = useRef(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const failure = useEffectEvent((cause: unknown) => uiError(cause));
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getToken({ skipCache: true });
        if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
        const result = await apiRequest<{ data: AccountState }>("/api/v1/account", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); setAuthorityLost(false); }
      } catch (cause) { if (!controller.signal.aborted) { if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setAuthorityLost(true); setData(null); setConfirmation(""); } setError(failure(cause)); } }
    })();
    return () => controller.abort();
  }, [getToken, version]);
  const verifiedRequest = useReverification(async (payload: { action: Action; confirmation: string }) => {
    try {
      const token = await getToken({ skipCache: true });
      if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
      if (payload.action === "archive") return { value: { kind: "archive" as const, ...await apiRequest<{ data: ArchiveState }>("/api/v1/account/archive", token, { method: "POST", body: JSON.stringify({ confirmation: payload.confirmation }), signal: lifetime.current?.signal }) } };
      return { value: { kind: "delete" as const, ...await apiRequest<{ data: ClosureRequest }>("/api/v1/account/closure-requests", token, { method: "POST", body: JSON.stringify(payload), signal: lifetime.current?.signal }) } };
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "RECENT_AUTHENTICATION_REQUIRED") return { clerk_error: { type: "forbidden", reason: "reverification-error", metadata: { reverification: { level: "first_factor", afterMinutes: 5 } } } };
      throw cause;
    }
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !data || data.ownedPractices.length || data.closureRequest && action === "delete" || confirmation !== action.toUpperCase()) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await verifiedRequest({ action, confirmation });
      if (!result || !("value" in result) || !result.value) throw new ApiError(403, "RECENT_AUTHENTICATION_REQUIRED", "RECENT_AUTHENTICATION_REQUIRED");
      if (!lifetime.current?.signal.aborted) { const saved = result.value; setData(current => current ? saved.kind === "archive" ? { ...current, account: saved.data } : { ...current, closureRequest: saved.data } : current); setConfirmation(""); setAction("archive"); dirty.current = false; }
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        setError(cause && typeof cause === "object" && "code" in cause && cause.code === "reverification_cancelled" ? t("access.account.verificationCancelled") : uiError(cause));
        if (cause instanceof ApiError && [401, 403].includes(cause.status) && cause.code !== "RECENT_AUTHENTICATION_REQUIRED") { setAuthorityLost(true); setData(null); setConfirmation(""); }
        if (cause instanceof ApiError && (["ACCOUNT_OWNS_PRACTICES", "ACCOUNT_CLOSURE_ALREADY_PENDING", "ACCOUNT_ARCHIVE_INCOMPLETE", "ACCOUNT_RESTORE_INCOMPLETE"].includes(cause.code) || action === "archive" && ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(cause.code))) {
          setData(null); setConfirmation("");
          // Ownership and request state can change in another tab. Refresh only the
          // personal summary, retaining the original denial until it can be reviewed.
          try {
            const token = await getToken({ skipCache: true });
            if (!token) throw new ApiError(401, "UNAUTHENTICATED", "UNAUTHENTICATED");
            const fresh = await apiRequest<{ data: AccountState }>("/api/v1/account", token, { signal: lifetime.current?.signal });
            if (!lifetime.current?.signal.aborted) setData(fresh.data);
          } catch { /* Keep the denied form hidden and offer a deliberate refresh. */ }
        }
      }
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  const archiveStatus = data?.account?.status ?? "active";
  const finishingArchive = archiveStatus === "archiving";
  const phrase = action.toUpperCase();
  const hasDraft = Boolean(data && archiveStatus === "active" && !data.ownedPractices.length && !data.closureRequest && (confirmation || selectedAction !== "archive"));
  useEffect(() => { dirty.current = hasDraft; }, [hasDraft]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || locked.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const guardNavigation: NavigationGuard = (action, source) => {
    if (busy || locked.current) return;
    if (!hasDraft) { action(); return; }
    pending.current = action; opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); dialog.current?.showModal(); keepEditing.current?.focus();
  };
  function homeClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.cq-a-brand") : null;
    if (!target) return; event.preventDefault(); event.stopPropagation(); guardNavigation(onBack, target);
  }
  const frame = !authorityLost && archiveStatus === "active" && (data || !error) ? renderFrame : undefined;
  const content = <div className="careiq cq-settings-host cq-settings-page" onClickCapture={homeClick}><AccessShell embedded={!!frame} account={<span inert={busy}><UserButton /></span>}><div className="cq-personal-account">
    <AccessHeading title={t("access.account.title")}>{t("access.account.intro")}</AccessHeading>
    {error && <p className="cq-error" role="alert">{error}</p>}
    {!data ? <>{!error && <AccessLoading label={t("access.account.loading")} panel />}{error && <button className="cq-button" type="button" onClick={() => setVersion(value => value + 1)}>{t("access.account.retry")}</button>}</> : <section className="cq-setup-section" aria-labelledby={`${prefix}-title`}>
      <h2 id={`${prefix}-title`}>{t("access.account.closeTitle")}</h2><p>{t("access.account.retained")}</p>
      {archiveStatus === "archived" ? <div className="cq-personal-pending" role="status"><h3>{t("access.account.archivedTitle")}</h3><p>{t("access.account.archivedHelp")}</p><SignOutButton>{t("access.account.signOut")}</SignOutButton></div> : archiveStatus === "restoring" ? <div className="cq-personal-warning" role="status"><h3>{t("access.account.restoringTitle")}</h3><p>{t("access.account.restoringHelp")}</p><SignOutButton>{t("access.account.signOut")}</SignOutButton></div> : data.closureRequest && !finishingArchive ? <div className="cq-personal-pending" role="status"><h3>{t("access.account.pendingTitle")}</h3><p>{t(data.closureRequest.action === "archive" ? "access.account.pendingArchive" : "access.account.pendingDelete")}</p><p>{t("access.account.pendingHelp")}</p></div> : data.ownedPractices.length ? <div className="cq-personal-warning"><p>{t("access.account.ownerBlocked")}</p><ul aria-label={t("access.account.ownerList")}>{data.ownedPractices.map(practice => <li key={practice.id}>{practice.name}</li>)}</ul></div> : <form onSubmit={event => void submit(event)}>
        {finishingArchive && <div className="cq-personal-warning" role="status"><h3>{t("access.account.archiveIncompleteTitle")}</h3><p>{t("access.account.archiveIncompleteHelp")}</p></div>}
        <p id={`${prefix}-scope`}>{t("access.account.requestIntro")}</p>
        <fieldset disabled={busy} aria-describedby={`${prefix}-scope`}><legend>{t("access.account.closeTitle")}</legend>
          {(!finishingArchive ? ["archive", "delete"] as const : ["archive"] as const).map(value => <label className="cq-personal-choice" key={value}><input type="radio" name={`${prefix}-action`} value={value} checked={action === value} onChange={() => { setAction(value); setConfirmation(""); setError(""); }} /><span><strong>{t(value === "archive" ? "access.account.archive" : "access.account.delete")}</strong><small>{t(value === "archive" ? "access.account.archiveHelp" : "access.account.deleteHelp")}</small></span></label>)}
          <label className="cq-field">{t("access.account.confirmation", { phrase })}<input className="cq-input" value={confirmation} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={7} onChange={event => setConfirmation(event.target.value)} /></label>
          <button className="cq-button cq-personal-submit" type="submit" disabled={busy || confirmation !== phrase}>{busy ? <AccessLoading label={t(action === "archive" ? "access.account.archiving" : "access.account.submitting")} inline /> : t(action === "archive" ? finishingArchive ? "access.account.finishArchive" : "access.account.submitArchive" : "access.account.submitDelete")}</button>
        </fieldset>
      </form>}
    </section>}
    {archiveStatus === "active" && <footer><button className="cq-button" type="button" disabled={busy} onClick={event => guardNavigation(onBack, event.currentTarget)}>{t("access.account.back")}</button></footer>}
    <AccessDiscardDialog id={`${prefix}-account-leave`} dialog={dialog} keepEditing={keepEditing} opener={opener} onDiscard={() => { const action = pending.current; dialog.current?.close(); dirty.current = false; action?.(); }}>{t("access.account.unsavedBody")}</AccessDiscardDialog>
  </div></AccessShell></div>;
  return <ApplicationPage renderFrame={frame} guard={guardNavigation} blocked={busy}>{content}</ApplicationPage>;
}
