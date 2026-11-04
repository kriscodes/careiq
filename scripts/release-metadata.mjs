import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildRevision(environment = process.env) {
  const values = [
    environment.RENDER_GIT_COMMIT,
    environment.GITHUB_SHA,
    environment.CAREIQ_BUILD_REVISION,
  ].filter((value) => value !== undefined);
  if (
    !values.length ||
    values.some((value) => !/^[a-f0-9]{40}$/.test(value)) ||
    new Set(values).size !== 1
  ) {
    throw new Error(
      'Set one consistent full Git SHA through RENDER_GIT_COMMIT, GITHUB_SHA, or CAREIQ_BUILD_REVISION.',
    );
  }
  return values[0];
}

export function writeReleaseMetadata(
  service,
  environment = process.env,
  root = fileURLToPath(new URL('../', import.meta.url)),
) {
  if (!['web', 'marketing'].includes(service)) {
    throw new Error('Release metadata service must be web or marketing.');
  }
  const metadata = { service: `careiq-${service}`, revision: buildRevision(environment) };
  const directory = path.join(root, 'apps', service, 'public', '.well-known');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'careiq-release.json'), `${JSON.stringify(metadata)}\n`);
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const services = process.argv.slice(2);
    if (!services.length) {
      throw new Error('Provide web and/or marketing.');
    }
    for (const service of services) {
      const metadata = writeReleaseMetadata(service);
      console.log(`${metadata.service} release metadata: ${metadata.revision}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
