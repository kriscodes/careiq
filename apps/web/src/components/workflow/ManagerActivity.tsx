"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { type InsuranceAdapter, type ManagerActivityCategory, type ManagerActivityEvent, type ManagerActivityPage } from "@/lib/api/insurance";
import { practiceDateKey } from "@/lib/today-operations";
import { workflowActivity, workflowStatus } from "./workflow-i18n";

const insuranceActions: Record<string, string> = {
  "insurance.case.created": "created",
  "insurance.coverage.revised": "coverage",
  "insurance.evidence.recorded": "evidence",
  "insurance.evidence.corrected": "corrected",
  "insurance.follow_up.revised": "follow_up",
};
type View = { controller: AbortController; adapter: InsuranceAdapter; key: string; data: ManagerActivityPage | null; error: string; moreError: string; loading: boolean; moreBusy: boolean };

/** This is an action-date view. Appointment-day readiness remains in the manager summary above. */
export function ManagerActivity({ adapter, enabled, timeZone, initialInstant, refreshVersion = 0 }: {
  adapter: InsuranceAdapter; enabled: boolean; timeZone: string; initialInstant: string; refreshVersion?: number;
}) {
  const { t, locale, formatDate, formatNumber, uiError } = useI18n();
  const tr = (key: string, values?: Record<string, string | number>) => t(`workflow.managerActivity.${key}`, values);
  const [day, setDay] = useState(() => practiceDateKey(new Date(initialInstant), timeZone));
  const [actorId, setActorId] = useState("");
  const [category, setCategory] = useState<ManagerActivityCategory | "all">("all");
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const moreLock = useRef(false);
  const key = `${timeZone}|${day}|${actorId}|${category}|${refresh}|${refreshVersion}`;
  const current = enabled && view?.adapter === adapter && view.key === key && !view.controller.signal.aborted ? view : null;
  const data = current?.data ?? null;
  const zone = data?.timeZone ?? timeZone;
  const message = useEffectEvent((error: unknown) => uiError(error, "workflow.managerActivity.loadError"));

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    lifecycle.current = controller;
    moreLock.current = false;
    queueMicrotask(() => {
      if (!controller.signal.aborted) setView({ controller, adapter, key, data: null, error: "", moreError: "", loading: true, moreBusy: false });
    });
    void adapter.managerActivity({ from: day, to: day, ...(actorId ? { actorId } : {}), category }, controller.signal).then(result => {
      if (!controller.signal.aborted) setView({ controller, adapter, key, data: result, error: "", moreError: "", loading: false, moreBusy: false });
    }).catch(error => {
      if (!controller.signal.aborted) setView({ controller, adapter, key, data: null, error: message(error), moreError: "", loading: false, moreBusy: false });
    });
    return () => controller.abort();
  }, [adapter, enabled, day, actorId, category, key]);

  async function loadMore() {
    const cursor = data?.pagination.nextCursor;
    const controller = lifecycle.current;
    if (!current || !data || !cursor || !controller || controller.signal.aborted || moreLock.current) return;
    moreLock.current = true;
    setView(old => old?.adapter === adapter && old.key === key ? { ...old, moreBusy: true, moreError: "" } : old);
    try {
      const page = await adapter.managerActivity({ from: day, to: day, ...(actorId ? { actorId } : {}), category, cursor }, controller.signal);
      if (controller.signal.aborted) return;
      setView(old => old?.adapter === adapter && old.key === key && old.data ? {
        ...old, moreBusy: false, moreError: "", data: { ...old.data, pagination: page.pagination, items: [...old.data.items, ...page.items.filter(item => !old.data!.items.some(existing => existing.id === item.id))] },
      } : old);
    } catch (error) {
      if (!controller.signal.aborted) setView(old => old?.adapter === adapter && old.key === key ? { ...old, moreBusy: false, moreError: uiError(error, "workflow.managerActivity.loadError") } : old);
    } finally {
      if (lifecycle.current === controller) moreLock.current = false;
    }
  }

  function action(event: ManagerActivityEvent) {
    const insurance = insuranceActions[event.action];
    return insurance ? t(`workflow.insurance.event.${insurance}`) : workflowActivity(locale, event.action);
  }
  function result(event: ManagerActivityEvent) {
    if (!event.result) return tr("recorded");
    return ["active", "inactive", "needs_follow_up", "unverified"].includes(event.result)
      ? t(`workflow.insurance.state.${event.result}`) : workflowStatus(locale, event.result);
  }

  if (!enabled) return null;
  return <section className="ci-panel ci-manager-activity" aria-label={tr("title")}>
    <div className="wf-section-head"><div><h2>{tr("title")}</h2><p className="wf-muted">{tr("hint")}</p></div><button type="button" className="wf-button" disabled={!current || current.loading} onClick={() => setRefresh(value => value + 1)}>{tr("refresh")}</button></div>
    <div className="ci-activity-filters">
      <label className="wf-field">{tr("day")}<input type="date" value={day} onChange={event => { if (event.target.value) { setDay(event.target.value); } }} /></label>
      <label className="wf-field">{tr("person")}<select aria-label={tr("person")} value={actorId} onChange={event => setActorId(event.target.value)}><option value="">{tr("everyone")}</option>{data?.actors.map(actor => <option key={actor.id} value={actor.id}>{t("workflow.insurance.staffId", { id: actor.label })}</option>)}{actorId && !data?.actors.some(actor => actor.id === actorId) && <option value={actorId}>{t("workflow.insurance.staffId", { id: actorId.slice(-8) })}</option>}</select></label>
      <label className="wf-field">{tr("type")}<select aria-label={tr("type")} value={category} onChange={event => setCategory(event.target.value as ManagerActivityCategory | "all")}>{["all", "appointments", "insurance", "followups"].map(value => <option value={value} key={value}>{tr(`category.${value}`)}</option>)}</select></label>
    </div>
    <p className="ci-caption">{tr("timeZone", { zone })}</p>
    {!current || current.loading ? <p className="ci-empty" role="status">{tr("loading")}</p> : current.error ? <div className="wf-notice wf-error" role="alert">{current.error}<button type="button" className="wf-link" onClick={() => setRefresh(value => value + 1)}>{tr("retry")}</button></div> : data && <>
      <div className="ci-activity-count" role="status">{tr("count", { count: formatNumber(data.summary.total), loaded: formatNumber(data.items.length) })}<span>{tr("asOf", { time: formatDate(data.asOf, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }) })}</span></div>
      {data.items.length ? <ol className="ci-team-activity-list">{data.items.map(event => <li key={event.id}><div className="ci-team-activity-main"><strong>{action(event)}</strong><span title={event.actorId}>{t("workflow.insurance.staffId", { id: event.actorLabel })} <span className="ci-sr">{event.actorId}</span></span>{event.entityId && <span title={event.entityId}>{tr(`record.${event.action.startsWith("appointments.") ? "appointment" : event.action.startsWith("insurance.") ? "insurance" : "followup"}`)} · #{event.entityId.slice(-8)}<span className="ci-sr"> {event.entityId}</span></span>}<time dateTime={event.occurredAt}>{formatDate(event.occurredAt, { timeZone: zone, dateStyle: "medium", timeStyle: "short" })}</time></div><div className="ci-team-activity-result"><span className="ci-status" data-state={event.result ?? undefined}>{result(event)}</span>{event.source && <small>{t(`workflow.insurance.source.${event.source}`)}</small>}</div></li>)}</ol> : <div className="ci-empty"><h3>{tr("empty")}</h3><p>{tr("emptyHint")}</p></div>}
      {current.moreError && <p className="wf-notice wf-error" role="alert">{current.moreError}</p>}
      {data.pagination.hasMore && <button type="button" className="wf-button" disabled={current.moreBusy || !data.pagination.nextCursor} onClick={() => void loadMore()}>{tr(current.moreBusy ? "loading" : "loadMore")}</button>}
    </>}
    <p className="ci-caption ci-activity-scope-note">{tr("scope")}</p>
  </section>;
}
