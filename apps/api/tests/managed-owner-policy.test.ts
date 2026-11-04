import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { verifyManagedHelperOwnership } from '../src/db/managed-owner-release-check.js';
import { ReleaseCheckError } from '../src/db/migration-safety.js';
import { isolatedTestDatabaseUrl } from './local-test-database.js';

const databaseUrl = isolatedTestDatabaseUrl();
const helperRoles = [
  'careiq_token_lookup',
  'careiq_portal_operator',
  'careiq_patient_operator',
  'careiq_patient_audit_writer',
  'careiq_suppression_reader',
];

async function asRuntime(client: PoolClient) {
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');
}

async function rolledBack(client: PoolClient, action: () => Promise<void>) {
  await client.query('SAVEPOINT managed_owner_case');
  try {
    await action();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT managed_owner_case');
    await client.query('RELEASE SAVEPOINT managed_owner_case');
  }
}

function databaseError(code: string, message?: string) {
  return (error: unknown) =>
    error instanceof Error &&
    'code' in error &&
    error.code === code &&
    (message === undefined || error.message === message);
}

async function denied(
  client: PoolClient,
  statement: string,
  values: unknown[] = [],
  message?: string,
  code = '42501',
) {
  await rolledBack(client, async () => {
    await assert.rejects(client.query(statement, values), databaseError(code, message));
  });
}

