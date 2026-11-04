import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  changedRuntimeLines,
  checkChangedCoverage,
  loadChanges,
  parseLcov,
  sourceWorkspace,
  coverageSourceDigest,
  writeCoverageProvenance,
  verifyCoverageProvenance,
} from '../changed-coverage.mjs';

const filename = path.resolve('apps/api/src/example.ts');

test('formatting, type annotations, comments and braces-only lint fixes do not inflate changed code', () => {
  const before = 'const message: string = "hello"; if (message) console.log(message)';
  const after =
    "// formatted\nconst message: string | null = 'hello';\nif (message) {\n  console.log(message);\n}\n";
  assert.equal(changedRuntimeLines(before, after, filename).size, 0);
  assert.equal(
    changedRuntimeLines(
      'interface User { name: string }',
      'type User = { name: string; age: number };',
      filename,
    ).size,
    0,
  );
});

test('JSX indentation, comments and explicit spaces preserve runtime text', () => {
  const before = 'export const view = <div>Hello <b>world</b></div>;';
  const after =
    "export const view = (\n  <div>\n    Hello{' '}{/* comment */}\n    <b>world</b>\n  </div>\n);";
  assert.equal(changedRuntimeLines(before, after, 'example.tsx').size, 0);
  assert.ok(
    changedRuntimeLines(before, before.replace('Hello', 'Welcome'), 'example.tsx').size > 0,
  );
});

test('changed runtime values and conditions map to current source lines', () => {
  const before = 'export function allowed(age: number) {\n  return age > 18;\n}';
  const after = 'export function allowed(age: number) {\n  return age >= 21;\n}';
  assert.deepEqual([...changedRuntimeLines(before, after, filename)], [2]);
  const outcome = checkChangedCoverage(
    [{ filename, before, after }],
    new Map([[filename, new Map([[2, 0]])]]),
  );
  assert.equal(outcome.passed, false);
  assert.equal(outcome.total, 1);
  assert.deepEqual(outcome.uncovered, [`${filename}:2`]);
});

test('new code requires 80 percent executable coverage without rounding up', () => {
  const after = Array.from(
    { length: 10 },
    (_, index) => `export const value${index} = ${index};`,
  ).join('\n');
  const coverage = new Map(
    Array.from({ length: 10 }, (_, index) => [index + 1, index < 8 ? 1 : 0]),
  );
  const changes = [{ filename, before: '', after }];
  assert.equal(checkChangedCoverage(changes, new Map([[filename, coverage]])).percentage, 80);
  assert.equal(checkChangedCoverage(changes, new Map([[filename, coverage]])).passed, true);
  coverage.set(8, 0);
  assert.equal(checkChangedCoverage(changes, new Map([[filename, coverage]])).passed, false);
  assert.throws(() => checkChangedCoverage(changes, new Map()), /missing from coverage/);
  assert.throws(
    () => checkChangedCoverage(changes, new Map([[filename, new Map()]])),
    /no executable coverage/,
  );
  assert.throws(() => checkChangedCoverage(changes, new Map(), 0), /threshold/);
});

test('ordinary block scope and new runtime statements are not treated as formatting', () => {
  assert.ok(changedRuntimeLines('const answer = 1;', '{ const answer = 1; }', filename).size > 0);
  assert.ok(
    changedRuntimeLines('if (ok) work();', 'if (ok) { work(); publish(); }', filename).size > 0,
  );
  assert.throws(() => changedRuntimeLines('', 'const broken = ;', filename), /Cannot parse/);
});

test('LCOV resolves workspace source paths and rejects malformed or empty reports', () => {
  const records = parseLcov(
    'TN:\nSF:src/example.ts\nDA:1,3\nDA:2,0\nend_of_record\n',
    path.resolve('apps/api'),
  );
  assert.deepEqual(
    [...records.get(filename)],
    [
      [1, 3],
      [2, 0],
    ],
  );
  for (const text of ['', 'DA:1,1', 'SF:src/example.ts\nDA:0,1', 'SF:a.ts\nSF:a.ts']) {
    assert.throws(() => parseLcov(text, '.'), /Coverage report|Invalid|Duplicate|Incomplete/);
  }
});

