import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('marketing exposes its analytics preference on the public privacy page', async (context) => {
  const key = 'NEXT_PUBLIC_STUDIO_INSIGHTS_ORIGIN';
  const previous = process.env[key];
  process.env[key] = 'https://analytics.kristiansalmeron.com';
  context.after(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });
  const { PrivacyContent } = await import('../src/components/PrivacyContent');
  const { StudioInsights } = await import('../src/components/StudioInsights');
  assert.equal(renderToStaticMarkup(React.createElement(StudioInsights)), '');
  const page = React.createElement(PrivacyContent);
  const serverMarkup = renderToStaticMarkup(page);
  assert.match(serverMarkup, /id="website-analytics"/);
  assert.doesNotMatch(serverMarkup, /Exclude my visits|Allow analytics/);

  let preference = 'included';
  context.mock.method(React, 'useSyncExternalStore', () => preference);
  assert.match(renderToStaticMarkup(page), /Exclude my visits/);
  preference = 'excluded';
  assert.match(renderToStaticMarkup(page), /Allow analytics/);
  preference = 'browser-blocked';
  assert.match(renderToStaticMarkup(page), /privacy setting blocks website analytics/);
  assert.doesNotMatch(renderToStaticMarkup(page), /Exclude my visits|Allow analytics/);
});
