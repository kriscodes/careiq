import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FILE_BYTES, repositoryViolations } from '../check-repository.mjs';

const file = (path, bytes) => ({ path, bytes });

test('ordinary tracked files and files exactly at the limit are allowed', () => {
  assert.deepEqual(
    repositoryViolations([file('src/app.ts', 100), file('docs/image.png', MAX_FILE_BYTES)]),
    [],
  );
});

test('new large artifacts fail while existing per-path evidence is retained', () => {
  const bytes = MAX_FILE_BYTES + 1;
  assert.equal(repositoryViolations([file('docs/new.png', bytes)]).length, 1);
  assert.deepEqual(
    repositoryViolations([file('docs/old.png', bytes)], { 'docs/old.png': bytes }),
    [],
  );
});

test('new logs fail even when empty or written with uppercase extensions', () => {
  assert.equal(repositoryViolations([file('build.log', 0), file('build.LOG', 1)]).length, 2);
});

test('legacy logs may stay or shrink but cannot grow', () => {
  const baseline = { 'docs/old.log': 128 };
  assert.deepEqual(repositoryViolations([file('docs/old.log', 128)], baseline), []);
  assert.deepEqual(repositoryViolations([file('docs/old.log', 0)], baseline), []);
  assert.equal(repositoryViolations([file('docs/old.log', 129)], baseline).length, 1);
});

test('legacy oversized artifacts cannot grow or transfer their allowance to another path', () => {
  const baseline = { 'docs/old.png': MAX_FILE_BYTES + 100 };
  assert.equal(
    repositoryViolations([file('docs/old.png', MAX_FILE_BYTES + 101)], baseline).length,
    1,
  );
  assert.equal(
    repositoryViolations([file('docs/new.png', MAX_FILE_BYTES + 100)], baseline).length,
    1,
  );
  assert.deepEqual(repositoryViolations([file('docs/old.png', MAX_FILE_BYTES + 1)], baseline), []);
});

test('invalid size allowances cannot bypass the check', () => {
  for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY, '2000000']) {
    assert.throws(
      () => repositoryViolations([], { 'docs/old.png': bytes }),
      /Invalid repository size allowance/,
    );
  }
  assert.throws(() => repositoryViolations([file('src/app.ts', -1)]), /Invalid file size/);
});
