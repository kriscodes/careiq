import { useState } from 'react';
import { ManagerActivity } from '../../../src/components/workflow/ManagerActivity';
import { createInsurancePreviewAdapter } from '../../../src/components/workflow/insurance-preview';
import { previewSeed } from '../../../src/components/workflow/preview-adapter';
import type {
  ManagerActivityEvent,
  ManagerActivityPage,
  ManagerActivityQuery,
} from '../../../src/lib/api/insurance';

declare global {
  interface Window {
    __careiqActivityCalls?: ManagerActivityQuery[];
    __careiqReleaseActivity?: () => void;
  }
}

const initialInstant = '2026-11-02T07:30:00Z';
const fixtureEvents: ManagerActivityEvent[] = Array.from({ length: 52 }, (_, index) => ({
  id: `event-${index}`,
  occurredAt: initialInstant,
  action:
    index % 3 === 0
      ? 'appointments.create'
      : index % 3 === 1
        ? 'insurance.evidence.recorded'
        : 'insurance.follow_up.revised',
  category: index % 3 === 0 ? 'appointments' : index % 3 === 1 ? 'insurance' : 'followups',
  entityType: index % 3 === 0 ? 'appointments' : 'insurance_case',
  entityId: `synthetic-record-${index}`,
  actorId: index % 2 ? 'user_historical_staff' : 'user_current_staff',
  actorType: 'user',
  actorLabel: index % 2 ? 'former02' : 'active01',
  outcome: 'succeeded',
  result: index % 3 === 0 ? 'scheduled' : index % 3 === 1 ? 'inactive' : null,
  source: index % 3 === 1 ? 'phone' : null,
}));

function response(query: ManagerActivityQuery): ManagerActivityPage {
  const day = query.from === '2026-11-01' || query.from === '2026-11-02' ? fixtureEvents : [];
  const filtered = day.filter(
    (item) =>
      (!query.actorId || item.actorId === query.actorId) &&
      (!query.category || query.category === 'all' || item.category === query.category),
  );
  const offset = Number(query.cursor) || 0;
  const items = filtered.slice(offset, offset + 50);
  return {
    from: query.from,
    to: query.to,
    timeZone: 'America/Los_Angeles',
    asOf: initialInstant,
    summary: {
      total: filtered.length,
      appointments: filtered.filter((item) => item.category === 'appointments').length,
      insurance: filtered.filter((item) => item.category === 'insurance').length,
      followups: filtered.filter((item) => item.category === 'followups').length,
    },
    actors: [
      { id: 'user_current_staff', label: 'active01' },
      { id: 'user_historical_staff', label: 'former02' },
    ],
    items,
    pagination: {
      hasMore: offset + items.length < filtered.length,
      nextCursor: offset + items.length < filtered.length ? String(offset + items.length) : null,
    },
  };
}

export function ManagerActivityHarness() {
  const [enabled, setEnabled] = useState(true);
  const [adapter] = useState(() => {
    const base = createInsurancePreviewAdapter(previewSeed);
    const scenario = new URLSearchParams(location.search).get('scenario');
    let failed = false;
    base.managerActivity = async (query) => {
      (window.__careiqActivityCalls ??= []).push(query);
      if (scenario === 'activity-stale' && query.from === '2026-11-02') {
        return new Promise((resolve) => {
          window.__careiqReleaseActivity = () => resolve(response(query));
        });
      } // Intentionally ignore cancellation.
      if (
        (scenario === 'activity-error' && !failed) ||
        (scenario === 'activity-more-error' && query.cursor && !failed)
      ) {
        failed = true;
        throw new Error('Synthetic unavailable activity');
      }
      return response(query);
    };
    return base;
  });
  return (
    <div className="wf-root" style={{ padding: 18 }}>
      <button type="button" onClick={() => setEnabled((value) => !value)}>
        Toggle activity permission
      </button>
      <button type="button" onClick={() => window.__careiqReleaseActivity?.()}>
        Release previous activity
      </button>
      <ManagerActivity
        adapter={adapter}
        enabled={enabled}
        timeZone="America/Los_Angeles"
        initialInstant={initialInstant}
      />
    </div>
  );
}
