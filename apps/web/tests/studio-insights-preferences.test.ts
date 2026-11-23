import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsPreference } from '../src/app/analytics-privacy/AnalyticsPreference';
import { StudioInsights } from '../src/components/StudioInsights';

const copy = {
  excluded: 'Excluded',
  included: 'Included',
  browserBlocked: 'Blocked by your browser',
  exclude: 'Exclude visits',
  include: 'Allow analytics',
};

test('analytics mounts without adding server markup before browser preferences are available', () => {
  const component = React.createElement(AnalyticsPreference, { copy });
  assert.equal(renderToStaticMarkup(component), '');
  assert.equal(renderToStaticMarkup(React.createElement(StudioInsights)), '');
});

test('the preferences control uses the browser preference to label its action', (context) => {
  let preference = 'browser-blocked';
  context.mock.method(React, 'useSyncExternalStore', () => preference);
  const component = React.createElement(AnalyticsPreference, { copy });
  assert.match(renderToStaticMarkup(component), /Blocked by your browser/);
  assert.doesNotMatch(renderToStaticMarkup(component), /<button/);
  preference = 'included';
  assert.match(renderToStaticMarkup(component), /role="status">Included/);
  assert.match(renderToStaticMarkup(component), /Exclude visits/);
  preference = 'excluded';
  assert.match(renderToStaticMarkup(component), /role="status">Excluded/);
  assert.match(renderToStaticMarkup(component), /Allow analytics/);
});
