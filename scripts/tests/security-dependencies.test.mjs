import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installed = createRequire(path.join(root, 'node_modules/.pnpm/node_modules/package.json'));
const braces = installed('braces');
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
for (const method of ['compile', 'expand', 'stringify']) {
  test(`braces direct ${method} submodule rejects caller AST depth, cycles and width`, () => {
    const walk = installed(`braces/lib/${method}`);
    const ast = { type: 'root', nodes: [] };
    let current = ast;
    for (let index = 0; index < 300; index++) {
      const next = { type: 'paren', nodes: [] };
      current.nodes.push(next); current = next;
    }
    assert.throws(() => walk(ast), error => error instanceof SyntaxError && /maximum safe/.test(error.message));
    const cycle = { type: 'root', nodes: [] }; cycle.nodes.push(cycle);
    assert.throws(() => walk(cycle), /maximum safe/);
    const wide = { type: 'root', nodes: Array.from({ length: 20001 }, () => ({ type: 'text', value: 'x' })) };
    assert.throws(() => walk(wide), /maximum safe/);
    assert.doesNotThrow(() => walk(braces.parse('src/{api,web}/{a,b}.ts')));
  });
}
test('retained Next lint matcher resolves the exact guarded braces package copy', () => {
  const micromatchRequire = createRequire(installed.resolve('micromatch/package.json'));
  assert.equal(micromatchRequire.resolve('braces'), installed.resolve('braces'));
  const micromatch = installed('micromatch');
  assert.deepEqual(micromatch.braceExpand('src/{api,web}/{a,b}.ts'), ['src/api/a.ts', 'src/api/b.ts', 'src/web/a.ts', 'src/web/b.ts']);
  assert.throws(() => micromatch.braces('{'.repeat(4500) + 'a' + '}'.repeat(4500)), /maximum nesting/);
});

test('braces retains escaped, quoted, character-class and ordinary glob behavior', () => {
  assert.deepEqual(braces.expand('src/{api,web}/{a,b}.ts'), ['src/api/a.ts', 'src/api/b.ts', 'src/web/a.ts', 'src/web/b.ts']);
  assert.equal(braces.compile('file-{1..3}.ts'), 'file-([1-3]).ts');
  assert.doesNotThrow(() => braces.compile('\\{'.repeat(300) + 'x'));
  assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(300) + '"'));
  assert.doesNotThrow(() => braces.compile('[' + '{'.repeat(300) + ']'));
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a' + '}'.repeat(100)));
});

test('patched sharp still decodes and resizes raster images', async () => {
  assert.equal(sharp.versions.sharp, '0.35.5');
  const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#496f5b' } }).png().toBuffer();
  const output = await sharp(input).resize(16, 16).png().toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 16); assert.equal(metadata.height, 16);
});

test('Drizzle legacy loader uses fixed esbuild and preserves sync and async TypeScript transforms', async () => {
  const corePath = installed.resolve('@esbuild-kit/core-utils');
  const coreRequire = createRequire(corePath);
  const esbuild = coreRequire('esbuild');
  assert.equal(esbuild.version, '0.25.12');
  const core = installed('@esbuild-kit/core-utils');
  const { runInNewContext } = await import('node:vm');
  const module = { exports: {} };
  const transformed = core.transformSync('export const answer: number = 42;', '/tmp/careiq-security-synthetic.cts');
  runInNewContext(transformed.code, { module, exports: module.exports, require: coreRequire });
  assert.equal(module.exports.answer, 42);
  assert.ok(transformed.map.sources.length > 0);
  const asyncResult = await core.transform('export const answer: number = 42;', '/tmp/careiq-security-synthetic.mts');
  const imported = await import(`data:text/javascript;base64,${Buffer.from(asyncResult.code).toString('base64')}`);
  assert.equal(imported.answer, 42);
  assert.ok(asyncResult.map.sources.length > 0);
});

test('fixed esbuild dev server denies foreign hosts and exposes no wildcard CORS response', { timeout: 10000 }, async () => {
  const coreRequire = createRequire(installed.resolve('@esbuild-kit/core-utils'));
  const esbuild = coreRequire('esbuild');
  const { request } = await import('node:http');
  const context = await esbuild.context({ stdin: { contents: 'console.log("synthetic dependency check")', sourcefile: 'entry.js' }, outfile: '/tmp/careiq-security-esbuild/output.js', write: false, logLevel: 'silent' });
  try {
    const server = await context.serve({ host: '127.0.0.1', port: 0 });
    const read = headers => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: '/output.js', headers }, response => {
        response.resume(); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
      });
      req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('synthetic esbuild request timeout'))); req.end();
    });
    const foreignOrigin = await read({ Origin: 'https://foreign.example' });
    assert.equal(foreignOrigin.status, 200);
    assert.equal(foreignOrigin.headers['access-control-allow-origin'], undefined);
    const foreignHost = await read({ Host: 'foreign.example' });
    assert.equal(foreignHost.status, 403);
  } finally {
    await context.dispose();
  }
});

test('active lockfile excludes the archived mobile graph and its obsolete security patches', () => {
  const lock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^  apps\/mobile:/m);
  for (const name of ['node-forge', 'query-string', 'decode-uri-component', 'xcode', 'expo', 'react-native']) {
    assert.ok(!lock.includes(`  ${name}@`), `separated package ${name} re-entered the active lockfile`);
  }
  assert.doesNotMatch(lock, /^  '@expo\//m);
  const manifest = JSON.parse(readFileSync(path.join(root, 'patches/security-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.patches.map(patch => patch.package), ['braces']);
});
