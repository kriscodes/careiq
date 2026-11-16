import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');

export function assertManagedOwnership(owner, relations) {
  if (
    !owner ||
    owner.rolsuper ||
    owner.rolbypassrls ||
    !owner.rolcreatedb ||
    !owner.rolcreaterole
  ) {
    throw new Error('Migration owner must match the managed non-superuser, non-bypass role.');
  }
  if (!relations.length || relations.some((relation) => relation.owner !== owner.rolname)) {
    throw new Error('Every application table must be owned by the managed migration role.');
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
  }
  return result.stdout?.trim();
}

async function prepareUpgradeBaseline(ownerUrl, admin) {
  const migrationFolder = path.join(root, 'apps/api/drizzle');
  const journal = JSON.parse(
    readFileSync(path.join(migrationFolder, 'meta/_journal.json'), 'utf8'),
  );
  const entries = journal.entries.filter((entry) => entry.idx <= 48);
  if (entries.length !== 49 || entries.at(-1).tag !== '0048_manager_activity') {
    throw new Error('The reviewed pre-repair migration baseline is unavailable.');
  }
  const folder = mkdtempSync(path.join(os.tmpdir(), 'careiq-owner-upgrade-'));
  const owner = new Pool({ connectionString: ownerUrl, ssl: false, max: 1 });
  try {
    mkdirSync(path.join(folder, 'meta'));
    writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(
        path.join(migrationFolder, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    }
    await migrate(drizzle(owner), { migrationsFolder: folder });
  } finally {
    await owner.end();
    rmSync(folder, { recursive: true, force: true });
  }
  const practiceId = randomUUID(),
    locationId = randomUUID(),
    patientId = randomUUID();
  await admin.query(
    "INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic upgrade rehearsal','location','active')",
    [practiceId, `org_${practiceId}`],
  );
  await admin.query(
    "INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic location','UTC')",
    [locationId, practiceId],
  );
  await admin.query(
    "INSERT INTO patients(id,practice_id,location_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,'Synthetic','Upgrade','1980-01-01')",
    [patientId, practiceId, locationId],
  );
  const dataSql = `SELECT row_to_json(p) AS practice,row_to_json(l) AS location,row_to_json(patient) AS patient
    FROM practices p JOIN locations l ON l.practice_id=p.id JOIN patients patient ON patient.location_id=l.id
    WHERE p.id=$1 AND l.id=$2 AND patient.id=$3`;
  const identifiers = [practiceId, locationId, patientId];
  const data = (await admin.query(dataSql, identifiers)).rows;
  assert.equal(data.length, 1, 'Upgrade requires an existing synthetic patient fixture.');
  const ledger = (
    await admin.query(
      'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id',
    )
  ).rows;
  const bodiesSql = `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','audit')
    ORDER BY n.nspname,p.proname,arguments`;
  const bodies = (await admin.query(bodiesSql)).rows;
  assert.equal(ledger.length, 49, 'Upgrade starts with the exact reviewed 49-migration baseline.');
  return async () => {
    assert.deepEqual(
      (await admin.query(dataSql, identifiers)).rows,
      data,
      'Upgrade must preserve existing synthetic patient/practice data.',
    );
    const upgraded = (
      await admin.query(
        'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id',
      )
    ).rows;
    assert.deepEqual(
      upgraded.slice(0, ledger.length),
      ledger,
      'Applied migration hashes must remain unchanged.',
    );
    assert.ok(
      upgraded.length > ledger.length,
      'The ownership repair must be applied as a new migration.',
    );
    const after = (await admin.query(bodiesSql)).rows;
    for (const before of bodies) {
      assert.deepEqual(
        after.find(
          (entry) =>
            entry.nspname === before.nspname &&
            entry.proname === before.proname &&
            entry.arguments === before.arguments,
        ),
        before,
        'Ownership repair must preserve every pre-existing helper body.',
      );
    }
    console.log(
      'Managed-owner upgrade preserved existing records, helper bodies and all 49 historical ledger hashes.',
    );
  };
}

async function runManagedOwnerRehearsal(mode) {
  const container = `careiq-managed-owner-${randomUUID()}`;
  const password = randomBytes(24).toString('hex');
  const ownerPassword = randomBytes(24).toString('hex');
  const reportDirectory = path.join(root, '.tmp', 'managed-owner', mode);
  mkdirSync(reportDirectory, { recursive: true });
  let admin;
  let started = false;
  try {
    run('docker', [
      'run',
      '--detach',
      '--name',
      container,
      '--label',
      'careiq.test=managed-owner',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_DB=careiq_test',
      '--env',
      'POSTGRES_USER=postgres',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      'postgres:18.6',
    ]);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        spawnSync(
          'docker',
          [
            'exec',
            container,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres',
            '-d',
            'careiq_test',
          ],
          { stdio: 'ignore' },
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await setTimeout(500);
    }
    if (!ready) {
      throw new Error('Disposable managed-owner database did not become ready.');
    }
    const address = run('docker', ['port', container, '5432/tcp']);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(address)?.[1];
    if (!port) {
      throw new Error('Managed-owner database must be bound only to loopback.');
    }
    const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/careiq_test`;
    const ownerUrl = `postgresql://careiq_managed_owner:${ownerPassword}@127.0.0.1:${port}/careiq_test`;
    admin = new Pool({ connectionString: adminUrl, ssl: false });
    await admin.query(
      `CREATE ROLE careiq_managed_owner LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE NOREPLICATION; ALTER DATABASE careiq_test OWNER TO careiq_managed_owner`,
    );
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_SSL_MODE: 'disable',
      DATABASE_URL: ownerUrl,
      CAREIQ_AUDIT_DATABASE_URL: '',
    };
    const loader = pathToFileURL(path.join(root, 'apps/api/node_modules/tsx/dist/loader.mjs')).href;
    const verifyUpgrade = mode === 'upgrade' ? await prepareUpgradeBaseline(ownerUrl, admin) : null;
    for (const phase of ['apply', 'replay']) {
      console.log(`Managed-owner ${mode} migrations: ${phase}`);
      run(process.execPath, ['--import', loader, 'src/db/migrate.ts'], {
        cwd: path.join(root, 'apps/api'),
        env: environment,
        stdio: 'inherit',
      });
    }
    await verifyUpgrade?.();
    const owner = (
      await admin.query(
        "SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='careiq_managed_owner'",
      )
    ).rows[0];
    const relations = (
      await admin.query(
        "SELECT c.relname,r.rolname AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname IN ('public','audit') AND c.relkind IN ('r','p')",
      )
    ).rows;
    assertManagedOwnership(owner, relations);
    const tests = readdirSync(path.join(root, 'apps/api/tests'))
      .filter((file) => file.endsWith('.test.ts'))
      .sort()
      .map((file) => `tests/${file}`);
    if (!tests.length) {
      throw new Error('No API tests were discovered.');
    }
    console.log(
      `Managed-owner API tests: ${relations.length} application tables have verified restricted ownership.`,
    );
    run(
      process.execPath,
      [
        '--import',
        loader,
        '--test',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        `--test-reporter=${pathToFileURL(path.join(root, 'scripts/coverage-test-reporter.mjs')).href}`,
        `--test-reporter-destination=${path.join(reportDirectory, 'tests.json')}`,
        ...tests,
      ],
      {
        cwd: path.join(root, 'apps/api'),
        stdio: 'inherit',
        env: {
          ...environment,
          DATABASE_URL: adminUrl,
          TEST_DATABASE_URL: adminUrl,
          CAREIQ_MANAGED_OWNER_TEST: 'true',
        },
      },
    );
  } finally {
    await admin?.end();
    if (started) {
      run('docker', ['rm', '--force', '--volumes', container]);
    }
  }
}

export async function testManagedOwner() {
  await runManagedOwnerRehearsal('fresh');
  await runManagedOwnerRehearsal('upgrade');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  testManagedOwner().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
