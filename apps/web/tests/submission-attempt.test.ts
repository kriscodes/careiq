import assert from "node:assert/strict";
import test from "node:test";
import { createSubmissionAttempt } from "../src/lib/submission-attempt";

function deterministicAttempt() {
  let sequence = 0;
  return createSubmissionAttempt(() => `attempt-${++sequence}`);
}

test("lost-response retries retain their key; a confirmed save starts a new intent", async () => {
  const attempt = deterministicAttempt();
  const keys: string[] = [];
  const input = { firstName: "Synthetic", lastName: "Patient" };
  await assert.rejects(attempt.submit(input, async key => { keys.push(key); throw new Error("response lost after commit"); }));
  assert.equal(attempt.pending, false);
  await attempt.submit({ ...input }, async key => { keys.push(key); });
  await attempt.submit(input, async key => { keys.push(key); });
  assert.deepEqual(keys, ["attempt-1", "attempt-1", "attempt-2"]);
});

test("editing a failed draft uses a fresh key", async () => {
  const attempt = deterministicAttempt();
  const keys: string[] = [];
  const fail = async (key: string) => { keys.push(key); throw new Error("network failed"); };
  await assert.rejects(attempt.submit({ reason: "First draft" }, fail));
  await assert.rejects(attempt.submit({ reason: "Corrected draft" }, fail));
  assert.deepEqual(keys, ["attempt-1", "attempt-2"]);
});

test("concurrent submissions share one pending operation", async () => {
  const attempt = deterministicAttempt();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  const save = async () => { saves++; await waiting; };
  const first = attempt.submit({ reason: "Synthetic" }, save);
  const second = attempt.submit({ reason: "Synthetic" }, save);
  await Promise.resolve();
  assert.equal(saves, 1);
  assert.equal(attempt.pending, true);
  release();
  await Promise.all([first, second]);
  assert.equal(attempt.pending, false);
});

test("a fresh practice/form scope cannot reuse the previous scope's failed key", async () => {
  let sequence = 0;
  const makeKey = () => `scope-key-${++sequence}`;
  const oldScope = createSubmissionAttempt(makeKey);
  const newScope = createSubmissionAttempt(makeKey);
  const keys: string[] = [];
  await assert.rejects(oldScope.submit({ reason: "Same details" }, async key => { keys.push(key); throw new Error("lost response"); }));
  await newScope.submit({ reason: "Same details" }, async key => { keys.push(key); });
  assert.deepEqual(keys, ["scope-key-1", "scope-key-2"]);
});
