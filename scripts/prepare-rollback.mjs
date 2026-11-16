import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const rollbackBaseline = '7d2cabe4b48d4e4d2aa8006a7bb253c539d79d12';
export const compatibilityOverlay = [
  'apps/api/drizzle/meta/_journal.json',
  'apps/api/drizzle/0049_managed_helper_ownership.sql',
  'apps/api/src/db/release-check.ts',
  'apps/api/src/db/notification-release-check.ts',
  'apps/api/src/db/managed-owner-policy.ts',
  'apps/api/src/db/managed-owner-release-check.ts',
];
const typescript = createRequire(import.meta.url)('typescript');

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Validate and read the same open file; a replaced path cannot redirect a later copy. */
export function readRegularFile(filename, encoding) {
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error('Rollback inputs must be regular files.');
    }
    return readFileSync(descriptor, encoding);
  } finally {
    closeSync(descriptor);
  }
}

export function runLocal(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
  }
  return result.stdout?.trim();
}

export function safeArtifactPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split('/').some((part) => ['.', '..', '.git', 'node_modules'].includes(part))
  ) {
    throw new Error('Rollback paths must name ordinary repository files without traversal.');
  }
  return relativePath;
}

export function validateSecurityOverlay(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Security overlay requires version 1 and an explicit files list.');
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    safeArtifactPath(entry.path);
    const allowed =
      /^(apps\/(api|web)\/(src|tests)\/|packages\/(i18n|interview-contract)\/)/.test(entry.path) ||
      [
        'apps/api/package.json',
        'apps/web/package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'package.json',
        'scripts/verify-deployment-checks.mjs',
        'scripts/release-metadata.mjs',
      ].includes(entry.path);
    if (
      !allowed ||
      compatibilityOverlay.includes(entry.path) ||
      seen.has(entry.path) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length < 12
    ) {
      throw new Error(
        'Security overlays require unique allowed source paths, exact SHA-256 values and specific review reasons.',
      );
    }
    seen.add(entry.path);
  }
  return manifest.files;
}

