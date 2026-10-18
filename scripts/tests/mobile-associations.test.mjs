import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAssociations, parseArguments, run, validateMetadata } from '../generate-mobile-associations.mjs';

// Synthetic unit fixtures only; no test writes deployment metadata to the app public directory.
const fingerprints = ['certificate fixture one', 'certificate fixture two'].map(value => createHash('sha256').update(value).digest('hex'));
const metadata = { appleTeamId: 'A1B2C3D4E5', iosBundleId: 'com.careiqfixture.mobile', androidPackage: 'com.careiqfixture.mobile', linkHost: 'links.careiqfixture.com', fingerprints };
const environment = {
  MOBILE_APPLE_TEAM_ID: metadata.appleTeamId, MOBILE_IOS_BUNDLE_ID: metadata.iosBundleId,
  MOBILE_ANDROID_PACKAGE: metadata.androidPackage, MOBILE_LINK_HOST: metadata.linkHost,
  MOBILE_ANDROID_CERT_SHA256: fingerprints.join(','),
};
const script = fileURLToPath(new URL('../generate-mobile-associations.mjs', import.meta.url));
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'careiq-associations-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('every platform and domain metadata field is required before output is created', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, 'missing');
  for (const field of Object.keys(environment)) {
    const partial = { ...environment }; delete partial[field];
    await assert.rejects(run(['--output-dir', output], partial), /metadata is incomplete or invalid/);
    assert.equal(existsSync(output), false);
  }
});
test('malformed IDs, hosts, partial certificate hashes and obvious placeholders fail closed', () => {
  for (const changes of [
    { appleTeamId: 'short' }, { appleTeamId: 'YOURTEAMID' }, { appleTeamId: 'a1b2c3d4e5' },
    { iosBundleId: 'com.example.mobile' }, { iosBundleId: 'dev.careiq.mobile' }, { iosBundleId: 'com.app.*' },
    { androidPackage: 'com.app-with-dash.mobile' }, { androidPackage: 'not-a-package' },
    { linkHost: 'https://links.careiqfixture.com/join' }, { linkHost: '*.careiqfixture.com' },
    { linkHost: 'localhost' }, { linkHost: '127.0.0.1' }, { linkHost: 'example.com' }, { linkHost: 'links.careiqfixture.com:443' },
    { fingerprints: [] }, { fingerprints: [fingerprints[0].slice(0, 62)] }, { fingerprints: ['00'.repeat(32)] },
    { fingerprints: [fingerprints[0], 'invalid-rotation-fingerprint'] },
  ]) assert.throws(() => validateMetadata({ ...metadata, ...changes }), /metadata is incomplete or invalid/);
});
test('AASA matches exactly /join and /patient-workflow and Android signing rotations are normalized and retained', () => {
  const colon = fingerprints[0].toUpperCase().match(/.{2}/g).join(':');
  const files = createAssociations({ ...metadata, fingerprints: [fingerprints[0], colon, fingerprints[1]] });
  assert.deepEqual(files['apple-app-site-association'], {
    applinks: { details: [{ appIDs: ['A1B2C3D4E5.com.careiqfixture.mobile'], components: [{ '/': '/join' }, { '/': '/patient-workflow' }] }] },
  });
  const target = files['assetlinks.json'][0].target;
  assert.equal(target.namespace, 'android_app');
  assert.equal(target.package_name, metadata.androidPackage);
  assert.equal(target.sha256_cert_fingerprints.length, 2);
  assert.ok(target.sha256_cert_fingerprints.includes(colon));
  assert.ok(target.sha256_cert_fingerprints.every(value => /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value)));
});
test('check mode validates complete metadata without creating or reading the output directory', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, 'check-no-write');
  assert.match(await run(['--check', '--output-dir', output], environment), /No files written/);
  assert.equal(existsSync(output), false);
  await writeFile(path.join(directory, 'assetlinks.json'), 'unrelated association');
  assert.match(await run(['--check', '--output-dir', directory], environment), /No files written/);
  assert.equal(await readFile(path.join(directory, 'assetlinks.json'), 'utf8'), 'unrelated association');
});
test('explicit output creates only the two association documents and is idempotent', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, '.well-known');
  await run(['--output-dir', output], environment);
  assert.deepEqual((await readdir(output)).sort(), ['apple-app-site-association', 'assetlinks.json']);
  for (const [name, value] of Object.entries(createAssociations(metadata))) {
    assert.deepEqual(JSON.parse(await readFile(path.join(output, name), 'utf8')), value);
  }
  await run(['--output-dir', output], environment);
});
test('existing different associations are preserved before either output is written', async t => {
  const directory = await temporary(t);
  const existing = '{"unrelated":"application"}\n';
  await writeFile(path.join(directory, 'assetlinks.json'), existing);
  await assert.rejects(run(['--output-dir', directory], environment), /were preserved/);
  assert.equal(await readFile(path.join(directory, 'assetlinks.json'), 'utf8'), existing);
  assert.equal(existsSync(path.join(directory, 'apple-app-site-association')), false);
});
test('repeatable fingerprint flags and owner-supplied flags override environment metadata', async () => {
  const args = ['--check', '--team-id', metadata.appleTeamId, '--bundle-id', metadata.iosBundleId, '--package-id', metadata.androidPackage,
    '--link-host', metadata.linkHost, '--fingerprint', fingerprints[0], `--fingerprint=${fingerprints[1]}`];
  assert.match(await run(args, {}), /No files written/);
  assert.equal(parseArguments(args).fingerprints.length, 2);
  for (const input of [['--unsupported-sensitive-value'], ['--team-id'], ['--team-id', '--check'], ['--team-id', metadata.appleTeamId, '--team-id', metadata.appleTeamId]]) assert.throws(() => parseArguments(input));
});
test('CLI exits unsuccessfully without echoing invalid credential-shaped input or environment values', () => {
  const marker = 'synthetic_sensitive_marker';
  const result = spawnSync(process.execPath, [script, '--check', '--fingerprint', `sk_live_${marker}`], {
    encoding: 'utf8', env: { ...environment, MOBILE_APPLE_TEAM_ID: marker },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /metadata is incomplete or invalid/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(fingerprints[0]), false);
});
