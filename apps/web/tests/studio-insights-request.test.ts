import 'next/dist/server/node-environment-baseline';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';

test('staff analytics preferences use the locale from the current request', async (context) => {
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
  const { default: AnalyticsPrivacy } = await import('../src/app/analytics-privacy/page');
  for (const [language, title, back] of [
    ['en', 'Analytics preferences', 'Back to CareIQ'],
    ['es', 'Preferencias de analítica', 'Volver a CareIQ'],
  ]) {
    const headers = new Headers({ 'accept-language': language });
    // Only the read-only request data used by the route needs a Next request context.
    const store = {
      type: 'request',
      phase: 'render',
      headers,
      cookies: new RequestCookies(headers),
    } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];
    const work = { route: '/analytics-privacy' } as Parameters<typeof workAsyncStorage.run>[0];
    const page = await workAsyncStorage.run(work, () =>
      workUnitAsyncStorage.run(store, () => AnalyticsPrivacy()),
    );
    const markup = renderToStaticMarkup(page);
    assert.ok(markup.includes('<h1 tabindex="-1">' + title + '</h1>'));
    assert.ok(markup.includes(back));
    assert.equal((markup.match(/href="\/analytics-privacy"/g) ?? []).length, 0);
  }
});
