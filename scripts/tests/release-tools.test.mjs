import { productionManifest, manifestsForEvent } from '../release-manifest.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRevision, writeReleaseMetadata } from '../release-metadata.mjs';
import {
  validateReleaseManifest,
  validateRollbackManifests,
  verifyRelease,
} from '../release-smoke.mjs';
import { codeqlViolations, verifyCodeqlReports } from '../security-results.mjs';

const revision = 'a'.repeat(40),
  nextRevision = 'b'.repeat(40),
  marketingRevision = 'c'.repeat(40);
const manifest = () => ({
  version: 1,
  services: {
    api: { url: 'https://api.example.invalid', revision },
    web: { url: 'https://app.example.invalid', revision },
    marketing: { url: 'https://example.invalid', revision: marketingRevision },
  },
});
const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
const html = () =>
  new Response('<html/>', {
    headers: {
      'content-type': 'text/html',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  });
function healthyFetcher(release, override = () => undefined) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    const name = Object.keys(release.services).find(
      (name) => new URL(release.services[name].url).origin === url.origin,
    );
    const replaced = override(name, url.pathname);
    if (replaced) {
      return replaced;
    }
    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        database: 'connected',
        service: 'careiq-api',
        revision: release.services.api.revision,
      });
    }
    if (url.pathname === '/api/v1/me') {
      return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    }
    if (url.pathname === '/.well-known/careiq-release.json') {
      return json({ service: `careiq-${name}`, revision: release.services[name].revision });
    }
    if (url.pathname === '/design-preview') {
      return new Response(null, { status: 404 });
    }
    return html();
  };
}

