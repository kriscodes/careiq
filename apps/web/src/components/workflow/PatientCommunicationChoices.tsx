"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { apiRequestUrl } from "@/lib/web-config";
import { ApiError } from "@/lib/api/client";
type Purpose = "request" | "reminder" | "paperwork";
type Endpoint = { id: string; channel: "email" | "sms"; masked: string; suppressed: boolean; paperworkEligible: boolean; choices: Record<Purpose, boolean> };
type Profile = { contextToken: string; revision: number; practiceName: string; locationName: string; endpoints: Endpoint[] };
export function PatientCommunicationChoices() {
  const { getToken, userId } = useAuth(); const { locale, uiError } = useI18n(); const es = locale === "es";
  const [profiles, setProfiles] = useState<Profile[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [pendingContext, setPendingContext] = useState(""), [reload, setReload] = useState(0);
  const pending = useRef<{ key: string; body: string; revision: number; contextToken: string } | null>(null), lifetime = useRef<AbortController | null>(null), lock = useRef(false);
  const labels: Record<Purpose, string> = es ? { request: "Solicitudes de documentos", reminder: "Recordatorios", paperwork: "Avisos de copias completadas" } : { request: "Paperwork requests", reminder: "Reminders", paperwork: "Completed-copy notices" };
  async function request(method: string, signal?: AbortSignal, change?: { key: string; body: string; revision: number }) {
    const token = await getToken({ skipCache: true }); if (!token) throw new ApiError(401, "SESSION_EXPIRED", "SESSION_EXPIRED");
    const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, "/api/v1/patient-paperwork/communication-preferences"), { method, signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", headers: { Authorization: `Bearer ${token}`, ...(change ? { "Content-Type": "application/json", "Idempotency-Key": change.key, "If-Match": `"${change.revision}"` } : {}) }, ...(change ? { body: change.body } : {}) });
    if (!response.ok) { const result = await response.json().catch(() => null); throw new ApiError(response.status, result?.error?.code ?? "COMMUNICATION_PREFERENCES_UNAVAILABLE", "COMMUNICATION_PREFERENCES_UNAVAILABLE"); }
    return (await response.json()).data as { profiles: Profile[] };
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    queueMicrotask(() => { setProfiles([]); setLoading(true); setError(""); setSaved(false); setUncertain(false); setPendingContext(""); pending.current = null; });
    void request("GET", controller.signal).then(data => { if (!controller.signal.aborted) setProfiles(data.profiles); }).catch(cause => { if (!controller.signal.aborted) setError(uiError(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pending.current = null; };
    // Authentication token getter can refresh internally; user identity/reload own the protected lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reload]);
  function choose(profileIndex: number, endpointIndex: number, purpose: Purpose, allowed: boolean) {
    if (busy || pending.current) return; setSaved(false);
    setProfiles(old => old.map((profile, pi) => pi !== profileIndex ? profile : { ...profile, endpoints: profile.endpoints.map((endpoint, ei) => ei !== endpointIndex ? endpoint : { ...endpoint, choices: { ...endpoint.choices, [purpose]: allowed } }) }));
  }
  async function save(profile: Profile) {
    if (lock.current || pending.current && pending.current.contextToken !== profile.contextToken) return; lock.current = true; setBusy(true); setError(""); setSaved(false);
    const change = pending.current ?? { key: crypto.randomUUID(), contextToken: profile.contextToken, revision: profile.revision, body: JSON.stringify({ contextToken: profile.contextToken, choices: profile.endpoints.flatMap(endpoint => (Object.keys(labels) as Purpose[]).filter(purpose => !(endpoint.suppressed || purpose === "paperwork" && !endpoint.paperworkEligible) || !endpoint.choices[purpose]).map(purpose => ({ endpointId: endpoint.id, purpose, allowed: endpoint.choices[purpose] }))) }) };
    pending.current = change; setUncertain(true); setPendingContext(profile.contextToken);
    try { const data = await request("PATCH", lifetime.current?.signal, change); if (lifetime.current?.signal.aborted) return; pending.current = null; setUncertain(false); setPendingContext(""); setProfiles(old => old.map(value => value.contextToken === profile.contextToken ? data.profiles[0] : value)); setSaved(true); }
    catch (cause) { if (!lifetime.current?.signal.aborted) { if (cause instanceof ApiError && cause.status < 500) { pending.current = null; setUncertain(false); setPendingContext(""); } if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) setProfiles([]); setError(uiError(cause)); } }
    finally { lock.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  return <section className="wf-studio-settings-card" aria-label={es ? "Preferencias de comunicación" : "Communication choices"}><h2>{es ? "Cómo nos comunicamos con usted" : "How we contact you"}</h2><p>{es ? "Estas preferencias no cambian sus firmas ni sus copias seguras." : "These choices do not change your signatures or available secure copies."}</p>{loading && <p role="status">{es ? "Cargando…" : "Loading…"}</p>}{error && <div className="wf-notice wf-error" role="alert">{error}<button className="wf-button" disabled={busy} onClick={() => setReload(value => value + 1)}>{es ? "Actualizar preferencias" : "Refresh choices"}</button></div>}{saved && <p role="status">{es ? "Preferencias guardadas." : "Communication choices saved."}</p>}{!loading && !error && !profiles.length && <p>{es ? "El consultorio debe confirmar su acceso antes de mostrar estas preferencias." : "The practice must confirm your access before these choices are available."}</p>}{profiles.map((profile, pi) => <fieldset key={profile.contextToken} disabled={busy || uncertain && pendingContext !== profile.contextToken}><legend>{profile.practiceName} · {profile.locationName}</legend>{!profile.endpoints.length && <p>{es ? "Pida al consultorio que confirme su información de contacto." : "Ask the practice to confirm your contact destination."}</p>}{profile.endpoints.map((endpoint, ei) => <div key={endpoint.id} className="wf-paperwork-card"><h3>{endpoint.channel === "email" ? "Email" : "SMS"} · {endpoint.masked}</h3>{endpoint.suppressed && <p>{es ? "Este canal está bloqueado. Guardar preferencias no elimina la exclusión." : "This channel is suppressed. Saving choices cannot clear an opt-out."}</p>}{(Object.keys(labels) as Purpose[]).map(purpose => <label key={purpose} className="wf-check"><input type="checkbox" checked={endpoint.choices[purpose]} disabled={busy || uncertain || endpoint.suppressed || purpose === "paperwork" && !endpoint.paperworkEligible} onChange={event => choose(pi, ei, purpose, event.target.checked)} />{labels[purpose]}</label>)}</div>)}<button className="wf-button wf-primary" disabled={busy || !profile.endpoints.length || uncertain && pendingContext !== profile.contextToken} onClick={() => void save(profile)}>{busy ? es ? "Guardando…" : "Saving…" : uncertain ? es ? "Consultar guardado anterior" : "Retry original save" : es ? "Guardar preferencias" : "Save choices"}</button></fieldset>)}</section>;
}
