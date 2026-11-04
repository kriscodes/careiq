import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const serviceNames = ['api', 'web', 'marketing'];
export function validateReleaseManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !manifest.services ||
    Object.keys(manifest.services).sort().join(',') !== [...serviceNames].sort().join(',')
  ) {
    throw new Error('A release manifest must explicitly identify api, web and marketing.');
  }
  for (const name of serviceNames) {
    const service = manifest.services[name];
    let url;
    try {
      url = new URL(service.url);
    } catch {
      throw new Error(`Invalid ${name} URL.`);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(`${name} must use an HTTPS origin (HTTP is allowed only on loopback).`);
    }
    if (!/^[a-f0-9]{40}$/.test(service.revision)) {
      throw new Error(`Provide the full expected ${name} commit SHA.`);
    }
  }
  if (manifest.services.api.revision !== manifest.services.web.revision) {
    throw new Error(
      'API and web must be promoted from the same tested commit. Marketing has its own revision.',
    );
  }
  return manifest;
}

export function validateRollbackManifests(current, previous) {
  validateReleaseManifest(current);
  validateReleaseManifest(previous);
  let changed = false;
  for (const name of serviceNames) {
    if (
      new URL(current.services[name].url).origin !== new URL(previous.services[name].url).origin
    ) {
      throw new Error('Rollback verification must inspect the same service origins.');
    }
    changed ||= current.services[name].revision !== previous.services[name].revision;
  }
  if (!changed) {
    throw new Error('Rollback target must differ from the candidate release.');
  }
}

async function smallJson(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Expected a JSON response.');
  }
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 16384) {
        throw new Error('Release response exceeds the public metadata limit.');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

class ReleaseCheckError extends Error {}

function requireCondition(condition, name) {
  if (!condition) {
    throw new ReleaseCheckError(name);
  }
}

export async function verifyRelease(manifest, options = {}) {
  validateReleaseManifest(manifest);
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 5 ||
    !Number.isInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 10000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10000
  ) {
    throw new Error('Invalid bounded smoke-check timing configuration.');
  }
  let lastFailure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const checks = [];
    try {
      for (const name of serviceNames) {
        const service = manifest.services[name];
        const request = async (route) => {
          const url = new URL(route, service.url);
          url.searchParams.set('careiq_release_check', `${Date.now()}-${attempt}`);
          const response = await fetcher(url, {
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              Accept:
                route === '/health' || route.includes('.json') || route.startsWith('/api/')
                  ? 'application/json'
                  : 'text/html',
            },
          });
          return response;
        };
        const metadataRoute = name === 'api' ? '/health' : '/.well-known/careiq-release.json';
        const metadataResponse = await request(metadataRoute);
        requireCondition(
          metadataResponse.status === 200,
          `${name}: release metadata is unavailable.`,
        );
        requireCondition(
          metadataResponse.headers.get('content-type')?.includes('application/json'),
          `${name}: expected JSON metadata.`,
        );
        const metadata = await smallJson(metadataResponse);
        requireCondition(
          metadata.service === `careiq-${name}` && metadata.revision === service.revision,
          `${name}: deployed revision does not match the approved commit.`,
        );
        if (name === 'api') {
          requireCondition(
            metadata.status === 'ok' && metadata.database === 'connected',
            'api: database health failed.',
          );
          requireCondition(
            metadataResponse.headers.get('cache-control')?.includes('no-store'),
            'api: health response must not be cached.',
          );
          const denied = await request('/api/v1/me');
          requireCondition(
            denied.status === 401 && denied.headers.get('cache-control')?.includes('no-store'),
            'api: unsigned account request was not safely denied.',
          );
          const body = await smallJson(denied);
          requireCondition(
            body.error?.code === 'UNAUTHENTICATED',
            'api: unsigned denial contract changed.',
          );
          checks.push({ service: name, check: 'database-and-unsigned-denial', passed: true });
        } else {
          for (const route of name === 'web' ? ['/', '/sign-in', '/sign-up'] : ['/', '/privacy/']) {
            const response = await request(route);
            try {
              requireCondition(
                response.status === 200 &&
                  response.headers.get('content-type')?.includes('text/html'),
                `${name}: public page unavailable.`,
              );
              requireCondition(
                response.headers.get('x-content-type-options') === 'nosniff' &&
                  response.headers.get('x-frame-options') === 'DENY',
                `${name}: security headers are missing.`,
              );
              if (name === 'web') {
                requireCondition(
                  response.headers
                    .get('content-security-policy')
                    ?.includes("frame-ancestors 'none'") &&
                    response.headers.get('referrer-policy') === 'no-referrer' &&
                    response.headers.get('x-robots-tag')?.includes('noindex'),
                  'web: document protection headers are missing.',
                );
              }
              checks.push({ service: name, check: route, passed: true });
            } finally {
              await response.body?.cancel();
            }
          }
          if (name === 'web') {
            const preview = await request('/design-preview');
            try {
              requireCondition(
                preview.status === 404,
                'web: production preview route was exposed.',
              );
            } finally {
              await preview.body?.cancel();
            }
            checks.push({ service: name, check: 'preview-denied', passed: true });
          }
        }
        checks.push({ service: name, check: 'revision', revision: service.revision, passed: true });
      }
      return { version: 1, verifiedAt: new Date().toISOString(), attempt, checks };
    } catch (error) {
      // Do not print response bodies, cookies, provider messages, or arbitrary fetch errors.
      lastFailure =
        error instanceof ReleaseCheckError
          ? error.message
          : 'Public release verification request failed.';
      if (attempt < attempts) {
        await delay(retryDelayMs);
      }
    }
  }
  throw new Error(`Release verification failed after ${attempts} attempts: ${lastFailure}`);
}

async function main(args) {
  const rollback = args[0] === '--rollback';
  if ((!rollback && args.length !== 1) || (rollback && args.length !== 3)) {
    throw new Error(
      'Usage: release-smoke.mjs manifest.json OR release-smoke.mjs --rollback current.json previous.json',
    );
  }
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const target = read(args.at(-1));
  if (rollback) {
    validateRollbackManifests(read(args[1]), target);
  }
  const result = await verifyRelease(target);
  console.log(
    JSON.stringify(
      {
        ...result,
        mode: rollback ? 'post-rollback-verification' : 'post-deployment-smoke',
        databaseRollbackPerformed: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
