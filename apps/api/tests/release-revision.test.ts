import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiApp, type ApiDependencies } from '../src/app.js';
import { releaseRevision } from '../src/release-revision.js';

const revision = 'a'.repeat(40);
test('production release identity requires an exact consistent commit hash', () => {
  assert.equal(releaseRevision({ NODE_ENV: 'production', RENDER_GIT_COMMIT: revision }), revision);
  assert.equal(
    releaseRevision({
      NODE_ENV: 'production',
      GITHUB_SHA: revision,
      CAREIQ_BUILD_REVISION: revision,
    }),
    revision,
  );
  assert.throws(() => releaseRevision({ NODE_ENV: 'production' }), /requires/);
  assert.throws(() => releaseRevision({ RENDER_GIT_COMMIT: 'main' }), /full Git/);
  assert.throws(
    () => releaseRevision({ RENDER_GIT_COMMIT: revision, CAREIQ_BUILD_REVISION: 'b'.repeat(40) }),
    /consistent/,
  );
  assert.equal(releaseRevision({ NODE_ENV: 'test' }), null);
  assert.equal(
    releaseRevision({ RENDER_GIT_COMMIT: revision, DATABASE_URL: 'never-exposed' }),
    revision,
  );
});

test('public health reports only the revision and bounded health fields', async () => {
  const dependencies: ApiDependencies = {
    authenticate: (_request, _response, next) => next(),
    getAuth: () => ({ isAuthenticated: false }),
    health: async () => true,
    findPracticeByClerkOrgId: async () => null,
    listPatients: async () => [],
    listAppointments: async () => [],
    createPatient: async () => null,
    createAppointment: async () => null,
  };
  const app = createApiApp(dependencies, {
    origins: [],
    trustedProxies: false,
    interviews: { enabled: false, store: async () => {}, log: () => {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'ok',
      database: 'connected',
      service: 'careiq-api',
      revision: releaseRevision(),
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
