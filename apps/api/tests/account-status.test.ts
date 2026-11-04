import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiApp, type ApiDependencies } from '../src/app.js';
import { AccessError } from '../src/services/practice-policy.js';
import type { RequestAuthentication } from '../src/middleware/tenant-context.js';

async function withApi(
  run: (
    base: string,
    state: {
      archived: boolean;
      unavailable: boolean;
      auth: RequestAuthentication;
      protectedReads: number;
      accountReads: number;
      archiveCalls: number;
      checkedActors: string[];
    },
  ) => Promise<void>,
) {
  const state = {
    archived: false,
    unavailable: false,
    auth: {
      isAuthenticated: true,
      userId: 'user_Synthetic',
      sessionId: 'sess_Synthetic',
      orgId: 'org_Synthetic',
      orgRole: 'org:admin',
    } as RequestAuthentication,
    protectedReads: 0,
    accountReads: 0,
    archiveCalls: 0,
    checkedActors: [] as string[],
  };
  const lifecycle = {
    assertActive: async (auth: RequestAuthentication) => {
      state.checkedActors.push(auth.userId!);
      if (state.unavailable) {
        throw new AccessError('ACCOUNT_OPERATION_UNAVAILABLE', 503);
      }
      if (state.archived) {
        throw new AccessError('ACCOUNT_ARCHIVED', 403);
      }
    },
    state: async () => {
      state.accountReads++;
      return {
        account: { status: state.archived ? 'archiving' : 'active' },
        ownedPractices: [],
        closureRequest: null,
      };
    },
    archive: async () => {
      state.archiveCalls++;
      return { status: 'archived' };
    },
    requestClosure: async () => ({ status: 'pending' }),
  } as unknown as NonNullable<ApiDependencies['accountLifecycle']>;
  const app = createApiApp(
    {
      authenticate: (_req, _res, next) => next(),
      getAuth: () => state.auth,
      health: async () => true,
      accountLifecycle: lifecycle,
      // The real patient portal is registered; the guard must intercept before its reader.
      workflow: {} as NonNullable<ApiDependencies['workflow']>,
      findPracticeByClerkOrgId: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
      listPatients: async () => {
        state.protectedReads++;
        return [];
      },
      listAppointments: async () => {
        state.protectedReads++;
        return [];
      },
      createPatient: async () => {
        state.protectedReads++;
        return {};
      },
      createAppointment: async () => {
        state.protectedReads++;
        return {};
      },
    },
    {
      origins: ['http://127.0.0.1'],
      trustedProxies: false,
      interviews: { enabled: false, store: async () => {}, log: () => {} },
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, state);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('archiving immediately denies an already-authenticated staff or personal patient session before protected readers', async () => {
  await withApi(async (base, state) => {
    assert.equal((await fetch(base + '/api/v1/patients')).status, 200);
    assert.equal(state.protectedReads, 1);
    state.archived = true;
    for (const role of ['org:admin', 'org:member', 'org:clinician', null]) {
      state.auth = {
        ...state.auth,
        orgId: role ? 'org_Synthetic' : null,
        orgRole: role ?? undefined,
      };
      for (const path of [
        '/api/v1/me',
        '/api/v1/patients',
        '/api/v1/appointments',
        '/api/v1/patient-paperwork',
        '/api/v1/patient-paperwork/11111111-1111-4111-8111-111111111111/content',
        '/api/v1/locations/11111111-1111-4111-8111-111111111111/workflow',
      ]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 403, role + ' ' + path);
        assert.equal((await response.json()).error.code, 'ACCOUNT_ARCHIVED');
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    assert.equal(state.protectedReads, 1);
    assert.ok(state.checkedActors.every((actor) => actor === 'user_Synthetic'));
  });
});

test('only own account status and archive retry remain reachable after archival', async () => {
  await withApi(async (base, state) => {
    state.archived = true;
    const status = await fetch(base + '/api/v1/account/');
    assert.equal(status.status, 200);
    const retry = await fetch(base + '/api/v1/account/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'ARCHIVE' }),
    });
    assert.equal(retry.status, 200);
    for (const [method, path] of [
      ['POST', '/api/v1/account/closure-requests'],
      ['POST', '/api/v1/account'],
      ['GET', '/api/v1/account/archive'],
      ['GET', '/api/v1/account/another-user'],
      ['POST', '/api/v1/account/archive/another-user'],
    ]) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 403, method + ' ' + path);
    }
    assert.equal(state.accountReads, 1);
    assert.equal(state.archiveCalls, 1);
  });
});

test('an unavailable durable account check fails closed without dispatching a protected read', async () => {
  await withApi(async (base, state) => {
    state.unavailable = true;
    assert.equal((await fetch(base + '/api/v1/patients')).status, 503);
    assert.equal(state.protectedReads, 0);
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/api/v1/account')).status, 200);
    state.auth = { isAuthenticated: false };
    assert.equal((await fetch(base + '/api/v1/patients')).status, 401);
    assert.equal(state.protectedReads, 0);
  });
});
