'use client';

import { useSyncExternalStore } from 'react';
import {
  analyticsPreference,
  setAnalyticsOptOut,
  subscribeToAnalyticsPreference,
} from '../../../../../packages/studio-insights/collector';

export function AnalyticsPreference({
  copy,
}: {
  copy: Record<'excluded' | 'included' | 'browserBlocked' | 'exclude' | 'include', string>;
}) {
  const preference = useSyncExternalStore(
    subscribeToAnalyticsPreference,
    analyticsPreference,
    () => null,
  );
  if (!preference) {
    return null;
  }
  if (preference === 'browser-blocked') {
    return <p>{copy.browserBlocked}</p>;
  }
  const excluded = preference === 'excluded';
  return (
    <>
      <p role="status">{excluded ? copy.excluded : copy.included}</p>
      <button className="cq-a-primary" type="button" onClick={() => setAnalyticsOptOut(!excluded)}>
        {excluded ? copy.include : copy.exclude}
      </button>
    </>
  );
}
