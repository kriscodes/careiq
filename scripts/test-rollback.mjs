import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import {
  assertArtifactProvenance,
  assertRollbackBuild,
  recordRollbackBuild,
  repositoryRoot,
  runLocal,
  sha256,
} from './prepare-rollback.mjs';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = require('pg');

function safeEnvironment() {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function runLogged(command, args, directory, environment, logFile, failurePattern) {
  const result = spawnSync(command, args, {
    cwd: directory,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(logFile, `${result.stdout ?? ''}${result.stderr ?? ''}`, { mode: 0o600 });
  if (result.error) {
    throw result.error;
  }
  if (failurePattern) {
    if (result.status === 0 || !failurePattern.test(`${result.stdout}${result.stderr}`)) {
      throw new Error(
        `Expected strict rejection was not observed; inspect ${path.basename(logFile)}.`,
      );
    }
  } else if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed; inspect ${path.basename(logFile)}.`);
  }
}

async function startApi(api, environment, logFile, expectedFailure = false) {
  assertRollbackBuild(path.resolve(api, '../../..'));
  const log = createWriteStream(logFile, { mode: 0o600 });
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: api,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  const close = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([close, setTimeout(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await close;
      }
    }
    log.end();
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) {
        throw launchError;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        if (expectedFailure && child.exitCode !== 0) {
          return { stop, rejected: true };
        }
        throw new Error('Rollback API exited before readiness.');
      }
      try {
        const response = await fetch(`http://127.0.0.1:${environment.PORT}/health`, {
          redirect: 'error',
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          if (expectedFailure) {
            throw new Error('Rollback API started despite a corrupted private-helper policy.');
          }
          const health = await response.json();
          assert.equal(health.status, 'ok');
          assert.equal(health.database, 'connected');
          assert.match(response.headers.get('cache-control') ?? '', /no-store/);
          return { stop, health };
        }
      } catch (error) {
        if (error instanceof assert.AssertionError || error.message.includes('despite')) {
          throw error;
        }
      }
      await setTimeout(250);
    }
    throw new Error('Rollback API readiness timed out.');
  } catch (error) {
    await stop();
    throw error;
  }
}

