import { symlinkSync } from 'node:fs';
import { readRegularFile, assertJournalCompatibility, sha256 } from '../prepare-rollback.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  artifactFiles,
  sourceIdentity,
  safeArtifactPath,
  validateSecurityOverlay,
  assertArtifactProvenance,
  recordRollbackBuild,
  assertRollbackBuild,
  overlayDependencies,
} from '../prepare-rollback.mjs';

test('rollback overlays reject traversal, unsupported paths, duplicates and unpinned source', () => {
  for (const bad of [
    '../secret',
    '/tmp/file',
    'apps/../file',
    'apps\\api\\file',
    '.git/config',
    'a/node_modules/key',
  ]) {
    assert.throws(() => safeArtifactPath(bad));
  }
  const entry = {
    path: 'apps/api/src/app.ts',
    sha256: 'a'.repeat(64),
    reason: 'Reviewed authenticated route rate limiting.',
  };
  assert.equal(validateSecurityOverlay({ version: 1, files: [entry] }).length, 1);
  for (const files of [
    [{ ...entry, path: '.env' }],
    [{ ...entry, sha256: 'abc' }],
    [entry, entry],
    [{ ...entry, reason: '' }],
    [{ ...entry, path: 'apps/api/src/db/managed-owner-policy.ts' }],
  ]) {
    assert.throws(() => validateSecurityOverlay({ version: 1, files }));
  }
});

test('rollback source and output manifests reject extra files, edits and false deployment identity', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'careiq-rollback-unit-'));
  const source = path.join(folder, 'source');
  mkdirSync(path.join(source, 'apps/api/src'), { recursive: true });
  writeFileSync(path.join(source, 'apps/api/src/index.ts'), 'export const value=1;\n');
  writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const files = artifactFiles(source);
  const identity = sourceIdentity(files);
  const provenance = {
    version: 1,
    kind: 'local-rollback-overlay',
    deployable: false,
    revisionIsGitCommit: false,
    baselineCommit: 'b'.repeat(40),
    sourceFiles: files,
    sourceDigest: identity.sha256,
    localRevision: identity.localRevision,
  };
  const save = () =>
    writeFileSync(path.join(folder, 'rollback-provenance.json'), JSON.stringify(provenance));
  save();
  try {
    assert.equal(assertArtifactProvenance(folder).sourceDigest, identity.sha256);
    writeFileSync(path.join(source, 'apps/api/src/injected.ts'), 'export const unreviewed=true;');
    assert.throws(() => assertArtifactProvenance(folder), /inventory/);
    rmSync(path.join(source, 'apps/api/src/injected.ts'));
    provenance.deployable = true;
    save();
    assert.throws(() => assertArtifactProvenance(folder), /deployment/);
    provenance.deployable = false;
    save();
    mkdirSync(path.join(source, 'apps/api/dist'), { recursive: true });
    mkdirSync(path.join(source, 'apps/web/.next/server'), { recursive: true });
    writeFileSync(path.join(source, 'apps/api/dist/index.js'), 'export const value=1;');
    writeFileSync(path.join(source, 'apps/web/.next/server/page.js'), 'export const page=true;');
    const built = recordRollbackBuild(folder);
    assert.equal(assertRollbackBuild(folder).buildDigest, built.buildDigest);
    writeFileSync(path.join(source, 'apps/api/dist/index.js'), 'export const value=2;');
    assert.throws(() => assertRollbackBuild(folder), /outputs/);
    writeFileSync(path.join(source, 'apps/api/dist/index.js'), 'export const value=1;');
    writeFileSync(path.join(source, 'apps/api/dist/extra.js'), 'export const extra=true;');
    assert.throws(() => assertRollbackBuild(folder), /outputs/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('overlay dependency closure identifies baseline and explicitly overlaid dependencies', () => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'careiq-rollback-imports-'));
  mkdirSync(path.join(source, 'apps/api/src'), { recursive: true });
  const parent = 'apps/api/src/index.ts',
    child = 'apps/api/src/child.ts';
  writeFileSync(path.join(source, parent), "import {value} from './child.js';\n");
  try {
    assert.throws(
      () => overlayDependencies(source, [{ path: parent }], new Map()),
      /explicit dependency/,
    );
    writeFileSync(path.join(source, child), 'export const value=1;');
    const files = new Map(artifactFiles(source).map((entry) => [entry.path, entry.sha256]));
    assert.equal(overlayDependencies(source, [{ path: parent }], files)[0].origin, 'baseline');
    writeFileSync(path.join(source, child), 'export const value=2;');
    assert.equal(
      overlayDependencies(source, [{ path: parent }, { path: child }], files)[0].origin,
      'explicit-overlay',
    );
    assert.ok(readFileSync(path.join(source, parent), 'utf8').includes('./child.js'));
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test('rollback inputs reject symlinks and historical journal edits', () => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'careiq-rollback-journal-'));
  mkdirSync(path.join(source, 'apps/api/drizzle/meta'), { recursive: true });
  const entries = Array.from({ length: 49 }, (_, idx) => ({
    idx,
    version: '7',
    when: 100 + idx,
    tag: `${String(idx).padStart(4, '0')}_fixture`,
    breakpoints: true,
  }));
  const baselineFiles = new Map();
  for (const entry of entries) {
    const filename = `apps/api/drizzle/${entry.tag}.sql`;
    writeFileSync(path.join(source, filename), 'SELECT 1;');
    baselineFiles.set(filename, sha256('SELECT 1;'));
  }
  const journal = {
    entries: [
      ...entries,
      { idx: 49, version: '7', when: 149, tag: '0049_managed_helper_ownership', breakpoints: true },
    ],
  };
  const journalFile = path.join(source, 'apps/api/drizzle/meta/_journal.json');
  try {
    writeFileSync(journalFile, JSON.stringify(journal));
    assert.doesNotThrow(() => assertJournalCompatibility(source, baselineFiles, { entries }));
    journal.entries[0] = { ...journal.entries[0], when: 99 };
    writeFileSync(journalFile, JSON.stringify(journal));
    assert.throws(
      () => assertJournalCompatibility(source, baselineFiles, { entries }),
      /historical journal/,
    );
    const link = path.join(source, 'link');
    symlinkSync(journalFile, link);
    assert.throws(() => readRegularFile(link));
    assert.throws(() => readRegularFile(source), /regular files/);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});
