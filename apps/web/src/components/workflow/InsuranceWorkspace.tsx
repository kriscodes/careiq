"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n/provider";
import { ApiError } from "@/lib/api/client";
import { insuranceAmount, type InsuranceAdapter, type InsuranceCase, type InsuranceDetail, type InsuranceSummary, type InsuranceAssignee, type InsuranceEvidenceInput, type InsuranceCapabilities } from "@/lib/api/insurance";
import { patientName, type WorkflowSnapshot } from "@/lib/api/workflow";
import { instantFromLocal } from "@/lib/workflow-dates";
import { InterviewModal } from "../InterviewModal";

type Editor = { kind: "create" | "evidence" | "follow_up" | "coverage"; correctionId?: string };
const attention = (item: InsuranceCase) => item.status !== "active";
const eventKind = (action: string) => action.includes("corrected") ? "corrected" : action.includes("coverage.revised") ? "coverage" : action.includes("created") ? "created" : action.includes("evidence") && !action.endsWith("list") ? "evidence" : action.includes("follow_up") ? "follow_up" : action.endsWith("read") || action.endsWith("list") ? "accessed" : "updated";
const localDateTime = (value: string, zone: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T");

export function InsuranceWorkspace({ adapter, snapshot, mode, date, onDateChange, onOpenQueue, onOpenSchedule, onLoadAppointments }: {
  adapter: InsuranceAdapter; snapshot: WorkflowSnapshot; mode: "manager" | "insurance"; date: string;
  onDateChange: (date: string) => void; onOpenQueue: () => void; onOpenSchedule: () => void; onLoadAppointments: () => void;
}) {
  const { t, formatNumber, formatDate, uiError } = useI18n();
  const tr = (key: string, values?: Record<string, string | number>) => t(`workflow.insurance.${key}`, values);
  const [items, setItems] = useState<InsuranceCase[]>([]);
  const [summary, setSummary] = useState<InsuranceSummary | null>(null);
  const [assignees, setAssignees] = useState<InsuranceAssignee[]>([]);
  const [capabilities, setCapabilities] = useState<InsuranceCapabilities | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InsuranceDetail | null>(null);
  const [tab, setTab] = useState("summary");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const exportLock = useRef(false); const exportAttempt = useRef({ day: "", key: "" });
  const downloadUrls = useRef<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const lifecycle = useRef<AbortController | null>(null);
  const errorMessage = (cause: unknown) => cause instanceof ApiError && cause.status === 409 ? tr("conflict") : uiError(cause, "workflow.insurance.loadError");
  const report = useEffectEvent((cause: unknown) => setError(errorMessage(cause)));
  const canManage = capabilities?.manage === true;
  const canEvidence = capabilities?.evidence === true;
  const zone = snapshot.timeZone;
  const stamp = (value?: string | null) => value ? formatDate(value, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }) : tr("notSet");
  const status = (value: string) => tr(`state.${value}`);
  const staff = (id: string | null) => id ? tr("staffId", { id: assignees.find(item => item.id === id)?.label ?? id.slice(-8) }) : tr("unassigned");
  const money = (value: number | null | undefined) => value == null ? tr("unknown") : formatNumber(value / 100, { style: "currency", currency: "USD" });
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; const urls = downloadUrls.current; return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); }; }, [adapter, date]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setItems([]); setSummary(null); setSelectedId(null); setDetail(null); setEditor(null); setCapabilities(null); setNextCursor(null); setMoreBusy(false); setExportBusy(false); setAssignees([]); setError(""); } });
    void (async () => {
      try {
        const page = await adapter.cases(date, date, null, controller.signal);
        if (controller.signal.aborted) return;
        const caps = page.meta?.capabilities ?? { read: false, manage: false, evidence: false, activity: false };
        setItems(page.data); setNextCursor(page.pagination.nextCursor); setCapabilities(caps);
        if (caps.manage) {
          const [team, overview] = await Promise.all([adapter.assignees(controller.signal), mode === "manager" ? adapter.manager(date, date, controller.signal) : Promise.resolve(null)]);
          if (controller.signal.aborted) return;
          setAssignees(team); setSummary(overview);
        }
      } catch (cause) {
        if (!controller.signal.aborted) { report(cause); if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setItems([]); setDetail(null); setCapabilities(null); setSummary(null); setAssignees([]); } }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [adapter, date, mode, reload, snapshot.capabilities?.workManage, snapshot.capabilities?.documentsReview, snapshot.capabilities?.activityRead, snapshot.asOf]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setDetail(null); setDetailLoading(true); } });
    adapter.detail(selectedId, controller.signal).then(data => { if (!controller.signal.aborted) setDetail(data); }).catch(cause => { if (!controller.signal.aborted) report(cause); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [adapter, selectedId, reload]);
  async function moreCases() {
    if (!nextCursor || moreBusy) return;
    setMoreBusy(true); const signal = lifecycle.current?.signal;
    try { const page = await adapter.cases(date, date, nextCursor, signal); if (signal?.aborted) return; setItems(old => [...old, ...page.data.filter(next => !old.some(item => item.id === next.id))]); setNextCursor(page.pagination.nextCursor); }
    catch (cause) { if (!signal?.aborted) setError(errorMessage(cause)); }
    finally { if (!signal?.aborted) setMoreBusy(false); }
  }
  async function moreHistory(kind: "activity" | "evidence") {
    if (!detail || moreBusy) return;
    const cursor = kind === "activity" ? detail.activityCursor : detail.evidenceCursor;
    if (!cursor) return;
    setMoreBusy(true);
    const id = detail.case.id; const signal = lifecycle.current?.signal;
    try {
      if (kind === "activity") { const page = await adapter.activityPage(id, cursor, signal); if (!signal?.aborted) setDetail(old => old?.case.id === id ? { ...old, activity: [...old.activity, ...page.data.filter(item => !old.activity.some(event => event.id === item.id))], activityHasMore: page.pagination.hasMore, activityCursor: page.pagination.nextCursor } : old); }
      else { const page = await adapter.evidencePage(id, cursor, signal); if (!signal?.aborted) setDetail(old => old?.case.id === id ? { ...old, evidence: [...old.evidence, ...page.data.filter(item => !old.evidence.some(event => event.id === item.id))], evidenceHasMore: page.pagination.hasMore, evidenceCursor: page.pagination.nextCursor } : old); }
    } catch (cause) { if (!signal?.aborted) setError(errorMessage(cause)); }
    finally { if (!signal?.aborted) setMoreBusy(false); }
  }
  async function exportSummary() {
    if (exportLock.current || !canManage) return;
    exportLock.current = true; setExportBusy(true); setError("");
    const signal = lifecycle.current?.signal;
    if (exportAttempt.current.day !== date) exportAttempt.current = { day: date, key: crypto.randomUUID() };
    try {
      const result = await adapter.exportSummary(date, date, { key: exportAttempt.current.key, signal });
      if (signal?.aborted) return;
      const metrics = ["appointments", "tracked", "untracked", "unverified", "active", "inactive", "needsFollowUp", "overdue", "unassigned", "stale"] as const;
      const rows: Array<[string, string | number]> = [[tr("exportMetric"), tr("exportValue")], [tr("exportFrom"), result.from], [tr("exportTo"), result.to], [tr("exportGenerated"), result.asOf], [tr("exportZone"), result.timeZone], ...metrics.map(key => [tr(`export.${key}`), Number(result.summary[key] ?? 0)] as [string, number])];
      const escape = (value: string | number) => { const text = String(value); return `"${(/^[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; };
      const content = rows.map(row => row.map(escape).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
      downloadUrls.current.push(url);
      const link = document.createElement("a"); link.href = url; link.download = `careiq-manager-summary-${date}.csv`; link.click();
      setNotice(tr("exportReady")); exportAttempt.current = { day: "", key: "" };
    } catch (cause) { if (!signal?.aborted) setError(uiError(cause, "workflow.insurance.exportError")); }
    finally { exportLock.current = false; if (!signal?.aborted) setExportBusy(false); }
  }
  const visible = items.filter(item => (filter === "all" || filter === "attention" && attention(item) || filter === "reviewed" && ["active", "inactive"].includes(item.status) || filter === "unassigned" && !item.assigneeUserId && item.status !== "active" || filter === item.status) && (owner === "all" || owner === "unassigned" && !item.assigneeUserId || owner === item.assigneeUserId) && `${item.patientName} ${item.payerName} ${item.memberIdMasked ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const selected = detail?.case;
  const currentEvidence = detail?.evidence.find(item => item.id === selected?.currentEvidenceId);
  function select(item: InsuranceCase) { setError(""); setSelectedId(item.id); setTab("summary"); }
  function openQueue(filterValue = "all") { setFilter(filterValue); onOpenQueue(); }
  return <div className="ci-workspace">
    <div className="ci-scope"><label className="wf-inline-field">{tr("appointmentDay")}<input type="date" value={date} onChange={event => event.target.value && onDateChange(event.target.value)} /></label><span className="ci-manual"><span aria-hidden="true">○</span>{tr("manualOnly")}</span>{mode === "manager" && canManage && <button className="wf-button" disabled={loading || exportBusy} onClick={() => void exportSummary()}>{tr(exportBusy ? "exporting" : "exportSummary")}</button>}<button className="wf-link" disabled={loading} onClick={() => setReload(value => value + 1)}>{tr("refresh")}</button></div>
    <div className="ci-disclosure"><span aria-hidden="true">ⓘ</span><p>{tr("payerUnavailable")}</p></div>
    {error && <div className="wf-notice wf-error" role="alert">{error}<button className="wf-link" onClick={() => setReload(value => value + 1)}>{tr("refresh")}</button></div>}
    {notice && <p role="status" className="wf-notice">{notice}</p>}
    {loading ? <div className="wf-loading" role="status"><span className="wf-skeleton" /><p>{tr("loading")}</p></div> : <>
      {mode === "manager" && summary && <>
        <div className="ci-metrics">{[["scheduled", summary.totalAppointments, "schedule"], ["reviewed", summary.reviewed, "reviewed"], ["attention", summary.needsAttention, "attention"], ["unassigned", summary.unassigned, "unassigned"]].map(([label, value, drill]) => <button className="ci-metric" key={label} onClick={() => drill === "schedule" ? onOpenSchedule() : openQueue(String(drill))}><span>{tr(String(label))}</span><strong>{formatNumber(Number(value))}</strong><small>{tr(`${label}Hint`)}</small></button>)}</div>
        <div className="ci-dashboard-grid"><section className="ci-panel"><div className="wf-section-head"><div><h2>{tr("outlook")}</h2><p className="wf-muted">{tr("outlookHint")}</p></div><button className="wf-button" onClick={() => openQueue()}>{tr("openQueue")} →</button></div><div className="ci-progress"><div style={{ width: `${summary.totalCases ? Math.min(100, summary.reviewed / summary.totalCases * 100) : 0}%` }} /></div><p className="ci-caption">{tr("reviewedCount", { reviewed: formatNumber(summary.reviewed), total: formatNumber(summary.totalCases) })}</p><div className="ci-untracked"><strong>{formatNumber(summary.withoutCase)}</strong><div><h3>{tr("withoutCase")}</h3><p>{tr("withoutCaseHint")}</p></div></div><h3>{tr("priorities")}</h3>{items.filter(attention).slice(0, 5).map(item => <button className="ci-priority" key={item.id} onClick={() => select(item)}><span className="ci-avatar">{item.patientName.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><span><strong>{item.patientName}</strong><small>{item.payerName} · {stamp(item.scheduledAt)}</small></span><span className="ci-status" data-state={item.status}>{status(item.status)}</span></button>)}{!items.some(attention) && <p className="ci-empty">{tr("noPriorities")}</p>}{nextCursor && <p className="ci-caption">{tr("prioritiesPartial")}</p>}</section><section className="ci-panel"><h2>{tr("teamWorkload")}</h2><p className="wf-muted">{tr("teamHint")}</p>{summary.workload.length ? summary.workload.map(row => <div className="ci-team" key={row.assigneeUserId ?? "unassigned"}><div><strong>{staff(row.assigneeUserId)}</strong><small>{tr("overdueCount", { count: formatNumber(row.needsAttention) })}</small></div><span>{formatNumber(row.total)}</span></div>) : <p className="ci-empty">{tr("noWork")}</p>}<div className="ci-audit-note"><span aria-hidden="true">↻</span><h3>{tr("accountable")}</h3><p>{tr("accountableHint")}</p></div></section></div>
      </>}
      {mode === "manager" && !summary && !error && <p className="ci-empty">{tr("managerRestricted")}</p>}
      {mode === "insurance" && <section className="ci-panel ci-queue"><div className="wf-section-head"><div><h2>{tr("queue")}</h2><p className="wf-muted">{tr("queueHint")}</p></div>{canManage && <button className="wf-button wf-primary" onClick={() => setEditor({ kind: "create" })}>＋ {tr("newCase")}</button>}</div><div className="ci-toolbar"><div className="wf-filters" aria-label={tr("filterLabel")}>{["all", "attention", "reviewed", "unassigned", "active", "unverified"].map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{["all", "attention", "reviewed", "unassigned"].includes(value) ? tr(value) : status(value)}</button>)}</div><label className="ci-search"><span className="ci-sr">{tr("search")}</span><input type="search" placeholder={tr("search")} value={search} onChange={event => setSearch(event.target.value)} /></label><label className="ci-owner"><span className="ci-sr">{tr("owner")}</span><select value={owner} onChange={event => setOwner(event.target.value)}><option value="all">{tr("allOwners")}</option><option value="unassigned">{tr("unassigned")}</option>{assignees.map(item => <option value={item.id} key={item.id}>{staff(item.id)}</option>)}</select></label></div><div className="ci-table-wrap"><table className="ci-table"><thead><tr>{["patient", "payer", "result", "appointment", "owner", "actions"].map(key => <th key={key} scope="col">{tr(key)}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.patientName}</strong><small>{item.memberIdMasked ?? tr("memberNotSet")}</small></td><td>{item.payerName}<small>{tr("manualVerification")}</small></td><td><span className="ci-status" data-state={item.status}>{status(item.status)}</span>{item.stale && <small>{tr("recheckDue")}</small>}</td><td>{stamp(item.scheduledAt)}{item.dueAt && <small>{tr("due")} {stamp(item.dueAt)}</small>}</td><td>{staff(item.assigneeUserId)}</td><td><button className="wf-button" onClick={() => select(item)} aria-label={tr("openPatient", { name: item.patientName })}>{tr("review")} →</button></td></tr>)}</tbody></table></div>{!visible.length && <div className="wf-empty"><h3>{tr(items.length ? "noMatches" : "noCases")}</h3><p>{tr(items.length ? "changeFilters" : "createHint")}</p></div>}<div className="ci-table-foot"><span>{tr("loadedCount", { count: formatNumber(items.length) })}{nextCursor ? ` · ${tr("moreAvailable")}` : ""}</span>{nextCursor && <button className="wf-button" disabled={moreBusy} onClick={() => void moreCases()}>{tr(moreBusy ? "loading" : "loadMore")}</button>}</div></section>}
    </>}
    {selectedId && <InterviewModal title={selected?.patientName ?? tr("caseDetails")} description={selected ? `${selected.payerName} · ${stamp(selected.scheduledAt)}` : tr("loading")} onClose={() => { setSelectedId(null); setDetail(null); }}><div className="ci-detail">
      {detailLoading && <p role="status">{tr("loading")}</p>}
      {!detailLoading && !detail && <p role="alert">{tr("loadError")}</p>}
      {selected && detail && <><div className="ci-detail-meta"><span className="ci-status" data-state={selected.status}>{status(selected.status)}</span><small>{tr("version", { revision: formatNumber(selected.revision) })}</small></div>{selected.stale && <div className="wf-notice"><strong>{tr("recheckDue")}</strong><p>{tr(selected.reviewReason === "appointment_changed" ? "appointmentChanged" : selected.reviewReason === "observation_expired" ? "observationExpired" : "evidenceMissing")}</p>{selected.recordedState && <p>{tr("priorOutcome", { result: status(selected.recordedState) })}</p>}</div>}<div className="wf-filters" aria-label={tr("detailTabs")}>{["summary", "evidence", ...(capabilities?.activity ? ["activity"] : [])].map(value => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{tr(value)}</button>)}</div>
      {tab === "summary" && <><dl className="ci-facts"><div><dt>{tr("payer")}</dt><dd>{selected.payerName}</dd></div><div><dt>{tr("member")}</dt><dd>{selected.memberIdMasked ?? tr("notSet")}</dd></div><div><dt>{tr("owner")}</dt><dd>{staff(selected.assigneeUserId)}</dd></div><div><dt>{tr("followUpDue")}</dt><dd>{stamp(selected.dueAt)}</dd></div></dl><h3>{tr("recordedBenefits")}</h3><div className="ci-benefits"><div><span>{tr("copay")}</span><strong>{money(currentEvidence?.copayCents)}</strong></div><div><span>{tr("deductible")}</span><strong>{money(currentEvidence?.deductibleRemainingCents)}</strong></div><div><span>{tr("coinsurance")}</span><strong>{currentEvidence?.coinsurancePercent == null ? tr("unknown") : `${formatNumber(currentEvidence.coinsurancePercent)}%`}</strong></div></div><p className="ci-caption">{tr("benefitsHint")}</p>{currentEvidence ? <div className="ci-evidence-summary"><strong>{tr(`source.${currentEvidence.source}`)}</strong><p>{tr("observed")} {stamp(currentEvidence.observedAt)}</p><p>{tr("recorded")} {stamp(currentEvidence.recordedAt)}</p><p>{tr("reference")} · {currentEvidence.reference}</p></div> : <p className="ci-empty">{tr("noEvidence")}</p>}</>}
      {tab === "evidence" && <><p className="ci-caption">{tr("evidenceHint")}</p>{detail.evidence.map(item => <article className="ci-evidence" key={item.id}><div className="wf-section-head"><strong>{status(item.outcome)}</strong><span className="wf-badge">{tr(item.id === selected.currentEvidenceId ? "current" : "historical")}</span></div><p>{tr(`source.${item.source}`)} · {item.reference}</p><small>{tr("observed")} {stamp(item.observedAt)}<br />{tr("recorded")} {stamp(item.recordedAt)}{item.actorLabel ? ` · ${tr("staffId", { id: item.actorLabel })}` : ""}</small>{item.supersedesEvidenceId && <p className="ci-caption">{tr("correction")}</p>}{canEvidence && selected.allowedActions.includes("evidence") && item.id === selected.currentEvidenceId && <button className="wf-link" onClick={() => setEditor({ kind: "evidence", correctionId: item.id })}>{tr("correctEvidence")}</button>}</article>)}{!detail.evidence.length && <p className="ci-empty">{tr("noEvidence")}</p>}{detail.evidenceHasMore && <button className="wf-button" disabled={moreBusy || !detail.evidenceCursor} onClick={() => void moreHistory("evidence")}>{tr("loadMore")}</button>}</>}
      {tab === "activity" && <><p className="ci-caption">{tr("activityHint")}</p><ol className="wf-activity">{detail.activity.map(event => <li key={event.id}><strong>{event.summary || tr(`event.${eventKind(event.action)}`)}</strong><small>{event.actorLabel} · {stamp(event.occurredAt)}{event.outcome ? ` · ${event.outcome}` : ""}</small></li>)}</ol>{!detail.activity.length && <p className="ci-empty">{tr("noActivity")}</p>}{detail.activityHasMore && <button className="wf-button" disabled={moreBusy || !detail.activityCursor} onClick={() => void moreHistory("activity")}>{tr("loadMore")}</button>}</>}
      <div className="ci-detail-actions">{canManage && selected.allowedActions.includes("follow_up") && <button className="wf-button" onClick={() => setEditor({ kind: "coverage" })}>{tr("correctCoverage")}</button>}{canManage && selected.allowedActions.includes("follow_up") && <button className="wf-button" onClick={() => setEditor({ kind: "follow_up" })}>{tr("assignFollowUp")}</button>}{canEvidence && selected.allowedActions.includes("evidence") && <button className="wf-button wf-primary" onClick={() => setEditor({ kind: "evidence" })}>{tr("recordEvidence")}</button>}</div></>}
    </div></InterviewModal>}
    {editor && <InsuranceEditor key={`${editor.kind}-${editor.correctionId ?? "new"}`} editor={editor} adapter={adapter} selected={selected} snapshot={snapshot} cases={items} assignees={assignees} onLoadAppointments={onLoadAppointments} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice(tr("saved")); setReload(value => value + 1); }} />}
  </div>;
}

function InsuranceEditor({ editor, adapter, selected, snapshot, cases, assignees, onLoadAppointments, onClose, onSaved }: {
  editor: Editor; adapter: InsuranceAdapter; selected?: InsuranceCase; snapshot: WorkflowSnapshot; cases: InsuranceCase[]; assignees: InsuranceAssignee[]; onLoadAppointments: () => void; onClose: () => void; onSaved: () => void;
}) {
  const { t, formatDate, uiError } = useI18n();
  const tr = (key: string, values?: Record<string, string | number>) => t(`workflow.insurance.${key}`, values);
  const [values, setValues] = useState<Record<string, string>>({ appointmentId: "", payerName: editor.kind === "coverage" ? selected?.payerName ?? "" : "", memberId: "", memberAction: "preserve", assigneeUserId: selected?.assigneeUserId ?? "", dueAt: selected?.dueAt ? localDateTime(selected.dueAt, snapshot.timeZone) : "", source: "payer_portal", observedAt: localDateTime(new Date().toISOString(), snapshot.timeZone), reference: "", outcome: "active", copay: "", deductible: "", coinsurance: "", reasonCode: "follow_up" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const lock = useRef(false); const attempt = useRef({ fingerprint: "", key: "" }); const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, [adapter]);
  const set = (key: string, value: string) => setValues(old => ({ ...old, [key]: value }));
  function field(key: string, label: string, type = "text", required = false) { return <label className="wf-field">{tr(label)}<input disabled={type === "number" && values.outcome !== "active"} aria-label={tr(label)} type={type} value={values[key]} required={required} maxLength={type === "text" ? key === "memberId" || key === "payerName" ? 120 : 200 : undefined} {...(type === "number" ? { min: 0, step: key === "coinsurance" ? "1" : "0.01", ...(key === "coinsurance" ? { max: 100 } : {}) } : {})} onChange={event => set(key, event.target.value)} />{["observedAt", "dueAt"].includes(key) && <small>{snapshot.timeZone}</small>}</label>; }
  function instant(value: string) { try { return instantFromLocal(value, snapshot.timeZone); } catch { throw new Error("INVALID_INSURANCE_TIME"); } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(""); const signal = lifecycle.current?.signal;
    try {
      const fingerprint = JSON.stringify({ values, kind: editor.kind, correction: editor.correctionId, caseId: selected?.id, revision: selected?.revision });
      if (attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
      const options = { key: attempt.current.key, revision: selected?.revision, signal };
      if (editor.kind === "create") await adapter.create({ appointmentId: values.appointmentId, payerName: values.payerName.trim(), ...(values.memberId.trim() ? { memberId: values.memberId.trim() } : {}), assigneeUserId: values.assigneeUserId || null, dueAt: values.dueAt ? instant(values.dueAt) : null }, options);
      else if (editor.kind === "coverage" && selected) await adapter.coverage(selected.id, { payerName: values.payerName.trim(), reasonCode: "correction", ...(values.memberAction === "replace" ? { memberId: values.memberId.trim() } : values.memberAction === "clear" ? { memberId: null } : {}) }, options);
      else if (editor.kind === "follow_up" && selected) await adapter.followUp(selected.id, { assigneeUserId: values.assigneeUserId || null, dueAt: values.dueAt ? instant(values.dueAt) : null, reasonCode: values.reasonCode as "assignment" | "follow_up" | "correction" }, options);
      else if (editor.kind === "evidence" && selected) {
        const observedAt = instant(values.observedAt);
        if (new Date(observedAt).getTime() > Date.now()) throw new Error("FUTURE_INSURANCE_TIME");
        const coinsurancePercent = values.outcome === "active" ? insuranceAmount(values.coinsurance) : null;
        if (coinsurancePercent != null && (coinsurancePercent > 100 || !Number.isInteger(coinsurancePercent))) throw new Error("INVALID_INSURANCE_AMOUNT");
        const input: InsuranceEvidenceInput = { source: values.source as InsuranceEvidenceInput["source"], outcome: values.outcome as InsuranceEvidenceInput["outcome"], observedAt, reference: values.reference.trim(), copayCents: values.outcome === "active" ? insuranceAmount(values.copay, true) : null, deductibleRemainingCents: values.outcome === "active" ? insuranceAmount(values.deductible, true) : null, coinsurancePercent, reasonCode: editor.correctionId ? "correction" : "manual_verification", ...(editor.correctionId ? { supersedesEvidenceId: editor.correctionId } : {}) };
        await adapter.evidence(selected.id, input, options);
      }
      if (!signal?.aborted) onSaved();
    } catch (cause) {
      if (signal?.aborted) return;
      const message = cause instanceof Error ? cause.message : "";
      setError(cause instanceof ApiError && cause.status === 409 ? tr("conflict") : message === "INVALID_INSURANCE_AMOUNT" ? tr("amountError") : message === "FUTURE_INSURANCE_TIME" ? tr("futureError") : message.includes("INSURANCE_TIME") ? tr("timeError") : uiError(cause, "workflow.insurance.saveError"));
    } finally { lock.current = false; if (!signal?.aborted) setBusy(false); }
  }
  const appointments = snapshot.appointments.filter(item => !["cancelled", "completed", "no_show"].includes(item.status) && !cases.some(record => record.appointmentId === item.id));
  return <InterviewModal title={tr(editor.correctionId ? "correctEvidence" : editor.kind === "create" ? "newCase" : editor.kind === "coverage" ? "correctCoverage" : editor.kind === "evidence" ? "recordEvidence" : "assignFollowUp")} description={tr(editor.kind === "evidence" ? "evidenceFormHint" : "formHint")} busy={busy} onClose={() => !busy && onClose()}><form className="wf-form" onSubmit={submit}>{error && <div className="wf-notice wf-error" role="alert">{error}</div>}<fieldset disabled={busy}>
    {editor.kind === "create" && <><label className="wf-field">{tr("appointment")}<select aria-label={tr("appointment")} required value={values.appointmentId} onChange={event => set("appointmentId", event.target.value)}><option value="">{tr("chooseAppointment")}</option>{appointments.map(item => <option key={item.id} value={item.id}>{patientName(item.patient ?? snapshot.patients.find(patient => patient.id === item.patientId))} · {formatDate(item.scheduledAt, { timeZone: snapshot.timeZone, dateStyle: "medium", timeStyle: "short" })}</option>)}</select></label>{snapshot.pagination?.appointments?.hasMore && <button className="wf-button" type="button" onClick={onLoadAppointments}>{tr("moreAppointments")}</button>}{field("payerName", "payer", "text", true)}{field("memberId", "member")}<p className="ci-caption">{tr("memberHint")}</p></>}
    {editor.kind === "coverage" && <>{field("payerName", "payer", "text", true)}<label className="wf-field">{tr("member")}<select aria-label={tr("memberChange")} value={values.memberAction} onChange={event => set("memberAction", event.target.value)}>{["preserve", "replace", "clear"].map(value => <option key={value} value={value}>{tr(`memberAction.${value}`)}</option>)}</select></label>{values.memberAction === "replace" && field("memberId", "newMember", "text", true)}<div className="wf-notice">{tr("coverageCorrectionHint")}</div></>}
    {["create", "follow_up"].includes(editor.kind) && <><label className="wf-field">{tr("owner")}<select aria-label={tr("owner")} value={values.assigneeUserId} onChange={event => set("assigneeUserId", event.target.value)}><option value="">{tr("unassigned")}</option>{assignees.map(item => <option key={item.id} value={item.id}>{tr("staffId", { id: item.label })}</option>)}</select></label>{field("dueAt", "followUpDue", "datetime-local")}{editor.kind === "follow_up" && <label className="wf-field">{tr("reason")}<select aria-label={tr("reason")} value={values.reasonCode} onChange={event => set("reasonCode", event.target.value)}>{["assignment", "follow_up", "correction"].map(value => <option key={value} value={value}>{tr(`reason.${value}`)}</option>)}</select></label>}</>}
    {editor.kind === "evidence" && <><label className="wf-field">{tr("sourceLabel")}<select aria-label={tr("sourceLabel")} value={values.source} onChange={event => set("source", event.target.value)}>{["payer_portal", "phone", "document"].map(value => <option key={value} value={value}>{tr(`source.${value}`)}</option>)}</select></label>{field("observedAt", "checkedAt", "datetime-local", true)}{field("reference", "reference", "text", true)}<label className="wf-field">{tr("result")}<select aria-label={tr("result")} value={values.outcome} onChange={event => set("outcome", event.target.value)}>{["active", "inactive", "needs_follow_up"].map(value => <option key={value} value={value}>{tr(`state.${value}`)}</option>)}</select></label><div className="wf-form-grid">{field("copay", "copay", "number")}{field("deductible", "deductible", "number")}{field("coinsurance", "coinsurance", "number")}</div><p className="ci-caption">{tr(values.outcome === "active" ? "unknownHint" : "benefitsUnknown")}</p>{editor.correctionId && <div className="wf-notice">{tr("correctionHint")}</div>}</>}
    </fieldset><footer className="wf-dialog-footer"><button type="button" className="wf-button" disabled={busy} onClick={onClose}>{tr("cancel")}</button><button type="submit" className="wf-button wf-primary" disabled={busy}>{tr(busy ? "saving" : "save")}</button></footer></form></InterviewModal>;
}
