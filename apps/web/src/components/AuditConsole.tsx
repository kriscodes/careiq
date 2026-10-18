"use client";
import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessAuditLabel } from "@/components/access/display";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import { getAccessContext, type AccessContext } from "@/lib/api/practice";
import { apiRequestUrl } from "@/lib/web-config";

type AuditEvent = { id: string; recordedAt: string; action: string; outcome: string; entityType: string; entityId?: string; actorType: string; actorId: string; reasonCode?: string; resources?: { resourceType: string; resourceId: string }[]; changes?: { fieldPath: string; captureMode: string; beforeValue: unknown; afterValue: unknown }[]; databaseRecords?: { id: string; tableName: string; operation: string; changedFields: string[]; authenticatedLogin: string }[] };
type Result = { data: AuditEvent[]; pagination: { nextCursor: string | null; hasMore: boolean } };

export function AuditConsole() {
  const { t } = useI18n();
  const { isLoaded, isSignedIn, userId, orgId, getToken } = useAuth();
  const readToken = useCallback(() => getToken({ organizationId: orgId ?? undefined, skipCache: true }), [getToken, orgId]);
  if (!isLoaded) return <main className="careiq"><p role="status">{t("access.copy.confirming_your_account")}</p></main>;
  if (!isSignedIn) return <main className="careiq"><h1>{t("access.copy.audit_review")}</h1><Link href="/sign-in">{t("access.copy.sign_in_to_continue")}</Link></main>;
  return <AuditView key={`${userId}:${orgId}`} getToken={readToken} />;
}
function AuditView({ getToken }: { getToken: () => Promise<string | null> }) {
  const { t, uiError, formatDate } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : uiError(value, fallback));
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [locationId, setLocationId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [purpose, setPurpose] = useState("");
  const [action, setAction] = useState("");
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<{ id: string; recordCount: number; expiresAt: string } | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const exportKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const clear = useCallback(() => { generation.current += 1; pending.current?.abort(); setBusy(false); setResult(null); setSelected(null); setExported(null); }, []);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void getToken().then(token => {
      if (!token) throw new Error(onLoadText("access.copy.sign_in_again_to_review_audit_history"));
      return getAccessContext(token, controller.signal);
    }).then(value => { if (alive.current) setAccess(value); }).catch(cause => { if (alive.current) setError(onLoadText(cause, "access.copy.access_could_not_be_confirmed")); });
    const hide = () => { clear(); };
    window.addEventListener("blur", hide);
    return () => { alive.current = false; pending.current?.abort(); controller.abort(); window.removeEventListener("blur", hide); };
  }, [clear, getToken]);
  async function authorizedToken(signal: AbortSignal) {
    const token = await getToken();
    if (!token || !alive.current) throw new Error(t("access.copy.sign_in_again_to_continue"));
    const current = await getAccessContext(token, signal);
    if (!alive.current || !current.locations.some(l => l.id === locationId)) { clear(); throw new Error(t("access.copy.your_location_access_has_changed")); }
    return token;
  }
  function filters() { return { from: new Date(`${from}Z`).toISOString(), to: new Date(`${to}Z`).toISOString(), ...(action ? { action } : {}), includeEvidence, limit: 50 }; }
  const base = `/api/v1/locations/${locationId}/audit`;
  async function run(work: (token: string, startedGeneration: number, signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    const startedGeneration = generation.current;
    const controller = new AbortController(); pending.current = controller;
    try { if (!locationId || purpose.trim().length < 3) throw new Error(t("access.copy.choose_a_location_and_enter_an_audit_purpose_or_case_reference")); const token = await authorizedToken(controller.signal); if (generation.current !== startedGeneration) return; await work(token, startedGeneration, controller.signal); }
    catch (cause) { if (alive.current && !controller.signal.aborted && generation.current === startedGeneration) { setError(uiError(cause, "access.copy.audit_access_is_unavailable")); clear(); } }
    finally { if (alive.current && pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  async function search(cursor?: string) {
    await run(async (token, startedGeneration, signal) => {
      const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters()).map(([k, v]) => [k, String(v)])), ...(cursor ? { cursor } : {}) });
      const next = await apiRequest<Result>(`${base}/events?${query}`, token, { signal, headers: { "X-Audit-Purpose": purpose } });
      if (alive.current && generation.current === startedGeneration) { setResult(next); setSelected(null); }
    });
  }
  async function prepareExport() {
    await run(async (token, startedGeneration, signal) => {
      const body = { ...filters(), purpose };
      const fingerprint = JSON.stringify([locationId, body]);
      if (exportKey.current?.fingerprint !== fingerprint) exportKey.current = { fingerprint, key: crypto.randomUUID() };
      const response = await apiRequest<{ data: { id: string; recordCount: number; expiresAt: string } }>(`${base}/exports`, token, { signal, method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": exportKey.current.key, "X-Audit-Purpose": purpose } });
      if (alive.current && generation.current === startedGeneration) setExported(response.data);
    });
  }
  return <main className="careiq" style={{ maxWidth: 1100 }}><Link href="/">{t("access.copy.back_to_workspace")}</Link><h1 style={{ marginTop: 24 }}>{t("access.copy.protected_audit_review")}</h1><p>{t("access.copy.detailed_history_requires_explicit_audit_permission_every_search_detail_vi")}</p><form onSubmit={event => { event.preventDefault(); void search(); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 16, marginBlock: 24 }}><label>{t("access.copy.working_location")}<select required value={locationId} onChange={e => { setLocationId(e.target.value); clear(); }} style={{ display: "block", width: "100%", padding: 10 }}><option value="">{t("access.copy.choose_location")}</option>{access?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>{t("access.copy.from_utc")}<input required type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); clear(); }} style={{ display: "block", padding: 10, width: "100%" }} /></label><label>{t("access.copy.to_utc")}<input required type="datetime-local" value={to} onChange={e => { setTo(e.target.value); clear(); }} style={{ display: "block", padding: 10, width: "100%" }} /></label><label>{t("access.copy.purpose_or_case_reference")}<input required minLength={3} maxLength={96} value={purpose} onChange={e => { setPurpose(e.target.value); clear(); }} style={{ display: "block", padding: 10, width: "100%" }} /></label><label>{t("access.copy.action_optional")}<input value={action} onChange={e => { setAction(e.target.value); clear(); }} style={{ display: "block", padding: 10, width: "100%" }} /></label><label><input type="checkbox" checked={includeEvidence} onChange={e => { setIncludeEvidence(e.target.checked); clear(); }} /> {t("access.copy.include_database_evidence_requires_additional_permission")}</label><button disabled={busy} type="submit">{busy ? t("access.copy.checking") : t("access.copy.search_audit_history")}</button></form><p role="alert">{localizeAccessText(t, error)}</p>{result && <><p>{t("access.audit.pageCount", { count: result.data.length })}</p><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{[t("access.copy.when"), t("access.copy.action"), t("access.copy.outcome"), t("access.audit.actorUnknown"), t("access.copy.details")].map(h => <th key={h} style={{ textAlign: "left", padding: 10 }}>{h}</th>)}</tr></thead><tbody>{result.data.map(e => <tr key={e.id}><td style={{ padding: 10 }}>{formatDate(e.recordedAt, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" })}</td><td>{accessAuditLabel(t, "action", e.action)} <code>{e.action}</code></td><td>{accessAuditLabel(t, "outcome", e.outcome)}</td><td>{accessAuditLabel(t, "actor", e.actorType)}</td><td><button disabled={busy} onClick={() => void run(async (token, startedGeneration, signal) => { const detail = await apiRequest<{ data: AuditEvent }>(`${base}/events/${e.id}?includeEvidence=${includeEvidence}`, token, { signal, headers: { "X-Audit-Purpose": purpose } }); if (alive.current && generation.current === startedGeneration) setSelected(detail.data); })}>{t("access.copy.open_details")}</button></td></tr>)}</tbody></table></div>{!result.data.length && <p>{t("access.copy.no_events_match_this_period_and_action")}</p>}{result.pagination.nextCursor && <button disabled={busy} onClick={() => void search(result.pagination.nextCursor!)}>{t("access.copy.next_page")}</button>}<button disabled={busy} onClick={() => void prepareExport()}>{t("access.copy.prepare_protected_export")}</button></>}{selected && <section style={{ border: "1px solid #e1e7ef", borderRadius: 16, padding: 20, marginTop: 24 }}><h2>{accessAuditLabel(t, "action", selected.action)} <code>{selected.action}</code></h2><p>{selected.actorId} · {accessAuditLabel(t, "entity", selected.entityType)} · <code>{selected.entityType}</code> · {selected.entityId}</p>{selected.reasonCode && <p>{t("access.audit.reason", { reason: accessAuditLabel(t, "reason", selected.reasonCode) })} <code>{selected.reasonCode}</code></p>}<ul>{selected.changes?.map((change, i) => <li key={i}>{accessAuditLabel(t, "field", change.fieldPath)} <code>{change.fieldPath}</code>: {change.captureMode === "value" ? `${JSON.stringify(change.beforeValue)} → ${JSON.stringify(change.afterValue)}` : t("access.copy.changed_values_withheld")}</li>)}</ul>{selected.databaseRecords && <><h3>{t("access.copy.database_evidence")}</h3><ul>{selected.databaseRecords.map(record => <li key={record.id}>{accessAuditLabel(t, "action", record.operation)} <code>{record.operation}</code> · {record.tableName} · {record.changedFields.join(", ")} · {record.authenticatedLogin}</li>)}</ul></>}<button onClick={() => setSelected(null)}>{t("access.copy.close_details")}</button></section>}{exported && <section><p>{t("access.audit.exportPrepared", { count: exported.recordCount, time: formatDate(exported.expiresAt, { timeStyle: "short", timeZone: "UTC" }) })}</p><button disabled={busy} onClick={() => void run(async (token, startedGeneration, signal) => { const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, `${base}/exports/${exported.id}/content`), { headers: { Authorization: `Bearer ${token}`, "X-Audit-Purpose": purpose }, signal, cache: "no-store", credentials: "omit", redirect: "error" }); if (!response.ok) throw new Error(t("access.copy.export_access_could_not_be_confirmed")); const blob = await response.blob(); if (!alive.current || generation.current !== startedGeneration) return; const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "careiq-audit-export.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>{t("access.copy.download_protected_export")}</button></section>}</main>;
}
