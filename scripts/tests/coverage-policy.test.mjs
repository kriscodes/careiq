import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireCoverageDatabase, validateCoveragePolicy } from '../coverage-policy.mjs';
import coverageTestReporter from '../coverage-test-reporter.mjs';

test('release coverage rejects missing, hosted, review, and URL-overridden databases', () => {
  for (const value of [
    undefined,
    'not-a-url',
    'postgresql://operator@db.example.com/careiq_test',
    'postgresql://operator@127.0.0.1/careiq_review',
    'https://127.0.0.1/careiq_test',
    'postgresql://operator@127.0.0.1/careiq_test?host=db.example.com',
    'postgresql://operator@127.0.0.1/careiq_test#override',
  ]) {
    assert.throws(() => requireCoverageDatabase({ TEST_DATABASE_URL: value }), /Coverage requires/);
  }
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.doesNotThrow(() =>
      requireCoverageDatabase({
        TEST_DATABASE_URL: `postgresql://operator@${hostname}:55432/careiq_test`,
      }),
    );
  }
});

test('coverage reporter fails closed when a test run has no final summary', async () => {
  await assert.rejects(async () => {
    for await (const output of coverageTestReporter([])) {
      void output;
    }
  }, /complete test summary/);
});

test('actual Node test runs cannot pass release coverage with skips or TODOs', () => {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const directory = mkdtempSync(path.join(tmpdir(), 'careiq-coverage-policy-'));
  const reporter = new URL('../coverage-test-reporter.mjs', import.meta.url).href;
  try {
    for (const [name, source, expectedStatus] of [
      ['passing', 'test("passes", () => {});', 0],
      ['skipped', 'test.skip("must not count as coverage", () => {});', 1],
      ['todo', 'test.todo("unfinished coverage");', 1],
      ['failing', 'test("fails", () => { throw new Error("expected fixture failure"); });', 1],
    ]) {
      const filename = path.join(directory, `${name}.test.mjs`);
      writeFileSync(filename, `import test from "node:test";\n${source}\n`);
      const result = spawnSync(
        process.execPath,
        ['--test', `--test-reporter=${reporter}`, filename],
        { encoding: 'utf8', env: childEnvironment },
      );
      assert.equal(result.status, expectedStatus, `${name}: ${result.stdout} ${result.stderr}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage reporter rejects a zero-test aggregate', async () => {
  const events = [
    { type: 'test:summary', data: { counts: { tests: 0, skipped: 0, todo: 0 }, success: true } },
  ];
  await assert.rejects(async () => {
    for await (const output of coverageTestReporter(events)) {
      void output;
    }
  }, /passing tests with no skips/);
});

test('coverage policy cannot lose workspaces or silently disable a metric', () => {
  const policy = JSON.parse(
    readFileSync(new URL('../../coverage-policy.json', import.meta.url), 'utf8'),
  );
  assert.doesNotThrow(() => validateCoveragePolicy(policy));
  const mutations = [
    (copy) => {
      copy.targets.pop();
    },
    (copy) => {
      copy.targets[1] = copy.targets[0];
    },
    (copy) => {
      copy.targets[0].thresholds.lines = 0;
    },
    (copy) => {
      delete copy.targets[0].thresholds.branches;
    },
    (copy) => {
      copy.targets[0].thresholds.statement = 80;
    },
    (copy) => {
      copy.targets[0].thresholds.lines = 101;
    },
    (copy) => {
      copy.targets[0].thresholds.lines = '80';
    },
    (copy) => {
      copy.targets[0].include = [];
    },
    (copy) => {
      copy.targets[1].scopes[0].thresholds.functions = 0;
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCoveragePolicy(copy));
  }
});
