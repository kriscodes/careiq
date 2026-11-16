import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import {
  accountPrincipal,
  createAccountLifecycleService,
  parseAccountClosure,
  requireRecentAccountVerification,
} from '../src/services/account-lifecycle.service.js';
import { registerAccountLifecycleRoutes } from '../src/routes/account-lifecycle.js';
import { verifyAccountLifecycleDatabaseRelease } from '../src/db/account-lifecycle-release-check.js';
const identity = (userId = 'user_Synthetic', fva: unknown = [0, -1]) => ({
  isAuthenticated: true,
  userId,
  sessionId: 'sess_Synthetic',
  sessionClaims: { fva },
});
const code = (expected: string) => (cause: unknown) =>
  Boolean(cause && typeof cause === 'object' && 'code' in cause && cause.code === expected);

test('personal closure accepts only the verified personal session and recent signed first-factor age', () => {
  for (const auth of [
    {},
    { isAuthenticated: false, userId: 'user_Test', sessionId: 'sess_Test' },
    { ...identity(), userId: 'other' },
    { ...identity(), sessionId: null },
  ]) {
    assert.throws(() => accountPrincipal(auth as any), code('UNAUTHENTICATED'));
  }
  for (const age of [
    undefined,
    null,
    '0',
    [],
    ['0'],
    [-1],
    [5],
    [5.01],
    [Infinity],
    [NaN],
    [-Infinity],
  ]) {
    assert.throws(
      () => requireRecentAccountVerification({ ...identity(), sessionClaims: { fva: age } }),
      code('RECENT_AUTHENTICATION_REQUIRED'),
    );
  }
  for (const sessionClaims of [undefined, null, 'invalid', [], {}]) {
    assert.throws(
      () => requireRecentAccountVerification({ ...identity(), sessionClaims }),
      code('RECENT_AUTHENTICATION_REQUIRED'),
    );
  }
  for (const age of [[0, -1], [4], [2, 99]]) {
    requireRecentAccountVerification({ ...identity(), sessionClaims: { fva: age } });
  }
  assert.deepEqual(accountPrincipal(identity()), {
    userId: 'user_Synthetic',
    sessionId: 'sess_Synthetic',
  });
});
test('closure confirmation is exact, bounded and cannot target another identity', () => {
  for (const input of [
    null,
    [],
    'delete',
    {},
    { action: 'unknown', confirmation: 'UNKNOWN' },
    { action: {}, confirmation: 'DELETE' },
    { action: 'delete', confirmation: 123 },
    { action: 'delete', confirmation: 'DELETE', userId: 'user_Other' },
    { action: 'delete', confirmation: 'DELETE', sessionId: 'sess_Other' },
    { action: 'delete', confirmation: 'DELETE\n' },
    { action: 'archive', confirmation: 'x'.repeat(1000) },
  ]) {
    assert.throws(() => parseAccountClosure(input), code('INVALID_REQUEST'));
  }
  assert.throws(
    () => parseAccountClosure({ action: 'delete', confirmation: '' }),
    code('ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED'),
  );
  for (const confirmation of ['delete', ' DELETE', 'DELETE ', 'ARCHIVE']) {
    assert.throws(
      () => parseAccountClosure({ action: 'delete', confirmation }),
      code('ACCOUNT_CLOSURE_CONFIRMATION_MISMATCH'),
    );
  }
  assert.throws(
    () => parseAccountClosure({ action: 'archive', confirmation: 'ARCHIVE' }),
    code('INVALID_REQUEST'),
  );
});