export function artifactFiles(directory, prefix = '', excluded = () => false) {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      if (excluded(relative)) {
        return [];
      }
      if (entry.isSymbolicLink()) {
        throw new Error('Rollback source archives must not contain symbolic links.');
      }
      if (entry.isDirectory()) {
        return artifactFiles(directory, relative, excluded);
      }
      if (!entry.isFile()) {
        throw new Error(
          'Rollback source archives must contain only directories and regular files.',
        );
      }
      return [{ path: relative, sha256: sha256(readRegularFile(path.join(directory, relative))) }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function sourceIdentity(files) {
  const digest = sha256(JSON.stringify(files));
  return {
    sha256: digest,
    localRevision: createHash('sha1').update(`careiq-local-rollback\0${digest}`).digest('hex'),
  };
}

export function assertJournalCompatibility(stage, baselineFiles, baselineJournal) {
  const journal = JSON.parse(
    readRegularFile(path.join(stage, 'apps/api/drizzle/meta/_journal.json'), 'utf8'),
  );
  if (
    journal.entries?.length !== 50 ||
    journal.entries.at(-1).tag !== '0049_managed_helper_ownership'
  ) {
    throw new Error('Rollback artifact must understand the complete 50-entry migration journal.');
  }
  if (JSON.stringify(journal.entries.slice(0, 49)) !== JSON.stringify(baselineJournal.entries)) {
    throw new Error('Rollback preparation must preserve every historical journal entry.');
  }
  for (const entry of journal.entries.slice(0, 49)) {
    const migration = `apps/api/drizzle/${entry.tag}.sql`;
    if (baselineFiles.get(migration) !== sha256(readRegularFile(path.join(stage, migration)))) {
      throw new Error('Rollback preparation must preserve every historical migration byte.');
    }
  }
}

export function assertArtifactProvenance(artifact) {
  const manifest = JSON.parse(
    readRegularFile(path.join(artifact, 'rollback-provenance.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.kind !== 'local-rollback-overlay' ||
    manifest.deployable !== false ||
    manifest.revisionIsGitCommit !== false ||
    !/^[a-f0-9]{40}$/.test(manifest.baselineCommit) ||
    !Array.isArray(manifest.sourceFiles)
  ) {
    throw new Error(
      'Rollback artifact provenance is missing or claims an approved deployment identity.',
    );
  }
  const source = path.join(artifact, 'source');
  const generated = (filename) =>
    [
      'node_modules',
      'apps/api/node_modules',
      'apps/web/node_modules',
      'apps/marketing/node_modules',
      'packages/i18n/node_modules',
      'packages/interview-contract/node_modules',
    ].some((directory) => filename === directory || filename.startsWith(`${directory}/`)) ||
    /^(apps\/api\/dist|apps\/web\/\.next)(\/|$)/.test(filename) ||
    [
      'apps/web/next-env.d.ts',
      'apps/web/tsconfig.tsbuildinfo',
      'apps/web/public/.well-known/careiq-release.json',
    ].includes(filename);
  const actual = artifactFiles(source, '', generated);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.sourceFiles)) {
    throw new Error('Rollback source inventory has unrecorded additions, removals or edits.');
  }
  for (const entry of manifest.sourceFiles) {
    safeArtifactPath(entry.path);
    const filename = path.join(source, entry.path);
    if (sha256(readRegularFile(filename)) !== entry.sha256) {
      throw new Error(`Rollback source changed after preparation: ${entry.path}`);
    }
  }
  const identity = sourceIdentity(manifest.sourceFiles);
  if (
    identity.sha256 !== manifest.sourceDigest ||
    identity.localRevision !== manifest.localRevision
  ) {
    throw new Error('Rollback source identity does not match its exact file inventory.');
  }
  return manifest;
}

export function overlayDependencies(source, overlay, baselineFiles) {
  const pending = overlay
    .filter((entry) => /\.[cm]?[jt]sx?$/.test(entry.path))
    .map((entry) => entry.path);
  const visited = new Set();
  const dependencies = [];
  while (pending.length) {
    const filename = pending.pop();
    if (visited.has(filename)) {
      continue;
    }
    visited.add(filename);
    const imports = typescript.preProcessFile(
      readRegularFile(path.join(source, filename), 'utf8'),
      true,
      true,
    ).importedFiles;
    for (const { fileName: specifier } of imports) {
      let target;
      if (specifier.startsWith('.')) {
        target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
      } else if (specifier.startsWith('@/') && filename.startsWith('apps/web/')) {
        target = `apps/web/src/${specifier.slice(2)}`;
      } else {
        continue;
      }
      safeArtifactPath(target);
      const candidates = [
        target,
        target.replace(/\.js$/, '.ts'),
        target.replace(/\.js$/, '.tsx'),
        `${target}.ts`,
        `${target}.tsx`,
        `${target}.js`,
        `${target}/index.ts`,
        `${target}/index.tsx`,
        `${target}/index.js`,
      ];
      const resolved = candidates.find((candidate) => {
        try {
          readRegularFile(path.join(source, candidate));
          return true;
        } catch (error) {
          if (
            ['ENOENT', 'EISDIR'].includes(error.code) ||
            error.message === 'Rollback inputs must be regular files.'
          ) {
            return false;
          }
          throw error;
        }
      });
      if (!resolved) {
        throw new Error(
          `Rollback overlay needs an explicit dependency: ${filename} -> ${specifier}`,
        );
      }
      const digest = sha256(readRegularFile(path.join(source, resolved)));
      if (
        baselineFiles.get(resolved) !== digest &&
        !overlay.some((entry) => entry.path === resolved)
      ) {
        throw new Error(`Unlisted rollback dependency change: ${resolved}`);
      }
      dependencies.push({
        from: filename,
        specifier,
        path: resolved,
        sha256: digest,
        origin: baselineFiles.get(resolved) === digest ? 'baseline' : 'explicit-overlay',
      });
      if (/\.[cm]?[jt]sx?$/.test(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return dependencies.sort((a, b) => `${a.from}:${a.path}`.localeCompare(`${b.from}:${b.path}`));
}

export function rollbackBuildFiles(artifact) {
  const source = path.join(artifact, 'source');
  return ['apps/api/dist', 'apps/web/.next']
    .flatMap((folder) => {
      return artifactFiles(source, folder, (name) => name.startsWith('apps/web/.next/cache/'));
    })
    .concat(
      (() => {
        const metadata = 'apps/web/public/.well-known/careiq-release.json';
        try {
          return [{ path: metadata, sha256: sha256(readRegularFile(path.join(source, metadata))) }];
        } catch (error) {
          if (error.code === 'ENOENT') {
            return [];
          }
          throw error;
        }
      })(),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function recordRollbackBuild(artifact) {
  const provenance = assertArtifactProvenance(artifact);
  const outputs = rollbackBuildFiles(artifact);
  const build = {
    version: 1,
    sourceDigest: provenance.sourceDigest,
    outputs,
    buildDigest: sha256(JSON.stringify(outputs)),
    node: process.version,
    dependencyLock: sha256(readRegularFile(path.join(artifact, 'source/pnpm-lock.yaml'))),
    deployable: false,
  };
  writeFileSync(path.join(artifact, 'rollback-build.json'), `${JSON.stringify(build, null, 2)}\n`);
  return build;
}

export function assertRollbackBuild(artifact) {
  const provenance = assertArtifactProvenance(artifact);
  const build = JSON.parse(readRegularFile(path.join(artifact, 'rollback-build.json'), 'utf8'));
  const actual = rollbackBuildFiles(artifact);
  if (
    build.version !== 1 ||
    build.deployable !== false ||
    build.sourceDigest !== provenance.sourceDigest ||
    build.dependencyLock !==
      sha256(readRegularFile(path.join(artifact, 'source/pnpm-lock.yaml'))) ||
    JSON.stringify(actual) !== JSON.stringify(build.outputs) ||
    sha256(JSON.stringify(actual)) !== build.buildDigest
  ) {
    throw new Error('Rollback build outputs changed or are detached from their source provenance.');
  }
  return build;
}

/** No network, checkout switch or Git object mutation: archive a real local baseline and enumerate every overlay. */
export function prepareRollback({
  baseline = rollbackBaseline,
  securityManifest,
  root = repositoryRoot,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(baseline)) {
    throw new Error('Provide a full immutable local baseline commit.');
  }
  runLocal('git', ['cat-file', '-e', `${baseline}^{commit}`], { cwd: root });
  runLocal('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: root });
  const tree = runLocal('git', ['ls-tree', '-r', baseline], { cwd: root });
  if (tree.split('\n').some((line) => line.startsWith('120000 ') || line.startsWith('160000 '))) {
    throw new Error('Rollback archive cannot contain symlinks or submodules.');
  }
  const security = securityManifest
    ? validateSecurityOverlay(JSON.parse(readRegularFile(securityManifest, 'utf8')))
    : [];
  const output = path.join(root, '.tmp', 'rollback', randomUUID());
  const source = path.join(output, 'source');
  mkdirSync(source, { recursive: true });
  const archive = path.join(output, 'baseline.tar');
  try {
    runLocal('git', ['archive', '--format=tar', `--output=${archive}`, baseline], { cwd: root });
    runLocal('tar', ['-xf', archive, '-C', source]);
    const original = new Map(artifactFiles(source).map((entry) => [entry.path, entry.sha256]));
    const baselineJournal = JSON.parse(
      readRegularFile(path.join(source, 'apps/api/drizzle/meta/_journal.json'), 'utf8'),
    );
    const overlay = [
      ...compatibilityOverlay.map((filename) => ({
        path: filename,
        reason: 'Migration 50 compatibility and unchanged strict database boundaries.',
        category: 'database-compatibility',
      })),
      ...security.map((entry) => ({
        ...entry,
        category: entry.category ?? 'reviewed-security-fix',
      })),
    ].map((entry) => {
      const current = path.join(root, safeArtifactPath(entry.path));
      const content = readRegularFile(current);
      const digest = sha256(content);
      if (entry.sha256 && digest !== entry.sha256) {
        throw new Error(`Security overlay changed after review: ${entry.path}`);
      }
      const destination = path.join(source, entry.path);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
      return { ...entry, sha256: digest, baselineSha256: original.get(entry.path) ?? null };
    });
    assertJournalCompatibility(source, original, baselineJournal);
    const files = artifactFiles(source);
    const identity = sourceIdentity(files);
    const manifest = {
      version: 1,
      kind: 'local-rollback-overlay',
      deployable: false,
      revisionIsGitCommit: false,
      baselineCommit: baseline,
      baselineTree: runLocal('git', ['rev-parse', `${baseline}^{tree}`], { cwd: root }),
      sourceDigest: identity.sha256,
      localRevision: identity.localRevision,
      localRevisionPurpose:
        'Synthetic loopback production-fixture identity only; never an approved Git deployment revision.',
      preparedAt: new Date().toISOString(),
      compatibilityOnly: security.length === 0,
      securityOverlayComplete: false,
      overlay,
      sourceFiles: files,
      dependencyClosure: overlayDependencies(source, overlay, original),
    };
    writeFileSync(
      path.join(output, 'rollback-provenance.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    assertArtifactProvenance(output);
    return output;
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(archive, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    while (args.length) {
      const flag = args.shift();
      const value = args.shift();
      if (!value || !['--baseline', '--security-overlay'].includes(flag)) {
        throw new Error(
          'Usage: prepare-rollback.mjs [--baseline <full-local-sha>] [--security-overlay <reviewed-files.json>]',
        );
      }
      options[flag === '--baseline' ? 'baseline' : 'securityManifest'] = value;
    }
    console.log(prepareRollback(options));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
