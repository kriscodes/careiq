import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 1024 * 1024;

/** Existing evidence may shrink, but its per-path allowance must not grow. */
export function repositoryViolations(files, baseline = {}) {
  for (const [filePath, bytes] of Object.entries(baseline)) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Invalid repository size allowance: ${filePath}`);
    }
  }
  return files.flatMap(({ path: filePath, bytes }) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Invalid file size: ${filePath}`);
    }
    const isLog = /\.log$/i.test(filePath);
    if (!isLog && bytes <= MAX_FILE_BYTES) {
      return [];
    }
    const allowance = Object.hasOwn(baseline, filePath) ? baseline[filePath] : undefined;
    if (allowance !== undefined && bytes <= allowance) {
      return [];
    }
    const reason =
      allowance !== undefined
        ? `exceeds its existing ${allowance}-byte allowance`
        : isLog
          ? 'new tracked logs are not allowed'
          : 'exceeds the 1 MiB file limit';
    return [`${filePath}: ${reason} (${bytes} bytes)`];
  });
}

function checkRepository() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baseline = JSON.parse(
    readFileSync(path.join(root, 'repository-size-baseline.json'), 'utf8'),
  );
  if (
    baseline.version !== 1 ||
    !baseline.files ||
    Array.isArray(baseline.files) ||
    typeof baseline.files !== 'object'
  ) {
    throw new Error('Invalid repository-size-baseline.json');
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  const files = tracked
    .split('\0')
    .filter(Boolean)
    .flatMap((filePath) => {
      try {
        return [{ path: filePath, bytes: lstatSync(path.join(root, filePath)).size }];
      } catch (error) {
        // Deletions are allowed before the deletion has been staged.
        if (error.code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    });
  const violations = repositoryViolations(files, baseline.files);
  if (violations.length) {
    console.error(violations.join('\n'));
    console.error(
      'Store new logs and large verification artifacts in CI artifacts instead of Git.',
    );
    process.exitCode = 1;
  } else {
    console.log(`Repository hygiene passed for ${files.length} tracked files.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkRepository();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
