import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const binary = process.argv[2];
if (!binary) {
  throw new Error('Provide the checksum-verified Gitleaks executable.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), 'careiq-secret-negative-'));
try {
  mkdirSync(path.join(directory, 'docs'));
  const file = path.join(directory, 'docs', 'marketing.md');
  const flags = [
    'dir',
    '--redact=100',
    '--no-banner',
    '--config',
    path.join(root, '.gitleaks.toml'),
    '.',
  ];
  writeFileSync(file, 'No credential material.');
  assert.equal(spawnSync(binary, flags, { encoding: 'utf8', cwd: directory }).status, 0);
  // Random synthetic bytes cannot authenticate an account. Construct the recognizable
  // prefix at runtime so the regression source does not itself contain a token.
  writeFileSync(file, `const apiToken = "${'gh' + 'p_'}${randomBytes(18).toString('hex')}";`);
  const detected = spawnSync(binary, flags, { encoding: 'utf8', cwd: directory });
  assert.equal(
    detected.status,
    1,
    'Scanner must reject an unfamiliar secret even inside a path with a reviewed exception.',
  );
  console.log('Secret scanner negative fixture passed (values redacted).');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
