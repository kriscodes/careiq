import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseManifest, validateRollbackManifests } from './release-smoke.mjs';

export function productionManifest(applicationRevision, marketingRevision) {
  return validateReleaseManifest({
    version: 1,
    services: {
      api: { url: 'https://careiq-api-7ssz.onrender.com', revision: applicationRevision },
      web: { url: 'https://app.careiqlabs.com', revision: applicationRevision },
      marketing: { url: 'https://careiqlabs.com', revision: marketingRevision },
    },
  });
}

export function manifestsForEvent(eventName, event, environment) {
  const automatic = eventName === 'deployment_status';
  if (
    automatic &&
    (event.deployment_status?.state !== 'success' ||
      !environment.DEPLOYMENT_ENVIRONMENT ||
      event.deployment?.environment !== environment.DEPLOYMENT_ENVIRONMENT)
  ) {
    throw new Error(
      'Only an explicitly mapped successful deployment can trigger automatic smoke checks.',
    );
  }
  if (!automatic && eventName !== 'workflow_dispatch') {
    throw new Error('Unsupported release verification trigger.');
  }
  const current = productionManifest(
    automatic ? event.deployment.sha : environment.APPLICATION_SHA,
    environment.MARKETING_SHA,
  );
  const rollback = !automatic && environment.VERIFICATION_MODE === 'rollback';
  const previous = rollback
    ? productionManifest(environment.PREVIOUS_APPLICATION_SHA, environment.PREVIOUS_MARKETING_SHA)
    : null;
  if (previous) {
    validateRollbackManifests(current, previous);
  }
  return { current, previous };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.RUNNER_TEMP || !process.env.GITHUB_EVENT_PATH) {
      throw new Error('Workflow event and temporary directory are required.');
    }
    const result = manifestsForEvent(
      process.env.GITHUB_EVENT_NAME,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      process.env,
    );
    writeFileSync(
      path.join(process.env.RUNNER_TEMP, 'careiq-current-release.json'),
      JSON.stringify(result.current),
    );
    if (result.previous) {
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, 'careiq-previous-release.json'),
        JSON.stringify(result.previous),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
