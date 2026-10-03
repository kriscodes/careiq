import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Pool, type PoolClient } from "pg";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
import { PRIVACY_NOTICE_VERSION } from "@careiq/interview-contract";
import { marketingInterviewRequests } from "../src/db/schema/marketing-interview-requests.js";
import { INTERVIEW_REQUEST_PATH, registerPublicInterviewRoutes, type InterviewRequestLog } from "../src/routes/public-interview-requests.js";

const url = process.env.TEST_DATABASE_URL;

test("marketing submissions commit once under a restricted runtime login without contact read/update/delete access", { skip: !url }, async () => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "Use a disposable local database.");
  assert.ok(["/careiq_review", "/careiq_test"].includes(target.pathname), "Use careiq_review or careiq_test.");
  assert.ok(!target.search, "Do not override the confirmed local connection through URL parameters.");
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const role = `careiq_marketing_test_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const key = randomUUID();
  const secondKey = randomUUID();
  const apiKey = randomUUID();
  const returningKey = randomUUID(), invalidRoleKey = randomUUID(), oversizedKey = randomUUID(), invalidSourceKey = randomUUID();
  const testKeys = [key, secondKey, apiKey, returningKey, invalidRoleKey, oversizedKey, invalidSourceKey];
  let runtime: Pool | undefined;
  let createdRole = false;
  try {
    // A real separate login proves effective runtime permissions, not mocked DB access.
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    createdRole = true;
    const grantScript = (await readFile(new URL("../src/db/grant-marketing-submitter.sql", import.meta.url), "utf8"))
      .replace(/^\\set .*$/m, "")
      .replace(":'runtime_role'", `'${role}'`);
    try { await admin.query(grantScript); }
    catch (error) { await admin.query("ROLLBACK"); throw error; }
    const runtimeUrl = new URL(url!);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    runtime = new Pool({ connectionString: runtimeUrl.href, ssl: false });
    const database = drizzle(runtime);
    const payload = {
      name: "Synthetic Practice Manager",
      email: "synthetic@example.invalid",
      role: "practice_manager",
      practiceName: "Synthetic Test Practice",
      submissionKey: key,
      source: "marketing_homepage",
      privacyNoticeVersion: "2026-10-02",
    };
    const insert = (values = payload) => database.insert(marketingInterviewRequests).values(values)
      .onConflictDoNothing({ target: marketingInterviewRequests.submissionKey });
    await insert();
    await Promise.all([insert(), insert(), insert()]);
    // Same email with a new key is a separate request; email is not globally unique.
    await insert({ ...payload, submissionKey: secondKey, practiceName: "Another Synthetic Practice" });
    const persisted = await admin.query("SELECT id, name, email, role, practice_name, source, privacy_notice_version, created_at FROM marketing_interview_requests WHERE submission_key = $1", [key]);
    assert.equal(persisted.rowCount, 1);
    assert.match(persisted.rows[0].id, /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    assert.equal(persisted.rows[0].name, payload.name);
    assert.equal(persisted.rows[0].email, payload.email);
    assert.equal(persisted.rows[0].source, payload.source);
    assert.equal(persisted.rows[0].privacy_notice_version, payload.privacyNoticeVersion);
    assert.ok(persisted.rows[0].created_at instanceof Date);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM marketing_interview_requests WHERE submission_key = ANY($1::uuid[])", [[key, secondKey]])).rows[0].count, 2);

    const app = express();
    const logs: InterviewRequestLog[] = [];
    registerPublicInterviewRoutes(app, {
      enabled: true, origins: ["https://careiqlabs.com"],
      log: (entry) => logs.push(entry), rateLimit: () => ({ allowed: true }),
      store: async (input) => {
        await database.insert(marketingInterviewRequests).values({
          name: input.name, email: input.email, role: input.role,
          practiceName: input.practiceName ?? null, submissionKey: input.submissionKey,
          source: "marketing_homepage", privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        }).onConflictDoNothing({ target: marketingInterviewRequests.submissionKey });
      },
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}${INTERVIEW_REQUEST_PATH}`;
      const send = () => fetch(address, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://careiqlabs.com" }, body: JSON.stringify({ name: " API Synthetic Person ", email: "api-synthetic@example.invalid", role: "provider", submissionKey: apiKey, website: "" }) });
      for (const response of [await send(), ...await Promise.all([send(), send()])]) {
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: { accepted: true } });
      }
      const apiPersisted = await admin.query("SELECT name, email, practice_name FROM marketing_interview_requests WHERE submission_key = $1", [apiKey]);
      assert.equal(apiPersisted.rowCount, 1);
      assert.deepEqual(apiPersisted.rows[0], { name: "API Synthetic Person", email: "api-synthetic@example.invalid", practice_name: null });
      assert.equal(logs.length, 3);
      assert.doesNotMatch(JSON.stringify(logs), /Synthetic|api-synthetic|example.invalid/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const privileges = await runtime.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assert.equal(privileges.rows[0].current_user, role);
    assert.equal(privileges.rows[0].rolsuper, false);
    assert.equal(privileges.rows[0].rolbypassrls, false);
    // ON CONFLICT needs this one column only; it exposes no contact details.
    assert.equal((await runtime.query("SELECT submission_key FROM marketing_interview_requests WHERE submission_key = $1", [key])).rowCount, 1);
    const denied = (statement: string, values?: unknown[]) => assert.rejects(runtime!.query(statement, values), (error: unknown) => (error as { code?: string }).code === "42501");
    await denied("SELECT * FROM marketing_interview_requests");
    await denied("SELECT name, email, practice_name FROM marketing_interview_requests");
    await denied("UPDATE marketing_interview_requests SET name = 'Changed'");
    await denied("DELETE FROM marketing_interview_requests");
    await denied("TRUNCATE marketing_interview_requests");
    await denied("INSERT INTO marketing_interview_requests (name, email, role, submission_key, privacy_notice_version) VALUES ('Synthetic', 'synthetic@example.invalid', 'provider', $1, '2026-10-02') RETURNING id", [returningKey]);
    await assert.rejects(insert({ ...payload, submissionKey: invalidRoleKey, role: "administrator" }), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23514");
    await assert.rejects(insert({ ...payload, submissionKey: oversizedKey, name: "x".repeat(121) }), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "22001");
    await assert.rejects(insert({ ...payload, submissionKey: invalidSourceKey, source: "client_claim" }), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23514");
    const tenantPolicies = await admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('patients'::regclass, 'appointments'::regclass)");
    assert.equal(tenantPolicies.rowCount, 2);
    for (const table of tenantPolicies.rows) assert.ok(table.relrowsecurity && table.relforcerowsecurity);
  } finally {
    await runtime?.end();
    try {
      await admin.query("DELETE FROM marketing_interview_requests WHERE submission_key = ANY($1::uuid[])", [testKeys]);
    } finally {
      try { if (createdRole) await admin.query(`DROP ROLE ${role}`); }
      finally { await admin.end(); }
    }
  }
});

