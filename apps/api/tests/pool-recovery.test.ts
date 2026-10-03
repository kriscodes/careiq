import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Pool } from "pg";
import { createDatabasePool } from "../src/db/pool.js";
import { logFailure } from "../src/logging.js";

// The production error handler must be installed before any client can become idle.
test("idle pool errors are handled and logs omit raw errors and client details", async () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => { messages.push(args); };
  const pool = createDatabasePool({ connectionString: "postgresql://unused:unused@localhost/careiq_test" });
  try {
    pool.emit("error", Object.assign(new Error("private SQL and patient details"), { code: "57P01", connectionString: "private credentials" }), { password: "private credentials" });
    assert.deepEqual(messages, [["PostgreSQL idle connection failed", { code: "57P01" }]]);
    logFailure("test", { code: "raw private payload" });
    assert.deepEqual(messages[1], ["test", { code: "UNEXPECTED_ERROR" }]);
  } finally {
    console.error = original;
    await pool.end();
  }
});

test("terminating an idle connection does not stop the pool and a later query reconnects", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Use a disposable local database.");
  assert.ok(["/careiq_test", "/careiq_review"].includes(url.pathname), "Use careiq_test or careiq_review.");
  const failures: string[] = [];
  const pool = createDatabasePool({ connectionString: url.toString(), ssl: false, max: 1 }, (operation) => { failures.push(operation); });
  const controller = new Pool({ connectionString: url.toString(), ssl: false });
  try {
    const first = await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const disconnected = once(pool, "error", { signal: AbortSignal.timeout(5000) });
    await controller.query("SELECT pg_terminate_backend($1)", [first.rows[0]!.pid]);
    await disconnected;
    assert.deepEqual(failures, ["PostgreSQL idle connection failed"]);
    const second = await pool.query<{ pid: number; alive: number }>("SELECT pg_backend_pid() AS pid, 1 AS alive");
    assert.equal(second.rows[0]!.alive, 1);
    assert.notEqual(second.rows[0]!.pid, first.rows[0]!.pid);
  } finally {
    await pool.end();
    await controller.end();
  }
});
