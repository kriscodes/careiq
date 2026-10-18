#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../apps/web/public/.well-known/', import.meta.url));
const options = new Map([
  ['--team-id', 'appleTeamId'], ['--bundle-id', 'iosBundleId'], ['--package-id', 'androidPackage'],
  ['--link-host', 'linkHost'], ['--output-dir', 'outputDirectory'],
]);
const help = `Generate local mobile website association files from owner-supplied metadata.
Usage: node scripts/generate-mobile-associations.mjs [options]
  --team-id <Apple Team ID>        or MOBILE_APPLE_TEAM_ID
  --bundle-id <iOS bundle ID>      or MOBILE_IOS_BUNDLE_ID
  --package-id <Android package>   or MOBILE_ANDROID_PACKAGE
  --link-host <owned hostname>     or MOBILE_LINK_HOST
  --fingerprint <certificate SHA256> (repeat for rotations)
                                   or comma-separated MOBILE_ANDROID_CERT_SHA256
  --output-dir <directory>         defaults to apps/web/public/.well-known
  --check                         validate only; do not read or write output files
  --help                          show usage
No accounts are registered, domains configured, or files published.
Existing different files are preserved. Stage replacements in a separate output directory.`;

export function parseArguments(args) {
  const result = { fingerprints: [], check: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--check') { result.check = true; continue; }
    if (argument === '--help') { result.help = true; continue; }
    const separator = argument.indexOf('=');
    const flag = separator < 0 ? argument : argument.slice(0, separator);
    if (!options.has(flag) && flag !== '--fingerprint') throw new Error('Unknown option. Use --help for supported options.');
    const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error('A supported option is missing its value. Use --help for usage.');
    if (flag === '--fingerprint') result.fingerprints.push(value);
    else {
      const key = options.get(flag);
      if (result[key] !== undefined) throw new Error('A metadata option was supplied more than once.');
      result[key] = value;
    }
  }
  return result;
}

function publicHostname(value) {
  return value.length <= 253 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)
    && !/^\d+(\.\d+){3}$/.test(value)
    && !/(^|\.)(localhost|local|test|example|invalid)$/.test(value)
    && !/^(.+\.)?example\.(com|net|org)$/.test(value);
}
function provisionalIdentifier(value) {
  return /^dev\.careiq\.mobile(?:\.|$)/i.test(value) || /(^|\.)(example|placeholder|yourapp)(\.|$)/i.test(value);
}
export function validateMetadata(input) {
  const metadata = {
    appleTeamId: String(input.appleTeamId ?? '').trim(),
    iosBundleId: String(input.iosBundleId ?? '').trim(),
    androidPackage: String(input.androidPackage ?? '').trim(),
    linkHost: String(input.linkHost ?? '').trim().toLowerCase(),
    fingerprints: [],
  };
  const errors = [];
  if (!/^[A-Z0-9]{10}$/.test(metadata.appleTeamId) || metadata.appleTeamId === 'YOURTEAMID' || /^(.)\1+$/.test(metadata.appleTeamId)) errors.push('A real owner-supplied Apple Team ID (10 uppercase letters/digits) is required.');
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(metadata.iosBundleId) || provisionalIdentifier(metadata.iosBundleId)) errors.push('A registered owner-supplied iOS bundle ID is required.');
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(metadata.androidPackage) || provisionalIdentifier(metadata.androidPackage)) errors.push('A registered owner-supplied Android package ID is required.');
  if (!publicHostname(metadata.linkHost)) errors.push('An owned public link hostname without a scheme, path, port, credentials or wildcard is required.');
  const fingerprints = input.fingerprints;
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) errors.push('At least one real Android signing-certificate SHA-256 fingerprint is required.');
  else {
    for (const raw of fingerprints) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      const valid = /^(?:[0-9a-f]{64}|(?:[0-9a-f]{2}:){31}[0-9a-f]{2})$/i.test(value);
      const compact = value.replaceAll(':', '');
      if (!valid || /^([0-9a-f])\1{63}$/i.test(compact)) errors.push('Every signing fingerprint must contain exactly 32 SHA-256 bytes (hex, optionally colon-separated).');
      else metadata.fingerprints.push(compact.toUpperCase().match(/.{2}/g).join(':'));
    }
  }
  if (errors.length) throw new Error(`Mobile association metadata is incomplete or invalid:\n${[...new Set(errors)].join('\n')}`);
  metadata.fingerprints = [...new Set(metadata.fingerprints)].sort();
  return metadata;
}

export function createAssociations(input) {
  const metadata = validateMetadata(input);
  return {
    'apple-app-site-association': {
      applinks: { details: [{ appIDs: [`${metadata.appleTeamId}.${metadata.iosBundleId}`], components: [{ '/': '/join' }, { '/': '/patient-workflow' }] }] },
    },
    'assetlinks.json': [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: metadata.androidPackage, sha256_cert_fingerprints: metadata.fingerprints },
    }],
  };
}

export async function run(args, environment = process.env) {
  const parsed = parseArguments(args);
  if (parsed.help) return help;
  const metadata = {
    appleTeamId: parsed.appleTeamId ?? environment.MOBILE_APPLE_TEAM_ID,
    iosBundleId: parsed.iosBundleId ?? environment.MOBILE_IOS_BUNDLE_ID,
    androidPackage: parsed.androidPackage ?? environment.MOBILE_ANDROID_PACKAGE,
    linkHost: parsed.linkHost ?? environment.MOBILE_LINK_HOST,
    fingerprints: parsed.fingerprints.length ? parsed.fingerprints : environment.MOBILE_ANDROID_CERT_SHA256?.split(','),
  };
  const files = createAssociations(metadata);
  if (parsed.check) return 'Mobile association metadata is valid. No files written.';
  const outputDirectory = path.resolve(parsed.outputDirectory || defaultDirectory);
  const writes = [];
  for (const [name, value] of Object.entries(files)) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const target = path.join(outputDirectory, name);
    let existing;
    try { existing = await readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('An existing association file could not be read. No files written.'); }
    if (existing !== undefined && existing !== content) throw new Error('Existing association files differ and were preserved. Use a separate output directory to review a replacement.');
    if (existing === undefined) writes.push({ target, content });
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const file of writes) await writeFile(file.target, file.content, { flag: 'wx', mode: 0o644 });
  return 'Mobile association files are prepared locally. Review before publishing and complete domain/device verification.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(await run(process.argv.slice(2))); }
  catch (error) {
    // Report validation guidance only. Never echo environment values, fingerprints or credential-shaped inputs.
    console.error(error instanceof Error && !error.code ? error.message : 'Unable to prepare mobile association files locally.');
    process.exitCode = 1;
  }
}
