import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredChecks = Object.freeze([
  'verify',
  'quality',
  'dependency-audit',
  'managed-owner',
  'release-gate',
  'codeql',
  'secret-scan',
]);

export function assertDeploymentChecks(revision, checks) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Deployment requires an exact full commit SHA.');
  }
  for (const name of requiredChecks) {
    const matching = checks.filter(
      (check) => check.name === name && check.app?.slug === 'github-actions',
    );
    // A rerun replaces an older result. A stale success cannot authorize a newer failure.
    const latest = matching.sort((left, right) => right.id - left.id)[0];
    if (
      !latest ||
      latest.head_sha !== revision ||
      latest.status !== 'completed' ||
      latest.conclusion !== 'success'
    ) {
      throw new Error(`Exact deployed commit lacks a successful GitHub Actions check: ${name}`);
    }
  }
}

export async function verifyDeploymentChecks(revision, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Deployment requires an exact full commit SHA.');
  }
  const fetcher = options.fetcher ?? fetch;
  const checks = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.github.com/repos/kriscodes/careiq/commits/${revision}/check-runs?filter=latest&per_page=100&page=${page}`;
    const response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Cannot verify deployed commit checks (GitHub HTTP ${response.status}).`);
    }
    const report = await response.json();
    if (
      !Array.isArray(report.check_runs) ||
      !Number.isInteger(report.total_count) ||
      report.total_count < 0 ||
      report.check_runs.some((check) => !Number.isSafeInteger(check.id))
    ) {
      throw new Error('GitHub returned an invalid check report.');
    }
    checks.push(...report.check_runs);
    if (checks.length >= report.total_count) {
      assertDeploymentChecks(revision, checks);
      return { revision, checks: [...requiredChecks] };
    }
    if (!report.check_runs.length) {
      throw new Error('GitHub check pagination ended before all results were received.');
    }
  }
  throw new Error('GitHub check report exceeds the bounded pagination limit.');
}

export async function deploymentBuildGuard(environment = process.env, options = {}) {
  if (!environment.RENDER && !environment.RENDER_GIT_COMMIT) {
    return { skipped: true, reason: 'Not a Render build; CI runs the checks itself.' };
  }
  return verifyDeploymentChecks(environment.RENDER_GIT_COMMIT, {
    ...options,
    token: environment.GITHUB_TOKEN,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result =
      args.length === 1 && args[0] === '--render-build'
        ? await deploymentBuildGuard()
        : args.length === 1
          ? await verifyDeploymentChecks(args[0], { token: process.env.GITHUB_TOKEN })
          : (() => {
              throw new Error('Usage: verify-deployment-checks.mjs <full-sha> OR --render-build');
            })();
    console.log(JSON.stringify(result));
  } catch (error) {
    // Never include headers, response bodies or arbitrary network diagnostics.
    console.error(
      error.message.startsWith('GitHub') ||
        error.message.startsWith('Exact') ||
        error.message.startsWith('Deployment') ||
        error.message.startsWith('Cannot verify') ||
        error.message.startsWith('Usage:')
        ? error.message
        : 'Deployment check verification failed.',
    );
    process.exitCode = 1;
  }
}