test('metadata records only the explicit build identity and refuses absent/conflicting SHAs', () => {
  assert.throws(() => buildRevision({}), /consistent full Git SHA/);
  assert.throws(
    () => buildRevision({ RENDER_GIT_COMMIT: revision, GITHUB_SHA: nextRevision }),
    /consistent/,
  );
  assert.throws(() => buildRevision({ CAREIQ_BUILD_REVISION: 'main' }), /full Git SHA/);
  const directory = mkdtempSync(path.join(tmpdir(), 'careiq-release-metadata-'));
  try {
    assert.deepEqual(
      writeReleaseMetadata(
        'marketing',
        { RENDER_GIT_COMMIT: marketingRevision, SECRET: 'private' },
        directory,
      ),
      { service: 'careiq-marketing', revision: marketingRevision },
    );
    const saved = JSON.parse(
      readFileSync(
        path.join(directory, 'apps/marketing/public/.well-known/careiq-release.json'),
        'utf8',
      ),
    );
    assert.deepEqual(saved, { service: 'careiq-marketing', revision: marketingRevision });
    assert.throws(
      () => writeReleaseMetadata('../api', { RENDER_GIT_COMMIT: revision }, directory),
      /service/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release manifests reject unsafe origins, incomplete identities and mixed API/web revisions', () => {
  for (const url of [
    'http://api.example.invalid',
    'https://user:secret@example.invalid',
    'https://example.invalid/private',
    'https://example.invalid/?token=private',
  ]) {
    const release = manifest();
    release.services.api.url = url;
    assert.throws(() => validateReleaseManifest(release));
  }
  assert.throws(() => validateReleaseManifest({ version: 1, services: {} }));
  const release = manifest();
  release.services.web.revision = nextRevision;
  assert.throws(() => validateReleaseManifest(release), /same tested commit/);
  assert.equal(validateReleaseManifest(manifest()).services.marketing.revision, marketingRevision);
});

test('release smoke verifies all public surfaces, independent marketing revision and unsigned denial', async () => {
  const release = manifest();
  const result = await verifyRelease(release, { fetcher: healthyFetcher(release), attempts: 1 });
  assert.equal(result.checks.filter((c) => c.check === 'revision').length, 3);
  assert.ok(result.checks.some((c) => c.check === 'preview-denied'));
});

test('wrong revision, bad database, missing protections and unsigned success block promotion', async () => {
  for (const [service, route, response, expected] of [
    [
      'api',
      '/health',
      json({ service: 'careiq-api', revision: nextRevision, status: 'ok', database: 'connected' }),
      /revision/,
    ],
    [
      'api',
      '/health',
      json({ service: 'careiq-api', revision, status: 'ok', database: 'disconnected' }),
      /database/,
    ],
    ['api', '/api/v1/me', json({ private: 'do not print this' }, 200), /unsigned/],
    [
      'marketing',
      '/.well-known/careiq-release.json',
      json({ service: 'careiq-marketing', revision }),
      /revision/,
    ],
    [
      'web',
      '/sign-in',
      new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
      /headers/,
    ],
    ['web', '/design-preview', html(), /preview/],
  ]) {
    const release = manifest();
    await assert.rejects(
      verifyRelease(release, {
        attempts: 1,
        fetcher: healthyFetcher(release, (name, path) =>
          name === service && path === route ? response : undefined,
        ),
      }),
      expected,
    );
  }
});

test('smoke retries are bounded and arbitrary network errors never disclose diagnostics', async () => {
  let calls = 0;
  await assert.rejects(
    verifyRelease(manifest(), {
      attempts: 2,
      retryDelayMs: 0,
      fetcher: async () => {
        calls++;
        throw new Error('api: credential-never-log');
      },
    }),
    (error) =>
      error.message.includes('after 2 attempts') && !error.message.includes('credential-never-log'),
  );
  assert.equal(calls, 2);
  await assert.rejects(verifyRelease(manifest(), { attempts: 0 }), /bounded/);
});

test('rollback verification checks an actual loopback version transition without changing data', async () => {
  const state = { api: revision, web: revision, marketing: marketingRevision };
  const servers = [];
  const previous = { version: 1, services: {} };
  try {
    for (const name of ['api', 'web', 'marketing']) {
      const server = createServer(async (req, res) => {
        const current = { version: 1, services: { ...previous.services } };
        for (const [service, details] of Object.entries(current.services)) {
          current.services[service] = { ...details, revision: state[service] };
        }
        const response = await healthyFetcher(current)(
          new URL(req.url, previous.services[name].url),
          { redirect: 'error', headers: {} },
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      servers.push(server);
      previous.services[name] = {
        url: `http://127.0.0.1:${server.address().port}`,
        revision: state[name],
      };
    }
    await verifyRelease(previous, { attempts: 1 });
    const candidate = structuredClone(previous);
    candidate.services.api.revision = nextRevision;
    candidate.services.web.revision = nextRevision;
    state.api = nextRevision;
    state.web = nextRevision;
    await verifyRelease(candidate, { attempts: 1 });
    validateRollbackManifests(candidate, previous);
    await assert.rejects(verifyRelease(previous, { attempts: 1 }), /revision/);
    state.api = revision;
    state.web = revision;
    await verifyRelease(previous, { attempts: 1 });
    assert.throws(() => validateRollbackManifests(previous, previous), /differ/);
  } finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('CodeQL severity gate fails closed on missing analysis and security findings', () => {
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeQL',
            rules: [{ id: 'js/test', properties: { 'security-severity': '7.5' } }],
          },
        },
        results: [],
      },
    ],
  };
  assert.deepEqual(codeqlViolations(sarif), []);
  assert.throws(() => verifyCodeqlReports([sarif]), /must include/);
  const reports = ['js', 'py', 'actions'].map((language) => {
    const report = structuredClone(sarif);
    report.runs[0].tool.driver.rules[0].id = `${language}/test`;
    return report;
  });
  assert.deepEqual(verifyCodeqlReports(reports), []);
  sarif.runs[0].results = [{ ruleId: 'js/test', level: 'note' }];
  assert.equal(codeqlViolations(sarif).length, 1);
  sarif.runs[0].results = [{ ruleId: 'unknown' }];
  assert.throws(() => codeqlViolations(sarif), /metadata/);
  assert.throws(() => codeqlViolations({ version: '2.1.0', runs: [] }), /Missing/);
  sarif.runs[0].results = [];
  sarif.runs[0].invocations = [{ executionSuccessful: false }];
  assert.throws(() => codeqlViolations(sarif), /failed/);
});

test('post-deployment events pin the emitted SHA and require explicit environment and marketing identity', () => {
  const event = {
    deployment_status: { state: 'success' },
    deployment: { sha: revision, environment: 'careiq-production' },
  };
  const settings = {
    DEPLOYMENT_ENVIRONMENT: 'careiq-production',
    MARKETING_SHA: marketingRevision,
  };
  const result = manifestsForEvent('deployment_status', event, settings);
  assert.equal(result.current.services.api.revision, revision);
  assert.equal(result.current.services.marketing.revision, marketingRevision);
  assert.throws(
    () => manifestsForEvent('deployment_status', event, { MARKETING_SHA: marketingRevision }),
    /mapped/,
  );
  assert.throws(
    () => manifestsForEvent('deployment_status', event, { ...settings, MARKETING_SHA: '' }),
    /full expected/,
  );
  assert.throws(() => productionManifest(revision, 'main'), /full expected/);
  assert.throws(() => manifestsForEvent('workflow_run', {}, settings), /Unsupported/);
});