test(
  'managed helper verifier rejects real catalog changes and runtime cannot assume helper roles',
  { skip: !databaseUrl },
  async (context) => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
    const client = await pool.connect();
    const extraRole = `careiq_managed_probe_${randomBytes(8).toString('hex')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${extraRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await asRuntime(client);
      await verifyManagedHelperOwnership(client);
      await client.query('RESET ROLE');

      const faults: [string, string][] = [
        ...[
          'LOGIN',
          'SUPERUSER',
          'BYPASSRLS',
          'CREATEDB',
          'CREATEROLE',
          'REPLICATION',
          'INHERIT',
        ].map((flag): [string, string] => [
          `helper role gains ${flag}`,
          `ALTER ROLE careiq_token_lookup ${flag}`,
        ]),
        ['helper inherits another role', `GRANT ${extraRole} TO careiq_token_lookup`],
        [
          'runtime receives helper membership even without inheritance or SET ROLE',
          'GRANT careiq_token_lookup TO careiq_clinical_runtime WITH INHERIT FALSE, SET FALSE',
        ],
        [
          'runtime gains indirect SET ROLE access',
          `GRANT careiq_token_lookup TO ${extraRole}; GRANT ${extraRole} TO careiq_clinical_runtime`,
        ],
        ['unexpected table grant', 'GRANT SELECT ON public.patients TO careiq_token_lookup'],
        [
          'PUBLIC table grant expands effective access',
          'GRANT SELECT ON public.patients TO PUBLIC',
        ],
        [
          'PUBLIC column grant expands effective access',
          'GRANT SELECT(first_name) ON public.patients TO PUBLIC',
        ],

        [
          'unexpected column grant',
          'GRANT SELECT(first_name) ON public.patients TO careiq_token_lookup',
        ],
        ['unexpected schema CREATE', 'GRANT CREATE ON SCHEMA public TO careiq_token_lookup'],
        ['unexpected schema USAGE', 'GRANT USAGE ON SCHEMA audit TO careiq_suppression_reader'],
        ['PUBLIC schema grant expands effective access', 'GRANT USAGE ON SCHEMA audit TO PUBLIC'],
        [
          'unexpected helper function grant',
          'GRANT EXECUTE ON FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamptz,uuid) TO careiq_token_lookup',
        ],
        [
          'public EXECUTE exposes a private entry point',
          'GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO PUBLIC',
        ],
        [
          'runtime can delegate an entry point',
          'GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_clinical_runtime WITH GRANT OPTION',
        ],
        [
          'table privilege becomes grantable',
          'GRANT SELECT ON public.workflow_operations TO careiq_token_lookup WITH GRANT OPTION',
        ],
        [
          'column privilege becomes grantable',
          'GRANT SELECT(id) ON public.patient_sessions TO careiq_token_lookup WITH GRANT OPTION',
        ],
        [
          'helper acquires table ownership',
          'ALTER TABLE public.patients OWNER TO careiq_token_lookup',
        ],
        [
          'helper acquires non-relation object ownership',
          'CREATE OPERATOR public.#=# (FUNCTION=pg_catalog.int4eq,LEFTARG=integer,RIGHTARG=integer); ALTER OPERATOR public.#=#(integer,integer) OWNER TO careiq_token_lookup',
        ],
        [
          'helper acquires unreviewed function ownership',
          'CREATE FUNCTION public.managed_owner_unreviewed_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$; ALTER FUNCTION public.managed_owner_unreviewed_probe() OWNER TO careiq_token_lookup',
        ],
        [
          'reviewed function has a different owner',
          'ALTER FUNCTION public.careiq_resolve_patient_access(text,boolean) OWNER TO careiq_clinical_runtime',
        ],
        [
          'function search path allows temporary objects first',
          'ALTER FUNCTION public.careiq_resolve_patient_access(text,boolean) SET search_path=pg_temp,public,pg_catalog',
        ],
        [
          'function loses its security definer boundary',
          'ALTER FUNCTION public.careiq_resolve_patient_access(text,boolean) SECURITY INVOKER',
        ],
        [
          'function argument default changes without changing its body',
          `DO $test$ DECLARE definition text; BEGIN
            SELECT pg_get_functiondef('public.careiq_resolve_patient_access(text,boolean)'::regprocedure) INTO definition;
            IF position('is_session boolean DEFAULT true' IN definition)=0 THEN
              RAISE EXCEPTION 'Expected reviewed session default was not found';
            END IF;
            EXECUTE replace(definition,'is_session boolean DEFAULT true','is_session boolean DEFAULT false');
          END $test$`,
        ],
        [
          'function body changes while signature and privileges remain intact',
          'CREATE OR REPLACE FUNCTION public.careiq_resolve_patient_access(token_hash_value text,is_session boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RETURN NULL; END $$',
        ],
        [
          'forced RLS is removed',
          'ALTER TABLE public.patient_sessions NO FORCE ROW LEVEL SECURITY',
        ],
        ['RLS is disabled', 'ALTER TABLE public.patient_sessions DISABLE ROW LEVEL SECURITY'],
        [
          'reviewed policy is missing',
          'DROP POLICY managed_token_lookup ON public.patient_sessions',
        ],
        [
          'private policy becomes public',
          'ALTER POLICY managed_token_lookup ON public.patient_sessions TO PUBLIC',
        ],
        [
          'reviewed SELECT predicate changes',
          'ALTER POLICY managed_token_lookup ON public.patient_sessions USING (false)',
        ],
        [
          'lock-only policy permits writes',
          'ALTER POLICY managed_portal_lock ON public.patients WITH CHECK (true)',
        ],
        [
          'an extra policy expands helper visibility',
          'CREATE POLICY managed_owner_unreviewed_probe ON public.patients FOR SELECT TO careiq_token_lookup USING (true)',
        ],
      ];
      for (const [name, mutation] of faults) {
        await context.test(name, async () => {
          await rolledBack(client, async () => {
            await client.query(mutation);
            await asRuntime(client);
            await assert.rejects(verifyManagedHelperOwnership(client), ReleaseCheckError);
          });
        });
      }

      for (const role of helperRoles) {
        await context.test(`runtime cannot SET ROLE ${role}`, async () => {
          await rolledBack(client, async () => {
            // SET ROLE alone would leave a superuser session_user able to switch to any role.
            // SESSION AUTHORIZATION exercises the same authority boundary as a runtime login.
            await client.query('SET LOCAL SESSION AUTHORIZATION careiq_clinical_runtime');
            const identity = await client.query<{ session_user: string; current_user: string }>(
              'SELECT session_user,current_user',
            );
            assert.equal(identity.rows[0]?.session_user, 'careiq_clinical_runtime');
            assert.equal(identity.rows[0]?.current_user, 'careiq_clinical_runtime');
            await denied(client, `SET LOCAL ROLE ${role}`);
          });
        });
      }
      await asRuntime(client);
      await verifyManagedHelperOwnership(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);

test(
  'private patient helpers preserve token scope, expiry, purpose and audit patient identity',
  { skip: !databaseUrl },
  async (context) => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
    const client = await pool.connect();
    const practice = randomUUID();
    const otherPractice = randomUUID();
    const location = randomUUID();
    const otherLocation = randomUUID();
    const foreignLocation = randomUUID();
    const scopes = [
      { practice, location, patient: randomUUID(), request: randomUUID() },
      { practice, location, patient: randomUUID(), request: randomUUID() },
      { practice, location: otherLocation, patient: randomUUID(), request: randomUUID() },
      {
        practice: otherPractice,
        location: foreignLocation,
        patient: randomUUID(),
        request: randomUUID(),
      },
    ];
    const own = scopes[0]!;
    const grant = randomUUID();
    const session = randomUUID();
    const portalGrant = randomUUID();
    const expiredPortalGrant = randomUUID();
    const portalSubject = `user_Managed${randomBytes(8).toString('hex')}`;
    const grantHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const sessionHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const resolve = async () =>
      (
        await client.query<{ access: { patient_id: string; request_id: string } | null }>(
          'SELECT public.careiq_resolve_patient_access($1,true) AS access',
          [sessionHash],
        )
      ).rows[0]?.access;
    const audit = (patient: string) => [
      JSON.stringify({
        action: 'signatures.presented',
        entityType: 'request',
        entityId: own.request,
      }),
      JSON.stringify([{ resourceType: 'request', resourceId: own.request, patientId: patient }]),
    ];
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic managed scope','location'),($3,$4,'Synthetic foreign scope','location')",
        [practice, `org_${practice}`, otherPractice, `org_${otherPractice}`],
      );
      await client.query(
        "INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic own','UTC'),($3,$2,'Synthetic other','UTC'),($4,$5,'Synthetic foreign','UTC')",
        [location, practice, otherLocation, foreignLocation, otherPractice],
      );
      for (const scope of scopes) {
        await client.query(
          "INSERT INTO patients(id,practice_id,location_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,'Synthetic','Managed scope','1980-01-01')",
          [scope.patient, scope.practice, scope.location],
        );
        await client.query(
          "INSERT INTO document_requests(id,practice_id,location_id,patient_id,purpose,recipient_name,expires_at,state,created_by_actor_id) VALUES($1,$2,$3,$4,'signature','Synthetic',now()+interval '1 day','open','synthetic')",
          [scope.request, scope.practice, scope.location, scope.patient],
        );
      }
      await client.query(
        "INSERT INTO patient_access_grants(id,practice_id,location_id,patient_id,request_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day')",
        [grant, practice, location, own.patient, own.request, grantHash],
      );
      await client.query(
        "INSERT INTO patient_sessions(id,practice_id,location_id,patient_id,request_id,grant_id,token_hash,request_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,now()+interval '1 hour')",
        [session, practice, location, own.patient, own.request, grant, sessionHash],
      );
      await client.query(
        "INSERT INTO patient_portal_grants(id,practice_id,location_id,patient_id,clerk_user_id,relationship,verification_method,verification_reference,verified_by_actor_id,expires_at) VALUES($1,$2,$3,$4,$5,'self','staff_in_person','Synthetic managed verification','synthetic_staff',now()+interval '1 day')",
        [portalGrant, practice, location, own.patient, portalSubject],
      );
      await client.query(
        "INSERT INTO patient_portal_grants(id,practice_id,location_id,patient_id,clerk_user_id,relationship,verification_method,verification_reference,verified_by_actor_id,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'self','staff_in_person','Synthetic expired verification','synthetic_staff',now()-interval '2 days',now()-interval '1 day')",
        [expiredPortalGrant, practice, location, scopes[1]!.patient, portalSubject],
      );
      await client.query(
        "SELECT set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session','true',true),set_config('app.actor_user_id','',true)",
        [sessionHash],
      );
      await asRuntime(client);
      assert.equal((await resolve())?.patient_id, own.patient);
      assert.deepEqual(
        (await client.query<{ id: string }>('SELECT id FROM document_requests')).rows,
        [{ id: own.request }],
      );

      await context.test('valid session may record its own patient audit resource', async () => {
        const result = await client.query<{ id: string }>(
          'SELECT audit.record_event($1::jsonb,$2::jsonb) AS id',
          audit(own.patient),
        );
        assert.match(result.rows[0]!.id, /^[0-9a-f-]{36}$/);
      });
      for (const [index, label] of [
        'another patient in the same location',
        'another location',
        'another practice',
      ].entries()) {
        const foreign = scopes[index + 1]!;
        await context.test(`token cannot disclose or audit ${label}`, async () => {
          await rolledBack(client, async () => {
            await client.query(
              "SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.patient_id',$3,true),set_config('app.request_id',$4,true)",
              [foreign.practice, foreign.location, foreign.patient, foreign.request],
            );
            assert.deepEqual(
              (await client.query<{ id: string }>('SELECT id FROM document_requests')).rows,
              [{ id: own.request }],
            );
            await denied(
              client,
              'SELECT audit.record_event($1::jsonb,$2::jsonb)',
              audit(foreign.patient),
              'AUDIT_PATIENT_SCOPE_DENIED',
            );
          });
        });
      }
      await context.test(
        'signature purpose cannot enter the collection fulfillment helper',
        async () => {
          await denied(
            client,
            'SELECT public.careiq_patient_fulfill_item($1,$2)',
            [randomUUID(), randomUUID()],
            'PATIENT_REQUEST_PURPOSE_UNSUPPORTED',
            '23514',
          );
        },
      );

      const invalidStates: [string, string, string][] = [
        ['revoked grant', 'UPDATE patient_access_grants SET revoked_at=now() WHERE id=$1', grant],
        [
          'expired grant',
          "UPDATE patient_access_grants SET expires_at=now()-interval '1 second' WHERE id=$1",
          grant,
        ],
        ['revoked session', 'UPDATE patient_sessions SET revoked_at=now() WHERE id=$1', session],
        [
          'expired session',
          "UPDATE patient_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
          session,
        ],
        [
          'expired request',
          "UPDATE document_requests SET expires_at=now()-interval '1 second' WHERE id=$1",
          own.request,
        ],
        [
          'changed request revision',
          'UPDATE document_requests SET revision=revision+1 WHERE id=$1',
          own.request,
        ],
      ];
      for (const [name, mutation, id] of invalidStates) {
        await context.test(
          `${name} removes lookup, table visibility and audit authority`,
          async () => {
            await rolledBack(client, async () => {
              await client.query('RESET ROLE');
              await client.query(mutation, [id]);
              await asRuntime(client);
              assert.equal(await resolve(), null);
              assert.equal((await client.query('SELECT id FROM document_requests')).rowCount, 0);
              await denied(
                client,
                'SELECT audit.record_event($1::jsonb,$2::jsonb)',
                audit(own.patient),
                'AUDIT_ACTOR_REQUIRED',
              );
            });
          },
        );
      }
      for (const token of [
        '',
        'not-a-token',
        createHash('sha256').update(randomBytes(32)).digest('hex'),
      ]) {
        await context.test(
          `unverified ${token ? 'fabricated' : 'missing'} token cannot manufacture scope`,
          async () => {
            await rolledBack(client, async () => {
              await client.query("SELECT set_config('app.patient_token_hash',$1,true)", [token]);
              assert.equal((await client.query('SELECT id FROM document_requests')).rowCount, 0);
              await denied(
                client,
                'SELECT public.careiq_patient_fulfill_item($1,$2)',
                [randomUUID(), randomUUID()],
                'PATIENT_REQUEST_UNAVAILABLE',
              );
              await denied(
                client,
                'SELECT audit.record_event($1::jsonb,$2::jsonb)',
                audit(own.patient),
                'AUDIT_ACTOR_REQUIRED',
              );
            });
          },
        );
      }
      await context.test(
        'portal identity requires an active matching staff-verified binding',
        async () => {
          await rolledBack(client, async () => {
            // SQL trusts the API-authenticated subject/session. This tests binding enforcement,
            // not cryptographic validation of a Clerk session inside PostgreSQL.
            await client.query(
              "SELECT set_config('app.patient_token_hash','',true),set_config('app.portal_subject',$1,true),set_config('app.portal_session','sess_ManagedFixture',true)",
              [portalSubject],
            );
            const profiles = await client.query<{ profiles: { grantId: string }[] }>(
              'SELECT public.careiq_portal_communication_choices() AS profiles',
            );
            assert.equal(profiles.rows[0]?.profiles.length, 1);
            assert.equal(profiles.rows[0]?.profiles[0]?.grantId, portalGrant);
            await client.query(
              "SELECT set_config('app.portal_subject','user_UnboundSynthetic',true)",
            );
            assert.deepEqual(
              (
                await client.query<{ profiles: unknown[] }>(
                  'SELECT public.careiq_portal_communication_choices() AS profiles',
                )
              ).rows[0]?.profiles,
              [],
            );
            await denied(
              client,
              'SELECT public.careiq_portal_communication_choices($1)',
              [portalGrant],
              'COMMUNICATION_PROFILE_UNAVAILABLE',
            );
            await client.query(
              "SELECT set_config('app.portal_subject',$1,true),set_config('app.portal_session','malformed',true)",
              [portalSubject],
            );
            await denied(
              client,
              'SELECT public.careiq_portal_communication_choices($1)',
              [portalGrant],
              'PORTAL_AUTHENTICATION_REQUIRED',
            );
          });
        },
      );
      for (const expired of [false, true]) {
        await context.test(
          `${expired ? 'expired' : 'revoked'} portal binding cannot read communication preferences`,
          async () => {
            await rolledBack(client, async () => {
              if (!expired) {
                await client.query('RESET ROLE');
                await client.query(
                  "UPDATE patient_portal_grants SET revoked_at=now(),revocation_reason_code='synthetic_test' WHERE id=$1",
                  [portalGrant],
                );
                await asRuntime(client);
              }
              await client.query(
                "SELECT set_config('app.patient_token_hash','',true),set_config('app.portal_subject',$1,true),set_config('app.portal_session','sess_ManagedFixture',true)",
                [portalSubject],
              );
              await denied(
                client,
                'SELECT public.careiq_portal_communication_choices($1)',
                [expired ? expiredPortalGrant : portalGrant],
                'COMMUNICATION_PROFILE_UNAVAILABLE',
              );
            });
          },
        );
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);
