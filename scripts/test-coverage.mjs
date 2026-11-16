import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireCoverageDatabase, validateCoveragePolicy } from './coverage-policy.mjs';
import { coverageSourceDigest, writeCoverageProvenance } from './changed-coverage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = JSON.parse(readFileSync(path.join(root, 'coverage-policy.json'), 'utf8'));
validateCoveragePolicy(policy);
requireCoverageDatabase();
const initialSourceDigest = coverageSourceDigest(root);

for (const target of policy.targets) {
  const directory = path.join(root, target.directory);
  const reports = path.join(root, 'coverage', target.name);
  mkdirSync(reports, { recursive: true });
  const testFiles = readdirSync(path.join(directory, 'tests'))
    .filter((filename) => filename.endsWith(`.test${target.testExtension}`))
    .sort()
    .map((filename) => path.join('tests', filename));
  if (testFiles.length === 0) {
    throw new Error(`No tests found for ${target.name}.`);
  }

  const args = [
    path.join(root, 'node_modules/c8/bin/c8.js'),
    '--all',
    '--src=.',
    '--exclude-after-remap',
    '--exclude=**/*.d.ts',
    '--exclude=**/tests/**',
    '--exclude=dist/**',
    '--extension=.ts',
    '--extension=.tsx',
    '--extension=.js',
    '--reporter=text-summary',
    '--reporter=json-summary',
    '--reporter=lcov',
    '--reporter=html',
    `--reports-dir=${reports}`,
    `--temp-directory=${path.join(reports, 'tmp')}`,
    '--check-coverage',
    ...target.include.map((pattern) => `--include=${pattern}`),
    ...Object.entries(target.thresholds).map(([metric, minimum]) => `--${metric}=${minimum}`),
    process.execPath,
    ...(target.loader ? ['--import', pathToFileURL(path.join(root, target.loader)).href] : []),
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${pathToFileURL(path.join(root, 'scripts/coverage-test-reporter.mjs')).href}`,
    `--test-reporter-destination=${path.join(reports, 'tests.json')}`,
    ...testFiles,
  ];
  console.log(`\nCoverage: ${target.name} (all source files, including untested files)`);
  const result = spawnSync(process.execPath, args, {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  requireCoveredSources(reports, target.name);
  for (const scope of target.scopes ?? []) {
    const scopedReports = path.join(reports, scope.name);
    console.log(`Coverage requirement: ${target.name}/${scope.name}`);
    const checked = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules/c8/bin/c8.js'),
        'report',
        '--all',
        '--src=.',
        '--exclude-after-remap',
        '--exclude=**/*.d.ts',
        '--exclude=**/tests/**',
        '--exclude=dist/**',
        '--extension=.ts',
        '--extension=.tsx',
        '--extension=.js',
        '--reporter=text-summary',
        '--reporter=json-summary',
        '--check-coverage',
        `--reports-dir=${scopedReports}`,
        `--temp-directory=${path.join(reports, 'tmp')}`,
        ...scope.include.map((pattern) => `--include=${pattern}`),
        ...Object.entries(scope.thresholds).map(([metric, minimum]) => `--${metric}=${minimum}`),
      ],
      { cwd: directory, stdio: 'inherit' },
    );
    if (checked.error) {
      throw checked.error;
    }
    if (checked.status !== 0) {
      process.exit(checked.status || 1);
    }
    requireCoveredSources(scopedReports, `${target.name}/${scope.name}`);
  }
}

writeCoverageProvenance(root, initialSourceDigest);

function requireCoveredSources(directory, name) {
  const summary = JSON.parse(readFileSync(path.join(directory, 'coverage-summary.json'), 'utf8'));
  if (!Number.isFinite(summary.total?.lines?.total) || summary.total.lines.total === 0) {
    throw new Error(`No source files were included in coverage for ${name}.`);
  }
}
