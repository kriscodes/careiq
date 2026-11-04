import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function scanSecrets(binary, root = fileURLToPath(new URL('../', import.meta.url))) {
  const configuration = path.join(root, '.gitleaks.toml');
  const reports = mkdtempSync(path.join(tmpdir(), 'careiq-secret-reports-'));
  const run = (args, directory = root) => {
    const report = path.join(reports, 'findings.json');
    const result = spawnSync(
      binary,
      [...args, '--report-format', 'json', '--report-path', report],
      { cwd: directory, encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) {
      try {
        const findings = JSON.parse(readFileSync(report, 'utf8'));
        for (const finding of findings) {
          console.error(
            JSON.stringify({ rule: finding.RuleID, path: finding.File, line: finding.StartLine }),
          );
        }
      } catch {
        /* Scanner setup failures remain a hard failure without raw diagnostics. */
      }
      throw new Error(
        'Secret scanning failed; resolve the reported finding locations before release.',
      );
    }
  };
  const flags = ['--redact=100', '--no-banner', '--config', configuration];
  try {
    run(['git', ...flags, '--log-opts=--all']);
  } catch (error) {
    rmSync(reports, { recursive: true, force: true });
    throw error;
  }
  // Scan the candidate working tree as well as history, while preserving Git ignores.
  // This includes uncommitted source but never copies ignored local credentials or builds.
  const staging = mkdtempSync(path.join(tmpdir(), 'careiq-secret-scan-'));
  try {
    const paths = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    for (const relative of new Set(paths)) {
      const source = path.join(root, relative);
      let stat;
      try {
        stat = lstatSync(source);
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      if (!stat.isFile()) {
        continue;
      }
      const target = path.join(staging, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    run(['dir', ...flags, '.'], staging);
    console.log('Secret scan passed for available Git history and the current source tree.');
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Provide the checksum-verified Gitleaks executable.');
    }
    scanSecrets(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