function productionFixture(privateDirectory, revision, certificate, databaseUrl, port) {
  const publishable = `pk_live_${Buffer.from('clerk.rollback.example$').toString('base64')}`;
  return {
    ...safeEnvironment(),
    NODE_ENV: 'production',
    CI: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    DATABASE_SSL_MODE: 'verify-full',
    NODE_EXTRA_CA_CERTS: certificate,
    CAREIQ_PRIVATE_STORAGE_DIR: privateDirectory,
    CLERK_PUBLISHABLE_KEY: publishable,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
    CLERK_SECRET_KEY: `sk_live_${randomBytes(32).toString('hex')}`,
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${randomBytes(32).toString('base64')}`,
    CORS_ORIGINS: 'https://app.rollback.example',
    CAREIQ_INVITATION_REDIRECT_URL: 'https://app.rollback.example/accept',
    CAREIQ_WORKFLOW_CURSOR_SECRET: randomBytes(32).toString('hex'),
    INTERVIEW_REQUESTS_ENABLED: 'false',
    CAREIQ_NOTIFICATION_WORKER_ENABLED: 'false',
    CAREIQ_AUDIT_DATABASE_URL: '',
    NEXT_PUBLIC_API_URL: 'https://api.rollback.example',
    CAREIQ_BUILD_REVISION: revision,
  };
}

/** This tool always creates its own loopback database. It accepts no database URL or production origin. */
export async function rehearseRollback(artifact) {
  const relative = path.relative(
    path.join(repositoryRoot, '.tmp', 'rollback'),
    path.resolve(artifact),
  );
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Use an artifact prepared under this checkout’s .tmp/rollback directory.');
  }
  const provenance = assertArtifactProvenance(artifact);
  const source = path.join(artifact, 'source');
  const api = path.join(source, 'apps/api');
  const logs = path.join(artifact, 'logs');
  mkdirSync(logs, { recursive: true });
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'careiq-rollback-'));
  const privateDirectory = path.join(temporary, 'private');
  mkdirSync(privateDirectory, { mode: 0o700 });
  const container = `careiq-rollback-${randomUUID()}`;
  const password = randomBytes(24).toString('hex');
  const ownerPassword = randomBytes(24).toString('hex');
  const runtimePassword = randomBytes(24).toString('hex');
  let started = false;
  let admin;
  let server;
  const evidence = {
    version: 1,
    kind: 'local-production-rollback-rehearsal',
    deployable: false,
    baselineCommit: provenance.baselineCommit,
    sourceDigest: provenance.sourceDigest,
    localRevision: provenance.localRevision,
    revisionIsGitCommit: false,
    checks: [],
  };
  try {
    runLogged(
      'pnpm',
      ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      source,
      { ...safeEnvironment(), CI: '1' },
      path.join(logs, 'dependencies.log'),
    );
    assertArtifactProvenance(artifact);
    runLocal(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-keyout',
        path.join(temporary, 'server.key'),
        '-out',
        path.join(temporary, 'server.crt'),
      ],
      { stdio: 'ignore' },
    );
    const fixture = productionFixture(
      privateDirectory,
      provenance.localRevision,
      path.join(temporary, 'server.crt'),
      '',
      await unusedPort(),
    );
    runLogged('pnpm', ['run', 'build'], api, fixture, path.join(logs, 'api-build.log'));
    // Package hooks remain intact. The fixture is not Render and its identity is explicitly local-only.
    runLogged(
      'pnpm',
      ['run', 'build'],
      path.join(source, 'apps/web'),
      fixture,
      path.join(logs, 'web-build.log'),
    );
    const built = recordRollbackBuild(artifact);
    evidence.buildDigest = built.buildDigest;
    evidence.checks.push('archived API and aligned web production builds pass');
    runLocal('docker', [
      'run',
      '--detach',
      '--name',
      container,
      '--label',
      'careiq.test=rollback',
      '--publish',
      '127.0.0.1::5432',
      '--mount',
      `type=bind,source=${temporary},target=/rollback-tls,readonly`,
      '--env',
      'POSTGRES_DB=careiq_test',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--entrypoint',
      'bash',
      'postgres:18.6',
      '-ec',
      'cp /rollback-tls/server.crt /rollback-tls/server.key /tmp/; chown postgres:postgres /tmp/server.crt /tmp/server.key; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key',
    ]);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
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
      await setTimeout(250);
    }
    if (!ready) {
      throw new Error('Disposable rollback PostgreSQL failed readiness.');
    }
    const address = runLocal('docker', ['port', container, '5432/tcp']);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(address)?.[1];
    if (!port) {
      throw new Error('Rollback PostgreSQL must bind only to loopback.');
    }
    const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/careiq_test`;
    const ownerUrl = `postgresql://careiq_owner:${ownerPassword}@127.0.0.1:${port}/careiq_test`;
    const runtimeUrl = `postgresql://careiq_rollback_api:${runtimePassword}@127.0.0.1:${port}/careiq_test`;
    admin = new Pool({
      connectionString: adminUrl,
      ssl: {
        rejectUnauthorized: true,
        ca: readFileSync(path.join(temporary, 'server.crt'), 'utf8'),
      },
    });
    await admin.query(
      `CREATE ROLE careiq_owner LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE NOREPLICATION; ALTER DATABASE careiq_test OWNER TO careiq_owner`,
    );
    const migrationEnvironment = { ...fixture, NODE_ENV: 'test', DATABASE_URL: ownerUrl };
    const migrate = ['--import', './node_modules/tsx/dist/loader.mjs', 'src/db/migrate.ts'];
    runLogged(
      process.execPath,
      migrate,
      api,
      migrationEnvironment,
      path.join(logs, 'migration-apply.log'),
    );
    runLogged(
      process.execPath,
      migrate,
      api,
      migrationEnvironment,
      path.join(logs, 'migration-replay.log'),
    );
    await admin.query(
      `CREATE ROLE careiq_rollback_api LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; GRANT careiq_clinical_runtime TO careiq_rollback_api`,
    );
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await admin.query(
      "INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic rollback practice','location')",
      [ids[0], `org_${ids[0]}`],
    );
    await admin.query(
      "INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic rollback location','UTC')",
      [ids[1], ids[0]],
    );
    await admin.query(
      "INSERT INTO patients(id,practice_id,location_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,'Synthetic','Rollback','1980-01-01')",
      [ids[2], ids[0], ids[1]],
    );
    const dataQuery =
      'SELECT row_to_json(p) AS practice,row_to_json(l) AS location,row_to_json(patient) AS patient FROM practices p JOIN locations l ON l.practice_id=p.id JOIN patients patient ON patient.location_id=l.id WHERE p.id=$1 AND l.id=$2 AND patient.id=$3';
    const before = (await admin.query(dataQuery, ids)).rows;
    const ledgerQuery =
      'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id';
    const ledger = (await admin.query(ledgerQuery)).rows;
    assert.equal(ledger.length, 50);

    // The original deployed source must still reject migration 50; compatibility
    // is supplied by the enumerated overlay, never by weakening the old checks.
    const original = path.join(temporary, 'original');
    mkdirSync(original);
    const archive = path.join(temporary, 'original.tar');
    runLocal('git', [
      'archive',
      '--format=tar',
      `--output=${archive}`,
      provenance.baselineCommit,
      'apps/api/src',
      'apps/api/drizzle',
      'apps/api/package.json',
    ]);
    runLocal('tar', ['-xf', archive, '-C', original]);
    const originalApi = path.join(original, 'apps/api');
    symlinkSync(
      path.join(path.resolve(api), 'node_modules'),
      path.join(originalApi, 'node_modules'),
      'dir',
    );
    runLogged(
      process.execPath,
      migrate,
      originalApi,
      migrationEnvironment,
      path.join(logs, 'original-rejected-ledger.log'),
      /migration history differs/,
    );
    runLogged(
      process.execPath,
      [
        '--import',
        './node_modules/tsx/dist/loader.mjs',
        'src/db/verify-release.ts',
        '--database-only',
      ],
      originalApi,
      { ...fixture, NODE_ENV: 'test', DATABASE_URL: runtimeUrl },
      path.join(logs, 'original-rejected-policies.log'),
      /Row-level security policies differ/,
    );
    evidence.checks.push(
      'unmodified deployed baseline rejects the 50-entry ledger and new helper policy inventory',
    );
    const apiTests = readdirSync(path.join(api, 'tests'))
      .filter((file) => file.endsWith('.test.ts'))
      .sort()
      .map((file) => `tests/${file}`);
    if (!apiTests.length) {
      throw new Error('Rollback API tests are missing.');
    }
    const report = path.resolve(artifact, 'rollback-api-tests.json');
    runLogged(
      process.execPath,
      [
        '--import',
        './node_modules/tsx/dist/loader.mjs',
        '--test',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        `--test-reporter=${path.join(repositoryRoot, 'scripts/coverage-test-reporter.mjs')}`,
        `--test-reporter-destination=${report}`,
        ...apiTests,
      ],
      api,
      {
        ...fixture,
        NODE_ENV: 'test',
        DATABASE_SSL_MODE: 'disable',
        DATABASE_URL: adminUrl,
        TEST_DATABASE_URL: adminUrl,
      },
      path.join(logs, 'api-tests.log'),
    );
    const apiResult = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(apiResult.success, true);
    assert.equal(apiResult.skipped, 0);
    assert.equal(apiResult.todo, 0);
    evidence.apiTests = apiResult;
    runLogged(
      'pnpm',
      ['test'],
      path.join(source, 'apps/web'),
      { ...fixture, NODE_ENV: 'test' },
      path.join(logs, 'web-tests.log'),
    );
    evidence.checks.push(
      'archived API suite plus explicit security regressions passes without skips; aligned web unit suite passes',
    );

    const runtimeEnvironment = { ...fixture, DATABASE_URL: runtimeUrl };
    server = await startApi(api, runtimeEnvironment, path.join(logs, 'api-start.log'));
    const unauthorized = await fetch(`http://127.0.0.1:${fixture.PORT}/api/v1/me`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(unauthorized.status, 401);
    evidence.checks.push(
      'actual production API starts against all 50 entries with restricted runtime and verified TLS',
      'health is ready and unsigned account access is denied',
    );
    if (server.health.revision !== undefined) {
      assert.equal(server.health.revision, provenance.localRevision);
    }
    await server.stop();
    server = undefined;
    await admin.query('ALTER POLICY managed_token_lookup ON public.patient_sessions TO PUBLIC');
    try {
      server = await startApi(
        api,
        runtimeEnvironment,
        path.join(logs, 'rejected-policy.log'),
        true,
      );
      await server.stop();
      server = undefined;
      assert.match(readFileSync(path.join(logs, 'rejected-policy.log'), 'utf8'), /Managed helper/);
    } finally {
      await admin.query(
        'ALTER POLICY managed_token_lookup ON public.patient_sessions TO careiq_token_lookup',
      );
    }
    evidence.checks.push('corrupted private-helper policy prevents actual production startup');
    await admin.query(
      "UPDATE drizzle.__drizzle_migrations SET hash=repeat('0',64) WHERE created_at=$1",
      [ledger.at(-1).created_at],
    );
    try {
      runLogged(
        process.execPath,
        migrate,
        api,
        migrationEnvironment,
        path.join(logs, 'rejected-ledger.log'),
        /checksum differs|migration history differs/,
      );
    } finally {
      await admin.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE created_at=$2', [
        ledger.at(-1).hash,
        ledger.at(-1).created_at,
      ]);
    }
    evidence.checks.push(
      'altered migration ledger prevents the real migration runner from proceeding',
    );
    server = await startApi(api, runtimeEnvironment, path.join(logs, 'api-restart.log'));
    await server.stop();
    server = undefined;
    assert.deepEqual((await admin.query(dataQuery, ids)).rows, before);
    assert.deepEqual((await admin.query(ledgerQuery)).rows, ledger);
    evidence.checks.push(
      'fallback restarts after restored boundaries; synthetic data and all 50 ledger entries remain identical',
    );
    assertRollbackBuild(artifact);
    evidence.apiBuildDigest = sha256(readFileSync(path.join(api, 'dist/index.js')));
    evidence.completedAt = new Date().toISOString();
    evidence.success = true;
    writeFileSync(
      path.join(artifact, 'rollback-rehearsal.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(`Local fallback rehearsal passed: ${artifact}`);
    return evidence;
  } finally {
    await server?.stop();
    await admin?.end();
    if (started) {
      runLocal('docker', ['rm', '--force', '--volumes', container]);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = process.argv[2];
  if (!artifact || process.argv.length !== 3) {
    console.error('Usage: test-rollback.mjs <prepared-local-artifact-directory>');
    process.exitCode = 1;
  } else {
    rehearseRollback(artifact).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