test("operator grants reject elevated, owning, and indirectly unsafe runtime roles transactionally", { skip: !url }, async (context) => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "Use a disposable local database.");
  assert.ok(["/careiq_review", "/careiq_test"].includes(target.pathname), "Use careiq_review or careiq_test.");
  assert.ok(!target.search, "Do not override the confirmed local connection through URL parameters.");
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const script = (await readFile(new URL("../src/db/grant-marketing-submitter.sql", import.meta.url), "utf8"))
    .replace(/^\\set .*$/m, "")
    // The test supplies the enclosing transaction so every fixture, ownership
    // change, and attempted grant is rolled back, including on assertion failure.
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  type Rejection = { name: string; prepare: (client: PoolClient, role: string, related: string) => Promise<unknown>; message: RegExp };
  const cases: Rejection[] = [
    ...["SUPERUSER", "BYPASSRLS", "CREATEROLE", "CREATEDB", "REPLICATION"].map((attribute) => ({
      name: `rejects ${attribute.toLowerCase()}`,
      prepare: (client: PoolClient, role: string) => client.query(`ALTER ROLE ${role} ${attribute}`),
      message: /must not be privileged/,
    })),
    { name: "rejects table ownership", prepare: (client, role) => client.query(`ALTER TABLE marketing_interview_requests OWNER TO ${role}`), message: /must not be privileged/ },
    { name: "rejects schema ownership", prepare: (client, role) => client.query(`ALTER SCHEMA public OWNER TO ${role}`), message: /must not be privileged/ },
    { name: "rejects database ownership", prepare: (client, role) => client.query(`ALTER DATABASE ${target.pathname.slice(1)} OWNER TO ${role}`), message: /must not be privileged/ },
    { name: "rejects owner membership even without inheritance", prepare: async (client, role, related) => {
      await client.query(`ALTER TABLE marketing_interview_requests OWNER TO ${related}`);
      await client.query(`GRANT ${related} TO ${role} WITH INHERIT FALSE`);
    }, message: /must not be privileged/ },
    { name: "rejects inherited contact reads", prepare: async (client, role, related) => {
      await client.query(`GRANT SELECT (email) ON marketing_interview_requests TO ${related}`);
      await client.query(`GRANT ${related} TO ${role}`);
      assert.equal((await client.query("SELECT has_column_privilege($1, 'marketing_interview_requests', 'email', 'SELECT') AS allowed", [role])).rows[0].allowed, true);
    }, message: /protected marketing request columns/ },
    { name: "rejects contact reads reachable only by SET ROLE", prepare: async (client, role, related) => {
      await client.query(`GRANT SELECT (email) ON marketing_interview_requests TO ${related}`);
      await client.query(`GRANT ${related} TO ${role} WITH INHERIT FALSE`);
      assert.equal((await client.query("SELECT has_column_privilege($1, 'marketing_interview_requests', 'email', 'SELECT') AS allowed", [role])).rows[0].allowed, false);
      assert.equal((await client.query("SELECT pg_has_role($1, $2, 'SET') AS allowed", [role, related])).rows[0].allowed, true);
    }, message: /protected marketing request columns/ },
    { name: "rejects ADMIN-only contact-reader membership with INHERIT and SET disabled", prepare: async (client, role, related) => {
      await client.query(`GRANT SELECT (email) ON marketing_interview_requests TO ${related}`);
      await client.query(`GRANT ${related} TO ${role} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      assert.equal((await client.query("SELECT has_column_privilege($1, 'marketing_interview_requests', 'email', 'SELECT') AS allowed", [role])).rows[0].allowed, false);
      assert.equal((await client.query("SELECT pg_has_role($1, $2, 'SET') AS allowed", [role, related])).rows[0].allowed, false);
      assert.equal((await client.query("SELECT pg_has_role($1, $2, 'MEMBER') AS allowed", [role, related])).rows[0].allowed, true);
      // Prove ADMIN OPTION can enable the otherwise inaccessible membership;
      // roll it back before checking that the original configuration is refused.
      await client.query("SAVEPOINT membership_escalation");
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`GRANT ${related} TO ${role} WITH INHERIT TRUE, SET TRUE`);
      assert.equal((await client.query("SELECT has_column_privilege(current_user, 'marketing_interview_requests', 'email', 'SELECT') AS allowed")).rows[0].allowed, true);
      await client.query("RESET ROLE");
      await client.query("ROLLBACK TO SAVEPOINT membership_escalation");
      await client.query("RELEASE SAVEPOINT membership_escalation");
    }, message: /protected marketing request columns/ },
    { name: "rejects elevated privileges reachable only by SET ROLE", prepare: async (client, role, related) => {
      await client.query(`ALTER ROLE ${related} CREATEROLE`);
      await client.query(`GRANT ${related} TO ${role} WITH INHERIT FALSE`);
    }, message: /member of a privileged/ },
    ...["pg_read_server_files", "pg_write_server_files", "pg_execute_server_program"].map((serverRole) => ({
      name: `rejects transitive ${serverRole} membership even without INHERIT or SET`,
      prepare: async (client: PoolClient, role: string, related: string) => {
        await client.query(`GRANT ${serverRole} TO ${related} WITH INHERIT FALSE, SET FALSE`);
        await client.query(`GRANT ${related} TO ${role} WITH INHERIT FALSE, SET FALSE`);
        assert.equal((await client.query("SELECT pg_has_role($1, $2, 'MEMBER') AS allowed", [role, serverRole])).rows[0].allowed, true);
        assert.equal((await client.query("SELECT pg_has_role($1, $2, 'SET') AS allowed", [role, serverRole])).rows[0].allowed, false);
      },
      message: /server file or program role membership/,
    })),
    ...["UPDATE", "REFERENCES"].map((privilege) => ({
      name: `rejects column-only ${privilege.toLowerCase()} of retry keys`,
      prepare: (client: PoolClient, role: string) => client.query(`GRANT ${privilege} (submission_key) ON marketing_interview_requests TO ${role}`),
      message: /protected marketing request columns/,
    })),
    { name: "rejects inherited deletion", prepare: async (client, role, related) => {
      await client.query(`GRANT DELETE ON marketing_interview_requests TO ${related}`);
      await client.query(`GRANT ${related} TO ${role}`);
    }, message: /unexpected privileges/ },
  ];
  try {
    for (const scenario of cases) await context.test(scenario.name, async () => {
      const client = await admin.connect();
      const role = `careiq_unsafe_test_${randomBytes(8).toString("hex")}`;
      const related = `careiq_related_test_${randomBytes(8).toString("hex")}`;
      try {
        await client.query("BEGIN");
        await client.query(`CREATE ROLE ${role} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        await client.query(`CREATE ROLE ${related} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        await scenario.prepare(client, role, related);
        await assert.rejects(client.query(script.replace(":'runtime_role'", `'${role}'`)), (error: unknown) => {
          const failure = error as { code?: string; message?: string };
          return failure.code === "P0001" && scenario.message.test(failure.message ?? "");
        });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      assert.equal((await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [[role, related]])).rowCount, 0, "Unsafe role fixtures and grants must not persist.");
    });
  } finally { await admin.end(); }
});
