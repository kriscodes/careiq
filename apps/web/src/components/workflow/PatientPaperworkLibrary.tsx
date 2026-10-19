"use client";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { apiRequestUrl } from "@/lib/web-config";
import { ApiError } from "@/lib/api/client";
import { PatientCommunicationChoices } from "./PatientCommunicationChoices";
import { PatientAccountCode } from "./PatientAccountCode";
import "./workflow.css";
type PaperworkCopy = { id: string; documentVersionId: string; title: string; versionNumber: number; signed: boolean; completedAt: string; releaseState: string };
type LibraryPage = { items: PaperworkCopy[]; hasMore: boolean; nextCursor: string | null };
const copyIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function PatientPaperworkLibrary() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth(); const { t, locale, direction, uiError, formatDate } = useI18n(); const es = locale === "es";
  const [items, setItems] = useState<PaperworkCopy[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [fileUrl, setFileUrl] = useState(""); const [busy, setBusy] = useState(""); const [reload, setReload] = useState(0);
  const [requestedCopyId, setRequestedCopyId] = useState<string | null>(null); const [invalidCopyLink, setInvalidCopyLink] = useState(false); const [requestedCopyError, setRequestedCopyError] = useState(""); const [openedCopyId, setOpenedCopyId] = useState("");
  const lifetime = useRef<AbortController | null>(null); const urls = useRef<string[]>([]); const generation = useRef(0); const lock = useRef(false);
  const request = useCallback(async (path: string, signal?: AbortSignal) => { const token = await getToken({ skipCache: true }); if (!token) throw new ApiError(401, "SESSION_EXPIRED", "SESSION_EXPIRED"); const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, `/api/v1/patient-paperwork${path}`), { signal, headers: { Authorization: `Bearer ${token}` }, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }); if (!response.ok) throw new ApiError(response.status, "PAPERWORK_UNAVAILABLE", "PAPERWORK_UNAVAILABLE"); return response; }, [getToken]);
  useEffect(() => {
    const values = new URLSearchParams(window.location.search).getAll("item"); const valid = values.length === 1 && copyIdPattern.test(values[0]);
    queueMicrotask(() => { setRequestedCopyId(valid ? values[0].toLowerCase() : null); setInvalidCopyLink(values.length > 0 && !valid); });
  }, []);
  useEffect(() => {
    const current = ++generation.current; const controller = new AbortController(); lifetime.current = controller; const blobs = urls.current;
    queueMicrotask(() => { if (controller.signal.aborted) return; setItems([]); setNextCursor(null); setError(""); setRequestedCopyError(""); setFileUrl(""); setOpenedCopyId(""); setBusy(""); setLoading(!!isSignedIn); });
    if (isLoaded && isSignedIn) void request("", controller.signal).then(response => response.json()).then((result: { data: LibraryPage }) => { if (current !== generation.current || controller.signal.aborted) return; setItems(result.data.items); setNextCursor(result.data.nextCursor); }).catch(cause => { if (!controller.signal.aborted) setError(uiError(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); blobs.forEach(url => URL.revokeObjectURL(url)); urls.current = []; };
  }, [isLoaded, isSignedIn, userId, reload, request, uiError]);
  async function more() { if (lock.current || !nextCursor) return; lock.current = true; const current = generation.current; const signal = lifetime.current?.signal; setBusy("more"); setError(""); try { const response = await request(`?cursor=${encodeURIComponent(nextCursor)}`, signal); const result = await response.json() as { data: LibraryPage }; if (current === generation.current && !signal?.aborted) { setItems(old => [...old, ...result.data.items.filter(item => !old.some(previous => previous.id === item.id))]); setNextCursor(result.data.nextCursor); } } catch (cause) { if (!signal?.aborted && current === generation.current) setError(uiError(cause)); } finally { lock.current = false; if (current === generation.current) setBusy(""); } }
  async function open(id: string, exact = false) {
    if (lock.current) return; lock.current = true; const current = generation.current; const signal = lifetime.current?.signal; setBusy(id); setError(""); setRequestedCopyError(""); setFileUrl(""); setOpenedCopyId("");
    try {
      // The requested immutable item is authorized directly, even when absent from the first library page.
      const response = await request(`/${encodeURIComponent(id)}/content`, signal); const blob = await response.blob(); if (!blob.size || !blob.type.startsWith("application/pdf")) throw new Error("PAPERWORK_UNAVAILABLE"); if (current !== generation.current || signal?.aborted) return;
      const url = URL.createObjectURL(blob); urls.current.push(url); setFileUrl(url); setOpenedCopyId(id);
    } catch (cause) {
      if (!signal?.aborted && current === generation.current) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setItems([]); setNextCursor(null); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; }
        if (exact && cause instanceof ApiError && [403, 404].includes(cause.status)) setRequestedCopyError(es ? "Esta copia exacta no está disponible o su acceso cambió. Comuníquese con el consultorio si necesita ayuda." : "This exact copy is unavailable or your access changed. Contact the practice for help.");
        else if (exact) setRequestedCopyError(uiError(cause)); else setError(uiError(cause));
      }
    } finally { lock.current = false; if (current === generation.current) setBusy(""); }
  }
  const returnPath = requestedCopyId ? `/patient-paperwork?item=${encodeURIComponent(requestedCopyId)}` : "/patient-paperwork";
  return <div className="wf-root" lang={locale} dir={direction}><main className="wf-paperwork-library">
    <div className="wf-logo" aria-label="careiq"><span aria-hidden="true">✚</span>careiq</div><div className="wf-public-language"><LanguageSelector /></div><h1>{t("workflow.studio.library")}</h1><p>{t("workflow.studio.libraryHelp")}</p>
    {invalidCopyLink && <p className="wf-notice wf-error" role="alert">{es ? "El enlace a la copia no es válido. Solicite ayuda al consultorio." : "This copy link is invalid. Contact the practice for help."}</p>}
    {isLoaded && isSignedIn && <>
      <PatientAccountCode key={userId} />
      <PatientCommunicationChoices key={`communication-${userId}`} />
      {requestedCopyId && <section className="wf-paperwork-card" aria-label={es ? "Copia de este aviso" : "Copy from this notice"}><div><h2>{es ? "Copia de este aviso" : "Copy from this notice"}</h2><p>{es ? "Abra la versión exacta indicada en el aviso. Se comprobará su acceso actual antes de mostrarla." : "Open the exact version referenced by this notice. Your current access will be checked before it is shown."}</p>{requestedCopyError && <p role="alert" className="wf-notice wf-error">{requestedCopyError}</p>}</div><button className="wf-button wf-primary" disabled={!!busy || loading} onClick={() => void open(requestedCopyId, true)}>{busy === requestedCopyId ? t("workflow.studio.loading") : es ? "Abrir copia solicitada" : "Open requested copy"}</button></section>}
    </>}
    {!isLoaded || loading ? <p role="status">{t("workflow.studio.loading")}</p> : !isSignedIn ? <div className="wf-notice"><p>{t("workflow.studio.librarySignIn")}</p><a className="wf-button wf-primary" href={`/sign-in?returnTo=${encodeURIComponent(returnPath)}`}>{t("workflow.studio.signIn")}</a></div> : <>
      {error && <div className="wf-notice wf-error" role="alert">{error}<button className="wf-link" onClick={() => setReload(value => value + 1)}>{t("workflow.text.refreshRecords")}</button></div>}
      {fileUrl && <div className="wf-paperwork-copy"><a className="wf-button wf-primary" href={fileUrl} target="_blank" rel="noreferrer">{openedCopyId === requestedCopyId ? es ? "Ver copia solicitada" : "View requested copy" : t("workflow.studio.openCopy")}</a></div>}
      {!items.length && !error && <div className="wf-notice"><p>{t("workflow.studio.libraryEmpty")}</p><p>{t("workflow.studio.libraryAccess")}</p></div>}
      <div className="wf-paperwork-list">{items.map(item => <article className="wf-paperwork-card" key={item.id}><div><h2>{item.title}</h2><p>{t("workflow.studio.version")} {item.versionNumber} · {item.signed ? t("workflow.studio.signedCopy") : t("workflow.studio.completedCopy")} · {formatDate(item.completedAt)}</p>{item.releaseState !== "released" && <p>{t("workflow.studio.copyUnavailable")}</p>}</div><button className="wf-button" disabled={!!busy || item.releaseState !== "released"} onClick={() => void open(item.id)}>{t(busy === item.id ? "workflow.studio.loading" : "workflow.studio.openCopy")}</button></article>)}</div>
      {nextCursor && <button className="wf-button" disabled={!!busy} onClick={() => void more()}>{t("workflow.studio.moreCopies")}</button>}
    </>}
  </main></div>;
}
