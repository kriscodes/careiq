/** Release coverage always includes the database-backed API tests. */
export function requireCoverageDatabase(environment = process.env) {
  let databaseUrl;
  try {
    databaseUrl = new URL(environment.TEST_DATABASE_URL || '');
  } catch {
    throw new Error(
      'Coverage requires TEST_DATABASE_URL for an isolated loopback careiq_test database.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== '/careiq_test' ||
    databaseUrl.search ||
    databaseUrl.hash
  ) {
    throw new Error(
      'Coverage requires an isolated loopback careiq_test database without URL overrides.',
    );
  }
}

const expectedTargets = new Map([
  ['api', 'apps/api'],
  ['web', 'apps/web'],
  ['marketing', 'apps/marketing'],
  ['i18n', 'packages/i18n'],
  ['interview-contract', 'packages/interview-contract'],
]);
const metrics = ['lines', 'statements', 'functions', 'branches'];

function validateThresholds(thresholds) {
  if (
    !thresholds ||
    Object.keys(thresholds).length !== metrics.length ||
    metrics.some(
      (metric) =>
        !Number.isFinite(thresholds[metric]) || thresholds[metric] <= 0 || thresholds[metric] > 100,
    )
  ) {
    throw new Error(
      'Every coverage metric must have an explicit threshold greater than zero and at most 100.',
    );
  }
}

/** Missing workspaces or misspelled metrics must never silently turn off a gate. */
export function validateCoveragePolicy(policy) {
  if (!Array.isArray(policy?.targets) || policy.targets.length !== expectedTargets.size) {
    throw new Error('Coverage policy must include every tested workspace.');
  }
  const names = new Set();
  for (const target of policy.targets) {
    if (expectedTargets.get(target.name) !== target.directory || names.has(target.name)) {
      throw new Error('Coverage policy has an unknown or duplicate workspace.');
    }
    names.add(target.name);
    if (
      !Array.isArray(target.include) ||
      target.include.length === 0 ||
      target.include.some((pattern) => typeof pattern !== 'string' || !pattern)
    ) {
      throw new Error('Coverage source inclusion patterns are required.');
    }
    validateThresholds(target.thresholds);
    if (target.scopes !== undefined && !Array.isArray(target.scopes)) {
      throw new Error('Coverage scopes must be an array.');
    }
    for (const scope of target.scopes ?? []) {
      if (
        !/^[a-z][a-z0-9-]+$/.test(scope.name) ||
        !Array.isArray(scope.include) ||
        scope.include.length === 0 ||
        scope.include.some((pattern) => typeof pattern !== 'string' || !pattern)
      ) {
        throw new Error('Coverage scopes require a name and source inclusion patterns.');
      }
      validateThresholds(scope.thresholds);
    }
  }
}
