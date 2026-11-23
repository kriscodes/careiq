type Site = 'careiq-web' | 'careiq-marketing';
type Attribution = { source: string; medium: string; referrer?: string; campaign?: string };
type Identity = { id: string; date: string };
type Visit = Identity & { lastAt: number; visitorId: string; previousPageId?: string };
type NavigatorPrivacy = Navigator & { globalPrivacyControl?: boolean };

const productionOrigin = 'https://analytics.kristiansalmeron.com';
const stagingOrigin = 'https://kristian-salmeron-api-staging.onrender.com';
const configuredOrigin = process.env.NEXT_PUBLIC_STUDIO_INSIGHTS_ORIGIN;
const hosts: Record<Site, Record<string, string>> = {
  'careiq-web': {
    'app.careiqlabs.com': productionOrigin,
    'careiq-web.onrender.com': productionOrigin,
    'staging.careiqlabs.com': stagingOrigin,
    'careiq-staging-web.onrender.com': stagingOrigin,
  },
  'careiq-marketing': {
    'careiqlabs.com': productionOrigin,
    'www.careiqlabs.com': productionOrigin,
    'careiq-marketing.onrender.com': productionOrigin,
    'marketing-staging.careiqlabs.com': stagingOrigin,
    'careiq-staging-marketing.onrender.com': stagingOrigin,
  },
};
const publicPages: Record<Site, ReadonlySet<string>> = {
  'careiq-web': new Set(['/']),
  'careiq-marketing': new Set(['/', '/research/']),
};
const preferenceKey = 'careiq.studio-insights.opt-out';
const visitorKey = 'careiq.studio-insights.visitor';
const visitKey = 'careiq.studio-insights.visit';
const preferenceChanged = 'careiq:studio-insights-preference';
const identifier = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const visitTimeout = 30 * 60_000;
const idleTimeout = 60_000;
const dailyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });

const referrerSources = {
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'instagram.com': 'instagram',
  'linkedin.com': 'linkedin',
  'tiktok.com': 'tiktok',
  'whatsapp.com': 'whatsapp',
  'wa.me': 'whatsapp',
  'github.com': 'github',
  'google.com': 'google',
  'bing.com': 'bing',
  'duckduckgo.com': 'duckduckgo',
};
const socialSources = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'whatsapp',
  'github',
]);
const searchSources = new Set(['google', 'bing', 'duckduckgo']);
const campaigns = new Set(['portfolio', 'bio', 'launch', 'winter-update']);
const unknown: Attribution = { source: 'unknown', medium: 'unknown' };

/** A build opts in to one fixed collector. Its host must belong to the same environment. */
export function studioInsightsOrigin(hostname: string, site: Site) {
  const allowed = hosts[site];
  return Object.hasOwn(allowed, hostname) && allowed[hostname] === configuredOrigin
    ? configuredOrigin
    : undefined;
}

export function studioInsightsConfiguredOrigin() {
  return configuredOrigin === productionOrigin || configuredOrigin === stagingOrigin
    ? configuredOrigin
    : undefined;
}

export function browserBlocksAnalytics() {
  const privacy = navigator as NavigatorPrivacy;
  return privacy.globalPrivacyControl === true || ['1', 'yes'].includes(privacy.doNotTrack ?? '');
}

export function getAnalyticsOptOut() {
  try {
    return window.localStorage.getItem(preferenceKey) === '1';
  } catch {
    return true;
  }
}

/** Opting out clears the daily browser and visit IDs for this site. */
export function setAnalyticsOptOut(optOut: boolean) {
  try {
    if (optOut) {
      window.localStorage.setItem(preferenceKey, '1');
      window.localStorage.removeItem(visitorKey);
      window.sessionStorage.removeItem(visitKey);
    } else {
      window.localStorage.removeItem(preferenceKey);
    }
  } catch {
    // Storage restrictions disable collection and can prevent saving the preference.
  }
  window.dispatchEvent(new Event(preferenceChanged));
}

export function analyticsPreference() {
  if (browserBlocksAnalytics()) {
    return 'browser-blocked';
  }
  return getAnalyticsOptOut() ? 'excluded' : 'included';
}

export function subscribeToAnalyticsPreference(listener: () => void) {
  window.addEventListener(preferenceChanged, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(preferenceChanged, listener);
    window.removeEventListener('storage', listener);
  };
}

function readIdentity<T extends Identity>(storage: Storage, key: string): T | null {
  const value = storage.getItem(key);
  if (!value) {
    return null;
  }
  try {
    const identity = JSON.parse(value) as T;
    return identity && identifier.test(identity.id) ? identity : null;
  } catch {
    return null;
  }
}

function marketingAttribution(browser: Window): Attribution {
  const settings = new URLSearchParams(browser.location.search);
  const tag = settings.get('utm_source') ?? '';
  const campaign = settings.get('utm_campaign') ?? '';
  let referrer = '';
  let referralSource = 'unknown';
  try {
    const url = new URL(browser.document.referrer);
    if (url.protocol === 'https:' && url.origin !== browser.location.origin) {
      referralSource = 'referral';
      for (const [host, source] of Object.entries(referrerSources)) {
        if (url.hostname === host || url.hostname.endsWith('.' + host)) {
          referrer = host;
          referralSource = source;
          break;
        }
      }
    }
  } catch {
    // Direct and unavailable referrers share the same aggregate bucket.
  }
  const source = socialSources.has(tag) ? tag : referralSource;
  const medium =
    source === 'whatsapp'
      ? 'messaging'
      : socialSources.has(source)
        ? 'social'
        : searchSources.has(source)
          ? 'organic'
          : source;
  return { source, medium, referrer, campaign: campaigns.has(campaign) ? campaign : '' };
}

