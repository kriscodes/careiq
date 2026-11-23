import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

type CapturedRequest = {
  endpoint: string;
  options: RequestInit;
  payload: Record<string, unknown>;
};

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

test('CareIQ analytics emits safe records and keeps preferences local', async (context) => {
  const collector = 'https://analytics.kristiansalmeron.com';
  const setting = 'NEXT_PUBLIC_STUDIO_INSIGHTS_ORIGIN';
  const previousSetting = process.env[setting];
  process.env[setting] = collector;
  const { observeStudioPage, setAnalyticsOptOut, analyticsPreference, studioInsightsOrigin } =
    await import('../../../packages/studio-insights/collector');
  if (previousSetting === undefined) delete process.env[setting];
  else process.env[setting] = previousSetting;

  const requests: CapturedRequest[] = [];
  const page = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    referrer: 'https://www.linkedin.com/private-profile/?token=private-token',
    documentElement: { scrollHeight: 2000 },
  });
  const browser = Object.assign(new EventTarget(), {
    location: new URL('https://app.careiqlabs.com/?ticket=private-ticket#identifier'),
    localStorage: storage(),
    sessionStorage: storage(),
    document: page,
    crypto: { randomUUID },
    setInterval: () => 7,
    clearInterval: () => {},
    innerHeight: 1000,
    scrollY: 0,
  });
  const privacy = { globalPrivacyControl: false, doNotTrack: '0' };
  const globals = {
    window: browser,
    document: page,
    navigator: privacy,
    fetch: (endpoint: string, options: RequestInit) => {
      requests.push({ endpoint, options, payload: JSON.parse(String(options.body)) });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  };
  const descriptors = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  context.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let now = Date.parse('2026-11-22T19:00:00Z');
  context.mock.method(Date, 'now', () => now);

  assert.equal(studioInsightsOrigin('app.careiqlabs.com', 'careiq-web'), collector);
  assert.equal(studioInsightsOrigin('staging.careiqlabs.com', 'careiq-web'), undefined);
  assert.equal(studioInsightsOrigin('careiqlabs.com', 'careiq-web'), undefined);
  for (const path of ['/audit', '/patient-workflow/123', '/analytics-privacy/', '/join']) {
    observeStudioPage('careiq-web', path);
  }
  assert.equal(requests.length, 0);
  observeStudioPage('careiq-web', '/');
  const web = requests[0];
  assert.equal(web.endpoint, collector + '/api/analytics/collect');
  assert.equal(web.options.credentials, 'omit');
  assert.equal(web.options.referrerPolicy, 'no-referrer');
  assert.equal(web.options.redirect, 'error');
  assert.equal(web.payload.site, 'careiq-web');
  assert.equal(web.payload.path, '/');
  assert.equal(web.payload.visitScope, 'local');
  assert.equal(web.payload.source, 'unknown');
  assert.equal(web.payload.referrer, undefined);
  assert.equal(web.payload.previousPageId, undefined);
  assert.doesNotMatch(String(web.options.body), /private|token|ticket/);

  setAnalyticsOptOut(true);
  assert.equal(analyticsPreference(), 'excluded');
  assert.equal(browser.sessionStorage.length, 0);
  assert.equal(browser.localStorage.length, 1);
  observeStudioPage('careiq-web', '/');
  assert.equal(requests.length, 1);
  setAnalyticsOptOut(false);
  privacy.globalPrivacyControl = true;
  observeStudioPage('careiq-web', '/');
  assert.equal(analyticsPreference(), 'browser-blocked');
  assert.equal(requests.length, 1);
  privacy.globalPrivacyControl = false;
  privacy.doNotTrack = '1';
  observeStudioPage('careiq-web', '/');
  assert.equal(requests.length, 1);
  privacy.doNotTrack = '0';

  browser.location = new URL('https://careiqlabs.com/research/?utm_campaign=private-name');
  browser.localStorage = storage();
  browser.sessionStorage = storage();
  const stopMarketing = observeStudioPage('careiq-marketing', '/research');
  assert.ok(stopMarketing);
  const marketing = requests[1];
  assert.equal(marketing.payload.site, 'careiq-marketing');
  assert.equal(marketing.payload.path, '/research/');
  assert.equal(marketing.payload.source, 'linkedin');
  assert.equal(marketing.payload.referrer, 'linkedin.com');
  assert.equal(marketing.payload.campaign, '');
  assert.doesNotMatch(String(marketing.options.body), /private|token|profile/);
  now += 2000;
  browser.scrollY = 540;
  browser.dispatchEvent(new Event('scroll'));
  assert.equal(requests[2].payload.scrollDepth, 50);
  stopMarketing();
  assert.equal(requests[3].payload.activeMs, 2000);
  assert.equal(requests[3].payload.pageId, marketing.payload.pageId);
  observeStudioPage('careiq-marketing', '/privacy/');
  assert.equal(requests.length, 4);
  const stopHome = observeStudioPage('careiq-marketing', '/');
  assert.equal(requests[4].payload.sessionId, marketing.payload.sessionId);
  assert.equal(requests[4].payload.previousPageId, undefined);
  stopHome?.();
});
