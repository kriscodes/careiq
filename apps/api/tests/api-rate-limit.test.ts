import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { createApiApp } from '../src/app.js';
import {
  createApiRateLimitOptions,
  type ApiRateLimitSettings,
} from '../src/middleware/api-rate-limit.js';

async function withLimitedApi(
  limits: Partial<ApiRateLimitSettings>,
  run: (
    base: string,
    calls: { authentication: number; reads: number; writes: number; callbacks: number },
  ) => Promise<void>,
  trustProxy = false,
) {
  const calls = { authentication: 0, reads: 0, writes: 0, callbacks: 0 };
  const app = createApiApp(
    {
      authenticate: (_req, _res, next) => {
        calls.authentication++;
        next();
      },
      getAuth: (req) => ({
        isAuthenticated: true,
        userId: req.get('Test-User') ?? 'user_one',
        orgId: req.get('Test-Org') ?? 'org_one',
        orgRole: 'org:admin',
      }),
      health: async () => true,
      findPracticeByClerkOrgId: async () => ({ id: '00000000-0000-4000-8000-000000000001' }),
      listPatients: async () => {
        calls.reads++;
        return [];
      },
      listAppointments: async () => {
        calls.reads++;
        return [];
      },
      createPatient: async () => {
        calls.writes++;
        return {};
      },
      createAppointment: async () => {
        calls.writes++;
        return {};
      },
      clerkWebhook: async () => {
        calls.callbacks++;
      },
    },
    {
      origins: ['https://careiq.example'],
      trustedProxies: trustProxy ? ['127.0.0.1/32'] : false,
      interviews: { enabled: false, store: async () => {}, log: () => {} },
      rateLimits: limits,
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function assertLimited(response: Response) {
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  const body = await response.json();
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.equal(body.error.retryable, true);
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
}

test('address budget cannot be bypassed by forwarded headers and denies before authentication or parsing', async () => {
  await withLimitedApi({ perAddress: 2 }, async (base, calls) => {
    for (const address of ['192.0.2.1', '192.0.2.2']) {
      assert.equal(
        (await fetch(base + '/api/v1/patients', { headers: { 'X-Forwarded-For': address } }))
          .status,
        200,
      );
    }
    const response = await fetch(base + '/api/v1/appointments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.0.2.3',
        Origin: 'https://careiq.example',
      },
      body: '{',
    });
    await assertLimited(response);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://careiq.example');
    assert.match(response.headers.get('access-control-expose-headers') ?? '', /Retry-After/);
    assert.deepEqual(calls, { authentication: 2, reads: 2, writes: 0, callbacks: 0 });
  });
});

test('trusted proxy addresses use IPv6 subnet budgets while distinct subnets can continue', async () => {
  await withLimitedApi(
    { perAddress: 1 },
    async (base) => {
      const get = (address: string) =>
        fetch(base + '/api/v1/patients', { headers: { 'X-Forwarded-For': address } });
      assert.equal((await get('2001:db8:1234:5600::1')).status, 200);
      await assertLimited(await get('2001:db8:1234:56ff::99'));
      assert.equal((await get('2001:db8:1234:5700::1')).status, 200);
    },
    true,
  );
});

test('verified user budget follows the user across IP, tenant and session changes without blocking another user', async () => {
  await withLimitedApi(
    { perUser: 2 },
    async (base, calls) => {
      const get = (suffix: number, user = 'user_one') =>
        fetch(base + '/api/v1/patients', {
          headers: {
            'X-Forwarded-For': `192.0.2.${suffix}`,
            'Test-User': user,
            'Test-Org': `org_${suffix}`,
            Authorization: `Bearer synthetic_${suffix}`,
          },
        });
      assert.equal((await get(1)).status, 200);
      assert.equal((await get(2)).status, 200);
      await assertLimited(await get(3));
      assert.equal((await get(4, 'user_two')).status, 200);
      assert.equal(calls.reads, 3);
    },
    true,
  );
});

test('write budget includes malformed requests and is shared across endpoints while reads remain available', async () => {
  await withLimitedApi({ perUserWrite: 2 }, async (base, calls) => {
    const headers = { 'Content-Type': 'application/json' };
    assert.equal(
      (
        await fetch(base + '/api/v1/patients', {
          method: 'POST',
          headers,
          body: JSON.stringify({ firstName: 'Synthetic', lastName: 'Patient' }),
        })
      ).status,
      201,
    );
    assert.equal(
      (await fetch(base + '/api/v1/appointments', { method: 'POST', headers, body: '{' })).status,
      400,
    );
    await assertLimited(
      await fetch(base + '/api/v1/patients', { method: 'POST', headers, body: '{}' }),
    );
    assert.equal((await fetch(base + '/api/v1/patients')).status, 200);
    assert.equal(calls.writes, 1);
    assert.equal(calls.reads, 1);
  });
});

test('process budget bounds changing identities and leaves database health available', async () => {
  await withLimitedApi(
    { global: 3 },
    async (base, calls) => {
      for (let index = 1; index <= 3; index++) {
        assert.equal(
          (
            await fetch(base + '/api/v1/patients', {
              headers: { 'X-Forwarded-For': `192.0.2.${index}`, 'Test-User': `user_${index}` },
            })
          ).status,
          200,
        );
      }
      await assertLimited(
        await fetch(base + '/api/v1/patients', {
          headers: { 'X-Forwarded-For': '192.0.2.99', 'Test-User': 'user_new' },
        }),
      );
      await assertLimited(
        await fetch(base + '/api/v1/patients', {
          method: 'OPTIONS',
          headers: { Origin: 'https://careiq.example' },
        }),
      );
      assert.equal((await fetch(base + '/health')).status, 200);
      assert.equal(calls.authentication, 3);
      assert.equal(calls.reads, 3);
    },
    true,
  );
});

test('provider callbacks share ingress protection before raw body processing and retain valid delivery', async () => {
  await withLimitedApi({ perAddress: 1 }, async (base, calls) => {
    const send = () =>
      fetch(base + '/api/v1/webhooks/clerk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    assert.equal((await send()).status, 200);
    await assertLimited(await send());
    assert.equal(calls.callbacks, 1);
    assert.equal(calls.authentication, 0);
  });
});

test('expired request budgets allow ordinary requests again', async () => {
  await withLimitedApi({ perAddress: 1, windowMs: 1000 }, async (base) => {
    assert.equal((await fetch(base + '/api/v1/patients')).status, 200);
    await assertLimited(await fetch(base + '/api/v1/patients'));
    await setTimeout(1100);
    assert.equal((await fetch(base + '/api/v1/patients')).status, 200);
  });
});

test('invalid rate limit configuration fails closed', () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createApiRateLimitOptions(() => ({ isAuthenticated: false }), [], { global: value }),
      /positive integers/,
    );
  }
});