test('source scope includes application and shared runtime code but excludes tests and declarations', () => {
  for (const file of [
    'apps/api/src/app.ts',
    'apps/web/src/components/Example.tsx',
    'apps/marketing/src/app/page.tsx',
    'packages/i18n/error-codes.ts',
    'packages/interview-contract/index.js',
  ]) {
    assert.ok(sourceWorkspace(file), file);
  }
  for (const file of [
    'apps/api/tests/app.test.ts',
    'packages/i18n/tests/catalogs.test.ts',
    'packages/i18n/types.d.ts',
    'packages/i18n/dist/index.js',
    'scripts/tool.mjs',
  ]) {
    assert.equal(sourceWorkspace(file), undefined, file);
  }
});

function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'careiq-coverage-tests-'));
  const git = (args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'coverage-fixture@example.invalid']);
  git(['config', 'user.name', 'Coverage fixture']);
  mkdirSync(path.join(root, 'apps/api/src'), { recursive: true });
  writeFileSync(path.join(root, 'apps/api/src/original.ts'), 'export const value = 1;\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'Synthetic coverage baseline']);
  return { root, git };
}

test('base commit is explicit; renamed, deleted and untracked source are handled', () => {
  const { root, git } = repository();
  try {
    assert.throws(() => loadChanges(root), /COVERAGE_BASE_SHA/);
    assert.throws(() => loadChanges(root, 'missing-commit'), /base commit is unavailable/);
    git(['mv', 'apps/api/src/original.ts', 'apps/api/src/renamed.ts']);
    let changes = loadChanges(root, 'HEAD');
    assert.equal(changes.length, 1);
    assert.equal(
      changedRuntimeLines(changes[0].before, changes[0].after, changes[0].filename).size,
      0,
    );
    writeFileSync(path.join(root, 'apps/api/src/new.ts'), 'export const addition = 2;\n');
    changes = loadChanges(root, 'HEAD');
    assert.equal(changes.length, 2);
    assert.equal(changes.find((entry) => entry.filename.endsWith('/new.ts')).before, '');
    rmSync(path.join(root, 'apps/api/src/renamed.ts'));
    changes = loadChanges(root, 'HEAD');
    assert.equal(changes.length, 1);
    assert.ok(changes[0].filename.endsWith('/new.ts'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage provenance rejects missing, altered, stale and concurrently changed sources', () => {
  const { root } = repository();
  try {
    assert.throws(() => verifyCoverageProvenance(root), /provenance is missing/);
    for (const name of ['api', 'web', 'marketing', 'i18n', 'interview-contract']) {
      const directory = path.join(root, 'coverage', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, 'lcov.info'),
        'SF:src/example.ts\nDA:1,1\nend_of_record\n',
      );
    }
    const originalDigest = coverageSourceDigest(root);
    mkdirSync(path.join(root, 'apps/api/tests'));
    writeFileSync(path.join(root, 'apps/api/tests/example.test.ts'), 'export {};');
    assert.notEqual(
      coverageSourceDigest(root),
      originalDigest,
      'test edits must invalidate provenance',
    );
    const digest = coverageSourceDigest(root);
    writeCoverageProvenance(root, digest);
    verifyCoverageProvenance(root);
    writeFileSync(path.join(root, 'coverage/api/lcov.info'), 'changed report');
    assert.throws(() => verifyCoverageProvenance(root), /report is missing or changed/);
    writeCoverageProvenance(root, digest);
    writeFileSync(path.join(root, 'apps/api/src/original.ts'), 'export const value = 2;\n');
    assert.throws(() => verifyCoverageProvenance(root), /Coverage is stale/);
    assert.throws(() => writeCoverageProvenance(root, digest), /changed during coverage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
