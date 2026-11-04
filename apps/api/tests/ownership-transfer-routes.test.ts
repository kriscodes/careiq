import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerPracticeRoutes, type PracticeAccess } from '../src/routes/practice-access.js';
import { AccessError } from '../src/services/practice-policy.js';

test('ownership route retains the complete typed confirmation and returns safe rejection codes', async () => {
  const received: unknown[] = [];
  const auth = { isAuthenticated: true, userId: 'user_Owner', orgId: 'org_Synthetic' };
  const access = {
    transferOwnership: async (identity: unknown, input: unknown) => {
      assert.equal(identity, auth);
      received.push(input);
      if ((input as { confirmationName?: unknown }).confirmationName !== 'Synthetic Practice') {
        throw new AccessError(
          'OWNERSHIP_CONFIRMATION_MISMATCH',
          409,
          'Review the current practice and recipient, then type the practice name exactly.',
        );
      }
      return { ownerUserId: 'user_Admin' };
    },
  } as unknown as PracticeAccess;
  const app = express();
  app.use(express.json());
  registerPracticeRoutes(app, access, () => auth);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/practice/ownership`;
  const body = {
    userId: 'user_Admin',
    practiceId: '11111111-1111-4111-8111-111111111111',
    confirmationName: 'Synthetic Practice',
    acknowledgedUserId: 'user_Admin',
  };
  const post = (input: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  try {
    const success = await post(body);
    assert.equal(success.status, 200);
    assert.deepEqual(received[0], body);
    const wrong = await post({ ...body, confirmationName: false });
    assert.equal(wrong.status, 409);
    assert.equal((await wrong.json()).error.code, 'OWNERSHIP_CONFIRMATION_MISMATCH');
    assert.equal((received[1] as typeof body).confirmationName, false);
    const count = received.length;
    const malformed = await post([]);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
    assert.equal(received.length, count);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
