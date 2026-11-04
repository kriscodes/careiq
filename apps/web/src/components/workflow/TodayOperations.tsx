'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { InterviewIcon } from '@/components/InterviewIcon';
import { patientName, type WorkflowAppointment, type WorkflowSnapshot } from '@/lib/api/workflow';
import { workflowDate, workflowReadiness, workflowStatus } from './workflow-i18n';
import {
  isActiveVisit,
  nextVisitStatus,
  practiceDateKey,
  visitReadinessTone,
} from '@/lib/today-operations';
import './today-operations.css';

export type TodayFilter = 'all' | 'here' | 'attention' | 'cancelled';
export function TodayOperations({
  snapshot,
  date,
  selectedId,
  filter,
  onFilterChange,
  busy,
  refreshing,
  onSelect,
  canUpdate,
  onAdvance,
  onRefresh,
  details,
  more,
}: {
  snapshot: WorkflowSnapshot;
  date: string;
  selectedId: string | null;
  filter: TodayFilter;
  onFilterChange: (value: TodayFilter) => void;
  busy: boolean;
  refreshing: boolean;
  onSelect: (appointment: WorkflowAppointment) => void;
  canUpdate: (appointment: WorkflowAppointment) => boolean;
  onAdvance: (appointment: WorkflowAppointment, status: string) => void;
  onRefresh: () => void;
  details: ReactNode;
  more: ReactNode;
}) {
  const { t, locale, formatNumber } = useI18n();
  const visits = snapshot.appointments
    .filter((visit) => practiceDateKey(new Date(visit.scheduledAt), snapshot.timeZone) === date)
    .sort(
      (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id),
    );
  const attention = visits.filter(
    (visit) => isActiveVisit(visit) && visitReadinessTone(visit) === 'attention',
  );
  const visible = visits.filter(
    (visit) =>
      filter === 'all' ||
      (filter === 'here' && ['checked_in', 'in_progress'].includes(visit.status)) ||
      (filter === 'attention' && attention.includes(visit)) ||
      (filter === 'cancelled' && visit.status === 'cancelled'),
  );
  const paged = snapshot.pagination?.appointments?.hasMore === true;
  const total = (key: string, fallback: number) =>
    typeof snapshot.summary?.[key] === 'number'
      ? formatNumber(snapshot.summary[key])
      : paged ||
          (key === 'appointmentsNeedingDocuments' &&
            visits.some((visit) => isActiveVisit(visit) && visitReadinessTone(visit) === 'unknown'))
        ? '—'
        : formatNumber(fallback);
  const label = (visit: WorkflowAppointment) => {
    const person = snapshot.patients.find((patient) => patient.id === visit.patientId);
    return person
      ? patientName(person, locale)
      : visit.patient?.displayName ||
          (visit.patient?.firstName
            ? `${visit.patient.firstName} ${visit.patient.lastName ?? ''}`.trim()
            : t('workflow.labels.patientUnavailable'));
  };
  const advanceLabel = (visit: WorkflowAppointment) =>
    t(
      visit.status === 'checked_in'
        ? 'workflow.today.startVisit'
        : visit.status === 'in_progress'
          ? 'workflow.today.completeVisit'
          : 'workflow.today.checkIn',
    );
  return (
    <div className="wf-today">
      <div className="wf-kpis wf-today-kpis">
        <div>
          <strong>{total('activeAppointments', visits.filter(isActiveVisit).length)}</strong>
          <span>{t('workflow.today.activeVisits')}</span>
        </div>
        <div>
          <strong>
            {total('checkedIn', visits.filter((visit) => visit.status === 'checked_in').length)}
          </strong>
          <span>{t('workflow.today.checkedIn')}</span>
        </div>
        <div className="wf-attention-count">
          <strong>{total('appointmentsNeedingDocuments', attention.length)}</strong>
          <span>{t('workflow.today.needsPaperwork')}</span>
        </div>
      </div>
      <div className="wf-today-layout">
        <section className="wf-today-queue" aria-label={t('workflow.today.patientFlow')}>
          <div className="wf-section-head">
            <div>
              <h2>{t('workflow.today.patientFlow')}</h2>
              <p className="wf-muted">
                {t('workflow.today.localDay', {
                  date: new Intl.DateTimeFormat(locale, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(`${date}T12:00:00Z`)),
                  zone: snapshot.timeZone,
                })}
              </p>
            </div>
            <button
              type="button"
              className="wf-button wf-today-refresh"
              onClick={onRefresh}
              disabled={busy || refreshing}
            >
              {t('workflow.today.refresh')}
            </button>
          </div>
          <div
            className="wf-filters"
            role="group"
            aria-label={t('workflow.text.filterAppointments')}
          >
            {(['all', 'here', 'attention', 'cancelled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => onFilterChange(value)}
              >
                {t(
                  value === 'all'
                    ? 'workflow.text.allVisits'
                    : value === 'here'
                      ? 'workflow.today.here'
                      : value === 'attention'
                        ? 'workflow.text.needsAttention'
                        : 'workflow.status.cancelled',
                )}
              </button>
            ))}
          </div>
          {paged && (
            <p className="wf-muted wf-today-page-note">{t('workflow.today.loadedVisitsNote')}</p>
          )}
          <div className="wf-today-visits">
            {visible.map((visit) => {
              const provider = snapshot.providers.find((value) => value.id === visit.providerId);
              const visitType = snapshot.visitTypes.find((value) => value.id === visit.visitTypeId);
              const next = nextVisitStatus(visit);
              const tone = visitReadinessTone(visit);
              return (
                <article
                  className="wf-today-visit-row"
                  data-selected={selectedId === visit.id || undefined}
                  key={visit.id}
                >
                  <button
                    type="button"
                    className="wf-visit wf-today-visit"
                    aria-pressed={selectedId === visit.id}
                    data-appointment-id={visit.id}
                    onClick={() => onSelect(visit)}
                  >
                    <time dateTime={visit.scheduledAt}>
                      {workflowDate(locale, visit.scheduledAt, snapshot.timeZone)}
                    </time>
                    <span className="wf-today-person">
                      <strong>{label(visit)}</strong>
                      <small>
                        {visit.reason || visitType?.name || t('workflow.text.appointment')} ·{' '}
                        {provider?.name ||
                          visit.provider?.displayName ||
                          visit.provider?.name ||
                          t('workflow.text.unassignedProvider')}
                      </small>
                      <span className="wf-today-tags">
                        <span
                          className="wf-badge"
                          data-tone={
                            ['checked_in', 'in_progress'].includes(visit.status)
                              ? 'info'
                              : 'neutral'
                          }
                        >
                          {workflowStatus(locale, visit.status)}
                        </span>
                        <span
                          className="wf-badge"
                          data-tone={
                            tone === 'ready'
                              ? 'success'
                              : tone === 'attention'
                                ? 'attention'
                                : 'neutral'
                          }
                        >
                          {tone === 'unknown'
                            ? t('workflow.readiness.unavailable')
                            : workflowReadiness(locale, visit.readiness)}
                        </span>
                      </span>
                    </span>
                    <InterviewIcon name="chevron-right" />
                  </button>
                  {next && canUpdate(visit) && (
                    <button
                      type="button"
                      className="wf-button wf-today-advance"
                      onClick={() => onAdvance(visit, next)}
                      disabled={busy}
                    >
                      {advanceLabel(visit)}
                    </button>
                  )}
                </article>
              );
            })}
            {!visible.length && (
              <div className="wf-empty">
                <h3>{t('workflow.text.aLittleBreathingRoom')}</h3>
                <p>{t('workflow.text.noAppointmentsMatchThisDayAndFilter')}</p>
              </div>
            )}
          </div>
          {more}
        </section>
        <div className="wf-today-side">
          {attention.length > 0 && (
            <section className="wf-today-blocker">
              <div className="wf-section-head">
                <h3>{t('workflow.today.beforeVisit')}</h3>
                <InterviewIcon name="file" />
              </div>
              <strong>{label(attention[0])}</strong>
              <p>
                {workflowDate(locale, attention[0].scheduledAt, snapshot.timeZone)} ·{' '}
                {workflowReadiness(locale, attention[0].readiness)}
              </p>
              <button type="button" className="wf-link" onClick={() => onSelect(attention[0])}>
                {t('workflow.today.reviewPaperwork')}
                <InterviewIcon name="arrow" />
              </button>
            </section>
          )}
          {details}
        </div>
      </div>
    </div>
  );
}
