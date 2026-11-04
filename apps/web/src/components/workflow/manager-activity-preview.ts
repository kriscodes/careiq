import type {
  InsuranceDetail,
  ManagerActivityEvent,
  ManagerActivityPage,
  ManagerActivityQuery,
} from '@/lib/api/insurance';
import type { WorkflowSnapshot } from '@/lib/api/workflow';
import { practiceDateKey } from '@/lib/today-operations';

/** Explicit workflow-preview events only; this does not infer a production audit trail from current records. */
export function previewManagerActivity(
  snapshot: WorkflowSnapshot,
  records: InsuranceDetail[],
  query: ManagerActivityQuery,
): ManagerActivityPage {
  const appointments: ManagerActivityEvent[] = snapshot.appointments.map((appointment, index) => ({
    id: `synthetic-booking-${appointment.id}`,
    occurredAt: snapshot.asOf,
    action: 'appointments.create',
    category: 'appointments',
    entityType: 'appointment',
    entityId: appointment.id,
    actorId: index % 2 ? 'synthetic-manager' : 'synthetic-staff',
    actorType: 'user',
    actorLabel: index % 2 ? 'manager' : 'staff',
    outcome: 'succeeded',
    result: 'scheduled',
    source: null,
  }));
  const insurance: ManagerActivityEvent[] = records.flatMap((record) =>
    record.activity.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      action:
        event.action === 'insurance.follow_up.updated'
          ? 'insurance.follow_up.revised'
          : event.action,
      category: event.action.includes('follow_up')
        ? ('followups' as const)
        : ('insurance' as const),
      entityType: 'insurance_case',
      entityId: record.case.id,
      actorId: 'synthetic-staff',
      actorType: 'user',
      actorLabel: 'staff',
      outcome: 'succeeded',
      result: event.result ?? null,
      source: event.source ?? null,
    })),
  );
  const scoped = [...appointments, ...insurance]
    .filter((event) => {
      const day = practiceDateKey(new Date(event.occurredAt), snapshot.timeZone);
      return day >= query.from && day <= query.to;
    })
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id),
    );
  const filtered = scoped.filter(
    (event) =>
      (!query.actorId || query.actorId === event.actorId) &&
      (!query.category || query.category === 'all' || query.category === event.category),
  );
  const actors = [
    ...new Map(
      scoped.map((event) => [event.actorId, { id: event.actorId, label: event.actorLabel }]),
    ).values(),
  ];
  const offset = Math.max(0, Number(query.cursor) || 0);
  const items = filtered.slice(offset, offset + 50);
  const hasMore = offset + items.length < filtered.length;
  return {
    from: query.from,
    to: query.to,
    asOf: snapshot.asOf,
    timeZone: snapshot.timeZone,
    summary: {
      total: filtered.length,
      appointments: filtered.filter((item) => item.category === 'appointments').length,
      insurance: filtered.filter((item) => item.category === 'insurance').length,
      followups: filtered.filter((item) => item.category === 'followups').length,
    },
    actors,
    items,
    pagination: { hasMore, nextCursor: hasMore ? String(offset + items.length) : null },
  };
}