const url = isolatedTestDatabaseUrl();
test(
  'durable account closure is actor-isolated, role-neutral and blocked by every owned practice',
  { skip: !url },
  async (context) => {
    const admin = new Pool({ connectionString: url, ssl: false });
    const role = `careiq_account_test_${randomBytes(6).toString('hex')}`,
      password = randomBytes(20).toString('hex');
    const tag = randomBytes(8).toString('hex'),
      actor = `user_${tag}`,
      other = `user_Other${tag}`;
    const actors = [actor, other],
      practices: string[] = [];
    let runtime: Pool | undefined;
    try {
      await admin.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
      const target = new URL(url!);
      target.username = role;
      target.password = password;
      runtime = new Pool({ connectionString: target.href, ssl: false });
      const service = createAccountLifecycleService(async (practiceId, userId, operation) => {
        assert.equal(practiceId, null);
        const client = await runtime!.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.actor_user_id',$1,true)", [userId]);
          const result = await operation(client);
          await client.query('COMMIT');
          return result;
        } catch (cause) {
          await client.query('ROLLBACK');
          throw cause;
        } finally {
          client.release();
        }
      });
      await context.test(
        'the release verifier checks real forced RLS, narrow grants, policies and unique pending requests',
        async () => {
          await verifyAccountLifecycleDatabaseRelease(runtime!);
          for (const fault of ['RLS', 'grant', 'policy', 'index']) {
            const proxy = {
              query: async (sql: string, args?: unknown[]) => {
                const result = await runtime!.query(sql, args);
                if (fault === 'RLS' && sql.includes('c.relrowsecurity')) {
                  result.rows[0].relforcerowsecurity = false;
                }
                if (fault === 'grant' && sql.includes('GROUP BY a.attname')) {
                  result.rows.find((row: any) => row.attname === 'status').can_insert = true;
                }
                if (fault === 'policy' && sql.includes('pg_policies')) {
                  result.rows[0].qual = 'true';
                }
                if (fault === 'index' && sql.includes('pg_index')) {
                  result.rows[0].indisvalid = false;
                }
                return result;
              },
            };
            await assert.rejects(verifyAccountLifecycleDatabaseRelease(proxy as any), Error, fault);
          }
        },
      );
      await context.test(
        'owners cannot close from a personal or unrelated-organization session, including pending and suspended practices',
        async () => {
          for (const status of ['active', 'pending', 'suspended']) {
            const id = randomUUID();
            practices.push(id);
            await admin.query(
              'INSERT INTO practices(id,clerk_org_id,name,status,owner_user_id) VALUES($1,$2,$3,$4,$5)',
              [id, `org_${randomUUID()}`, `Synthetic ${status}`, status, actor],
            );
          }
          assert.equal((await service.state(identity(actor))).ownedPractices.length, 3);
          for (const auth of [
            identity(actor),
            { ...identity(actor), orgId: 'org_Unrelated', orgRole: 'org:member' },
          ]) {
            await assert.rejects(
              service.requestClosure(auth, { action: 'delete', confirmation: 'DELETE' }),
              code('ACCOUNT_OWNS_PRACTICES'),
            );
          }
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM account_closure_requests WHERE actor_user_id=$1',
                [actor],
              )
            ).rows[0].count,
            0,
          );
          await admin.query('UPDATE practices SET owner_user_id=$2 WHERE id=ANY($1::uuid[])', [
            practices,
            other,
          ]);
          assert.deepEqual((await service.state(identity(actor))).ownedPractices, []);
        },
      );
      await context.test(
        'patients without an organization and every nonowner staff role submit only for themselves',
        async () => {
          for (const persona of [
            'patient',
            'admin',
            'member',
            'clinician',
            'pending',
            'suspended',
          ]) {
            const user = `user_${persona}${tag}`;
            actors.push(user);
            const auth = {
              ...identity(user),
              ...(persona !== 'patient'
                ? {
                    orgId: 'org_Synthetic',
                    orgRole: persona === 'admin' ? 'org:admin' : 'org:member',
                  }
                : {}),
            };
            const request = await service.requestClosure(auth, {
              action: 'delete',
              confirmation: 'DELETE',
            });
            assert.equal(request.status, 'pending');
            assert.equal((await service.state(auth)).closureRequest?.id, request.id);
            assert.equal(
              (
                await admin.query(
                  'SELECT actor_user_id,requested_session_id FROM account_closure_requests WHERE id=$1',
                  [request.id],
                )
              ).rows[0].actor_user_id,
              user,
            );
          }
        },
      );
      await context.test(
        'duplicate concurrent submissions retain one request, reject action changes and never imply provider deletion',
        async () => {
          const requests = await Promise.all(
            Array.from({ length: 4 }, () =>
              service.requestClosure(identity(actor), { action: 'delete', confirmation: 'DELETE' }),
            ),
          );
          assert.equal(new Set(requests.map((request) => request.id)).size, 1);
          assert.ok(
            requests.every((request) => request.status === 'pending' && !('deleted' in request)),
          );
          await assert.rejects(
            service.requestClosure(identity(actor), { action: 'archive', confirmation: 'ARCHIVE' }),
            code('INVALID_REQUEST'),
          );
          await assert.rejects(
            service.requestClosure(identity(actor, [6, 0]), {
              action: 'delete',
              confirmation: 'DELETE',
            }),
            code('RECENT_AUTHENTICATION_REQUIRED'),
          );
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM account_closure_requests WHERE actor_user_id=$1',
                [actor],
              )
            ).rows[0].count,
            1,
          );
        },
      );
      await context.test(
        'runtime cannot read another request, forge an actor, set fulfillment or erase request history',
        async () => {
          const client = await runtime!.connect();
          try {
            const attempt = async (operation: () => Promise<unknown>) => {
              await client.query('BEGIN');
              try {
                await client.query("SELECT set_config('app.actor_user_id',$1,true)", [actor]);
                await operation();
              } finally {
                await client.query('ROLLBACK');
              }
            };
            await attempt(async () =>
              assert.equal(
                (
                  await client.query(
                    'SELECT * FROM account_closure_requests WHERE actor_user_id=$1',
                    [actors[2]],
                  )
                ).rowCount,
                0,
              ),
            );
            await assert.rejects(
              attempt(() =>
                client.query(
                  "INSERT INTO account_closure_requests(actor_user_id,requested_session_id,action) VALUES($1,'sess_Synthetic','delete')",
                  [other],
                ),
              ),
              /row-level security/,
            );
            await assert.rejects(
              attempt(() =>
                client.query(
                  "INSERT INTO account_closure_requests(actor_user_id,requested_session_id,action,status) VALUES($1,'sess_Synthetic','delete','fulfilled')",
                  [actor],
                ),
              ),
              /permission denied/,
            );
            await assert.rejects(
              attempt(() =>
                client.query(
                  "UPDATE account_closure_requests SET status='fulfilled' WHERE actor_user_id=$1",
                  [actor],
                ),
              ),
              /permission denied/,
            );
            await assert.rejects(
              attempt(() =>
                client.query('DELETE FROM account_closure_requests WHERE actor_user_id=$1', [
                  actor,
                ]),
              ),
              /permission denied/,
            );
          } finally {
            client.release();
          }
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM practices WHERE id=ANY($1::uuid[])',
                [practices],
              )
            ).rows[0].count,
            practices.length,
          );
        },
      );
      await context.test(
        'HTTP contract binds verified auth, returns accepted pending state and safe failures',
        async () => {
          let auth = identity(`user_Http${tag}`);
          actors.push(auth.userId);
          const app = express();
          app.use(express.json());
          registerAccountLifecycleRoutes(app, service, () => auth);
          const server = app.listen(0, '127.0.0.1');
          await new Promise<void>((resolve) => server.once('listening', resolve));
          const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/account`;
          try {
            const post = (body: unknown) =>
              fetch(`${base}/closure-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
            const forged = await post({ action: 'delete', confirmation: 'DELETE', userId: other });
            assert.equal(forged.status, 400);
            auth = identity(auth.userId, [6, 0]);
            const stale = await post({ action: 'delete', confirmation: 'DELETE' });
            assert.equal(stale.status, 403);
            assert.equal((await stale.json()).error.code, 'RECENT_AUTHENTICATION_REQUIRED');
            auth = identity(auth.userId);
            const accepted = await post({ action: 'delete', confirmation: 'DELETE' });
            assert.equal(accepted.status, 202);
            assert.equal(accepted.headers.get('cache-control'), 'no-store');
            assert.equal((await accepted.json()).data.status, 'pending');
            const state = await fetch(base);
            assert.equal(state.status, 200);
            assert.equal((await state.json()).data.closureRequest.action, 'delete');
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
          }
        },
      );
    } finally {
      await runtime?.end();
      await admin.query(
        'DELETE FROM account_closure_requests WHERE actor_user_id=ANY($1::text[])',
        [actors],
      );
      await admin.query('DELETE FROM practices WHERE id=ANY($1::uuid[])', [practices]);
      await admin.query(`DROP OWNED BY ${role}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  },
);
