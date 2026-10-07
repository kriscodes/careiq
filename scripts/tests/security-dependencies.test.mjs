import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installed = createRequire(path.join(root, 'node_modules/.pnpm/node_modules/package.json'));
const forge = installed('node-forge');
const braces = installed('braces');
const queryString = installed('query-string');
const xcode = installed('xcode');
const xcodeRequire = createRequire(installed.resolve('xcode/package.json'));
const uuid = xcodeRequire('uuid');
const queryRequire = createRequire(installed.resolve('query-string/package.json'));
const decode = queryRequire('decode-uri-component').default;
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const nextRequire = createRequire(webRequire.resolve('next/package.json'));
const sharp = nextRequire('sharp');

test('exact security patches and installed post-images match reviewed hashes', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'patches/security-manifest.json'), 'utf8'));
  for (const patch of manifest.patches) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(root, patch.patch))).digest('hex'), patch.patchSha256, patch.package);
    const packageRoot = path.dirname(installed.resolve(`${patch.package}/package.json`));
    assert.equal(JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version, patch.version);
    for (const file of patch.files) {
      assert.equal(createHash('sha256').update(readFileSync(path.join(packageRoot, file.path))).digest('hex'), file.sha256, `${patch.package}/${file.path}`);
    }
  }
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 3,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const privateRsa = forge.pki.privateKeyFromPem(privateKey);
const publicRsa = forge.pki.publicKeyFromPem(publicKey);
const message = 'CareIQ synthetic dependency regression';
const digest = createHash('sha256').update(message).digest('latin1');
function signature(parameters, extraChildren = [], transform = value => value) {
  const asn1 = forge.asn1;
  const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes())];
  if (parameters !== undefined) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, parameters));
  algorithm.push(...extraChildren);
  const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
  ]);
  return forge.pki.rsa.encrypt(transform(asn1.toDer(info).getBytes()), privateRsa, 0x01);
}

test('RSA verification rejects extra nested algorithm elements for e=3', () => {
  const garbage = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, 'unchecked padding');
  for (const parameters of [undefined, '']) {
    assert.throws(() => publicRsa.verify(digest, signature(parameters, [garbage])), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  }
});
test('RSA verification rejects nonempty NULL parameters', () => {
  for (const count of [1, 8, 32]) {
    assert.throws(() => publicRsa.verify(digest, signature('x'.repeat(count))), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  }
});
test('RSA verification preserves absent and empty NULL, BER and native signatures', () => {
  assert.equal(publicRsa.verify(digest, signature()), true);
  assert.equal(publicRsa.verify(digest, signature('')), true);
  assert.equal(publicRsa.verify(digest, signature('', [], encoded => '\x30\x80' + encoded.slice(2) + '\x00\x00')), true);
  assert.equal(publicRsa.verify('\x00'.repeat(32), signature('')), false);
  const signer = createSign('RSA-SHA256'); signer.update(message);
  assert.equal(publicRsa.verify(digest, signer.sign(privateKey).toString('latin1')), true);
});
test('RSA verification preserves PSS and NONE modes', () => {
  const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 20 });
  const md = forge.md.sha256.create(); md.update(message);
  assert.equal(publicRsa.verify(digest, privateRsa.sign(md, pss), pss), true);
  assert.equal(publicRsa.verify(digest, privateRsa.sign(digest, 'NONE'), 'NONE'), true);
});

for (const method of ['compile', 'expand', 'stringify']) {
  test(`braces ${method} rejects deeply nested string input before recursive walkers`, () => {
    for (const pair of [['{', '}'], ['(', ')']]) {
      assert.throws(() => braces[method](pair[0].repeat(4500) + 'a' + pair[1].repeat(4500)), error => error instanceof SyntaxError && /maximum nesting/.test(error.message));
    }
  });
  test(`braces ${method} rejects caller AST depth and cycles`, () => {
    const ast = { type: 'root', nodes: [] };
    let current = ast;
    for (let i = 0; i < 300; i++) { const next = { type: 'paren', nodes: [] }; current.nodes.push(next); current = next; }
    assert.throws(() => braces[method](ast), /maximum safe/);
    const cycle = { type: 'root', nodes: [] }; cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), /maximum safe/);
    const wide = new Array(20001);
    wide[Symbol.iterator] = () => { throw new Error('oversized AST must be rejected before queuing children'); };
    assert.throws(() => braces[method]({ type: 'root', nodes: wide }), /maximum safe/);
  });
}
test('braces retains escaped, quoted, character-class and ordinary glob behavior', () => {
  assert.deepEqual(braces.expand('src/{api,web}/{a,b}.ts'), ['src/api/a.ts', 'src/api/b.ts', 'src/web/a.ts', 'src/web/b.ts']);
  assert.equal(braces.compile('file-{1..3}.ts'), 'file-([1-3]).ts');
  assert.doesNotThrow(() => braces.compile('\\{'.repeat(300) + 'x'));
  assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(300) + '"'));
  assert.doesNotThrow(() => braces.compile('[' + '{'.repeat(300) + ']'));
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a' + '}'.repeat(100)));
});

test('fixed decoder and CommonJS query-string interop handle valid and malformed queries', () => {
  assert.equal(decode('%E2%82%AC%20%E6%97%A5'), '€ 日');
  assert.equal(decode('%E0%A4%A'), '%E0%A4%A');
  assert.equal(decode('%C3%A5%FF'), 'å%FF');
  assert.deepEqual({ ...queryString.parse('name=Marlow+Practice&city=%E6%97%A5&invalid=%E0%A4%A') }, { city: '日', invalid: '%E0%A4%A', name: 'Marlow Practice' });
  assert.equal(queryString.stringify({ name: 'Marlow Practice', ticket: 'safe_token' }), 'name=Marlow%20Practice&ticket=safe_token');
});
test('malformed URI input is processed within bounded child-process time', async () => {
  const { spawnSync } = await import('node:child_process');
  const source = `const d = require(${JSON.stringify(queryRequire.resolve('decode-uri-component'))}).default; const s = '%E0%A4%A'.repeat(20000); if (d(s) !== s) process.exit(2);`;
  const result = spawnSync(process.execPath, ['-e', source], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
});
test('xcode uses fixed CommonJS uuid and still produces unique 24-character project IDs', () => {
  assert.equal(xcodeRequire('uuid/package.json').version, '11.1.1');
  assert.throws(() => uuid.v5('x', uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  const project = xcode.project('/tmp/careiq-synthetic.xcodeproj/project.pbxproj');
  project.hash = { project: { objects: {} } };
  const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
});
test('patched sharp still decodes and resizes raster images', async () => {
  assert.equal(sharp.versions.sharp, '0.35.5');
  const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#496f5b' } }).png().toBuffer();
  const output = await sharp(input).resize(16, 16).png().toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 16); assert.equal(metadata.height, 16);
});