/**
 * Starts measurement for an allowlisted page. The staff app emits one aggregate
 * entry pageview. Marketing also measures visible active time and scroll milestones.
 */
export function observeStudioPage(site: Site, pathname: string | null) {
  const origin = studioInsightsOrigin(window.location.hostname, site);
  if (
    !origin ||
    window.location.protocol !== 'https:' ||
    !pathname ||
    !window.crypto?.randomUUID ||
    browserBlocksAnalytics() ||
    getAnalyticsOptOut()
  ) {
    return;
  }
  const path = pathname.endsWith('/') ? pathname : pathname + '/';
  if (!publicPages[site].has(path)) {
    if (site === 'careiq-marketing') {
      try {
        const visit = readIdentity<Visit>(window.sessionStorage, visitKey);
        if (visit?.previousPageId) {
          delete visit.previousPageId;
          window.sessionStorage.setItem(visitKey, JSON.stringify(visit));
        }
      } catch {
        // Ignore unavailable storage on pages outside collection.
      }
    }
    return;
  }

  const now = Date.now();
  const date = dailyDate.format(now);
  const pageId = window.crypto.randomUUID();
  let visitorId: string;
  let visit: Visit;
  try {
    const visitor = readIdentity<Identity>(window.localStorage, visitorKey);
    visitorId = visitor?.date === date ? visitor.id : window.crypto.randomUUID();
    window.localStorage.setItem(visitorKey, JSON.stringify({ id: visitorId, date }));
    const previous = readIdentity<Visit>(window.sessionStorage, visitKey);
    visit =
      previous?.date === date &&
      previous.visitorId === visitorId &&
      previous.lastAt <= now &&
      now - previous.lastAt < visitTimeout
        ? { ...previous, lastAt: now }
        : { id: window.crypto.randomUUID(), date, lastAt: now, visitorId };
    saveVisit();
  } catch {
    return;
  }

  const attribution = site === 'careiq-marketing' ? marketingAttribution(window) : unknown;
  const endpoint = new URL('/api/analytics/collect', origin).href;
  function saveVisit() {
    window.sessionStorage.setItem(
      visitKey,
      JSON.stringify({
        ...visit,
        previousPageId: site === 'careiq-marketing' ? pageId : undefined,
      }),
    );
  }
  function send(
    event: 'pageview' | 'page_engagement' | 'scroll_depth',
    measurement?: { activeMs?: number; scrollDepth?: number },
  ) {
    const timestamp = Date.now();
    if (
      browserBlocksAnalytics() ||
      getAnalyticsOptOut() ||
      dailyDate.format(timestamp) !== date ||
      timestamp - visit.lastAt >= visitTimeout
    ) {
      return;
    }
    visit.lastAt = timestamp;
    try {
      saveVisit();
    } catch {
      return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      keepalive: true,
      body: JSON.stringify({
        schemaVersion: 2,
        event,
        eventId: window.crypto.randomUUID(),
        pageId,
        previousPageId:
          site === 'careiq-marketing' &&
          visit.previousPageId &&
          identifier.test(visit.previousPageId)
            ? visit.previousPageId
            : undefined,
        visitorId,
        sessionId: visit.id,
        visitScope: 'local',
        site,
        path,
        occurredAt: new Date(timestamp).toISOString(),
        ...attribution,
        ...measurement,
      }),
    }).catch(() => {
      // Measurement failures leave the application and navigation usable.
    });
  }

  send('pageview');
  if (site === 'careiq-web') {
    return;
  }

  let lastActiveAt = now;
  let measuredThrough = now;
  let activeMs = 0;
  let reportedMs = 0;
  let scrollDepth = 0;
  let visible = document.visibilityState === 'visible';
  function measure() {
    const timestamp = Date.now();
    if (visible) {
      activeMs += Math.max(0, Math.min(timestamp, lastActiveAt + idleTimeout) - measuredThrough);
    }
    measuredThrough = timestamp;
  }
  function activity() {
    measure();
    lastActiveAt = measuredThrough;
  }
  function flush() {
    measure();
    if (activeMs <= reportedMs) {
      return;
    }
    reportedMs = activeMs;
    send('page_engagement', { activeMs });
  }
  function changeVisibility() {
    flush();
    visible = document.visibilityState === 'visible';
  }
  function scroll() {
    activity();
    const fullHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (fullHeight <= 0) {
      return;
    }
    const percent = (window.scrollY / fullHeight) * 100;
    const depth = [100, 75, 50, 25].find((value) => percent >= value) ?? 0;
    if (depth <= scrollDepth) {
      return;
    }
    scrollDepth = depth;
    send('scroll_depth', { scrollDepth });
  }
  const events = new AbortController();
  const options = { signal: events.signal, passive: true };
  window.addEventListener('pointerdown', activity, options);
  window.addEventListener('keydown', activity, options);
  window.addEventListener('scroll', scroll, options);
  window.addEventListener('pagehide', flush, options);
  document.addEventListener('visibilitychange', changeVisibility, options);
  const timer = window.setInterval(flush, 15_000);
  return () => {
    window.clearInterval(timer);
    events.abort();
    flush();
  };
}
