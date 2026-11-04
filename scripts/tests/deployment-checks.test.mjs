import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeploymentChecks,
  deploymentBuildGuard,
  requiredChecks,
  verifyDeploymentChecks,
} from '../verify-deployment-checks.mjs';
const revision = 'a'.repeat(40);
const checks = () =>
  requiredChecks.map((name, id) => ({
    id: id + 1,
    name,
    head_sha: revision,
    app: { slug: 'github-actions' },
    status: 'completed',
    conclusion: 'success',
  }));

test('only all required successful checks on the exact commit authorize deployment', () => {
  assert.doesNotThrow(() => assertDeploymentChecks(revision, checks()));
  for (const conclusion of ['failure', 'skipped', 'neutral', 'cancelled', null]) {
    const report = checks();
    report[0].conclusion = conclusion;
    assert.throws(() => assertDeploymentChecks(revision, report), /lacks a successful/);
  }
  for (const change of [
    { head_sha: 'b'.repeat(40) },
    { status: 'in_progress' },
    { app: { slug: 'other-app' } },
  ]) {
    const report = checks();
    Object.assign(report[0], change);
    assert.throws(() => assertDeploymentChecks(revision, report), /lacks a successful/);
  }
  assert.throws(() => assertDeploymentChecks(revision, checks().slice(1)), /verify/);
  assert.throws(() => assertDeploymentChecks('main', checks()), /full commit/);
});

test('a newer failed rerun cannot be hidden by an earlier success', () => {
  const report = checks();
  report.push({ ...report[0], id: 999, conclusion: 'failure' });
  assert.throws(() => assertDeploymentChecks(revision, report), /verify/);
});

test('GitHub pagination is complete, bounded, exact-SHA and fail closed', async () => {
  const report = checks();
  let page = 0;
  const result = await verifyDeploymentChecks(revision, {
    fetcher: async (url, options) => {
      assert.ok(
        url.startsWith(
          `https://api.github.com/repos/kriscodes/careiq/commits/${revision}/check-runs?`,
        ),
      );
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({
        total_count: report.length,
        check_runs: page++ === 0 ? report.slice(0, 3) : report.slice(3),
      });
    },
  });
  assert.equal(page, 2);
  assert.equal(result.revision, revision);
  await assert.rejects(
    verifyDeploymentChecks(revision, { fetcher: async () => new Response(null, { status: 403 }) }),
    /HTTP 403/,
  );
  await assert.rejects(
    verifyDeploymentChecks(revision, {
      fetcher: async () => Response.json({ total_count: 8, check_runs: [] }),
    }),
    /pagination/,
  );
  await assert.rejects(
    verifyDeploymentChecks(revision, { fetcher: async () => Response.json({ check_runs: [] }) }),
    /invalid/,
  );
});

test('Render builds always verify their revision; ordinary CI builds do not wait on themselves', async () => {
  assert.equal((await deploymentBuildGuard({})).skipped, true);
  await assert.rejects(deploymentBuildGuard({ RENDER: 'true' }), /full commit/);
  let called = false;
  await deploymentBuildGuard(
    { RENDER_GIT_COMMIT: revision },
    {
      fetcher: async () => {
        called = true;
        return Response.json({ total_count: 7, check_runs: checks() });
      },
    },
  );
  assert.equal(called, true);
});
