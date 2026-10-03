import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const readGrant = async (name: string, parameter: string, role: string) =>
  (await readFile(new URL(`../src/db/${name}.sql`, import.meta.url), "utf8"))
    .replace(/^\\set .*$/m, "").replace(`:'${parameter}'`, `'${role}'`);
const withoutTransaction = (text: string) => text.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");

function localTarget() {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.ok(["/careiq_review", "/careiq_test"].includes(target.pathname));
  assert.equal(target.search, "", "Local connection overrides are not allowed.");
  return target;
}

test("clinical retries, audit records, least privilege, and pagination work under a restricted login", { skip: !url }, async (context) => {
  const target = localTarget();
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const role = `careiq_clinical_test_${randomBytes(8).toString("hex")}`;
  const reviewer = `careiq_reviewer_test_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const a = { practiceId: randomUUID(), orgId: "synthetic_org_a", userId: "synthetic_actor_a" };
  const b = { practiceId: randomUUID(), orgId: "synthetic_org_b", userId: "synthetic_actor_b" };
  const originalUrl = process.env.DATABASE_URL, originalTls = process.env.DATABASE_SSL_MODE;
  let pool: Pool | undefined;
  let auditPool: Pool | undefined;
  let runtimeCreated = false, reviewerCreated = false;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    runtimeCreated = true;
    await admin.query(await readGrant("grant-clinical-runtime", "runtime_role", role));
    // The same restricted API login can safely receive the separate marketing grant.
    await admin.query(await readGrant("grant-marketing-submitter", "runtime_role", role));
    for (const tenant of [a, b]) await admin.query("INSERT INTO practices (id, clerk_org_id, name) VALUES ($1, $2, 'Synthetic security test')", [tenant.practiceId, `test_${tenant.practiceId}`]);
    const runtimeUrl = new URL(target); runtimeUrl.username = role; runtimeUrl.password = password;
    process.env.DATABASE_URL = runtimeUrl.href; process.env.DATABASE_SSL_MODE = "disable";
    ({ pool } = await import("../src/db/client.js"));
    const { createPatient, listPatients } = await import("../src/services/patient.service.js");
    const { createAppointment, listAppointments } = await import("../src/services/appointment.service.js");
    const key = randomUUID();
    const input = { firstName: " Synthetic ", lastName: " Person ", email: " synthetic@example.invalid " };
    let patientId = "";

    await context.test("simultaneous identical requests create once and retries return the original", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => createPatient(a, input, key)));
      assert.equal(new Set(results.map((row) => row.id)).size, 1);
      patientId = results[0].id;
      assert.equal(results[0].firstName, "Synthetic");
      assert.equal(Object.keys(results[0]).some((name) => /key|hash/i.test(name)), false);
      const retry = await createPatient(a, { firstName: "Synthetic", lastName: "Person", email: "synthetic@example.invalid", phone: " " }, key.toUpperCase());
      assert.equal(retry.id, patientId);
      const counts = await admin.query("SELECT action, count(*)::int AS count FROM clinical_audit_events WHERE practice_id=$1 GROUP BY action", [a.practiceId]);
      assert.equal(counts.rows.find((row) => row.action === "patients.create").count, 1);
      assert.equal(counts.rows.find((row) => row.action === "patients.read").count, 8);
    });

    await context.test("changed payload conflicts and keys are scoped by tenant and operation", async () => {
      await assert.rejects(createPatient(a, { ...input, lastName: "Changed" }, key), /IDEMPOTENCY_KEY_REUSED/);
      await assert.rejects(createPatient(a, input, "invalid-key"), /INVALID_IDEMPOTENCY_KEY/);
      const other = await createPatient(b, input, key);
      assert.notEqual(other.id, patientId);
      const appointment = { patientId, scheduledAt: new Date("2027-01-03T12:00:00Z"), reason: " Synthetic reason " };
      const results = await Promise.all(Array.from({ length: 5 }, () => createAppointment(a, appointment, key)));
      assert.equal(new Set(results.map((row) => row.id)).size, 1);
      await assert.rejects(createAppointment(a, { ...appointment, reason: "Changed" }, key), /IDEMPOTENCY_KEY_REUSED/);
      await assert.rejects(createAppointment(b, appointment, randomUUID()), /PATIENT_NOT_FOUND/);
      assert.equal((await listAppointments(a)).length, 1);
      assert.equal((await listAppointments(b)).length, 0);
      const records = await admin.query("SELECT operation, practice_id, request_hash, resource_id FROM clinical_request_keys WHERE request_key=$1", [key]);
      assert.equal(records.rowCount, 3);
      for (const record of records.rows) assert.match(record.request_hash, /^[0-9a-f]{64}$/);
    });

    await context.test("reads are bounded and deterministically paginated within the tenant", async () => {
      await admin.query("INSERT INTO patients (practice_id, first_name, last_name) SELECT $1, 'Paging', lpad(value::text, 3, '0') FROM generate_series(1, 105) value", [a.practiceId]);
      assert.equal((await listPatients(a)).length, 100);
      const first = await listPatients(a, { limit: 2, offset: 0 });
      const second = await listPatients(a, { limit: 2, offset: 2 });
      assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 4);
      for (const row of [...first, ...second]) assert.equal(row.practiceId, a.practiceId);
      assert.equal((await listPatients(b)).length, 1);
      const recorded = await admin.query("SELECT DISTINCT resource_id FROM clinical_audit_events WHERE practice_id=$1 AND action='patients.read'", [a.practiceId]);
      const recordedIds = new Set(recorded.rows.map((row) => row.resource_id));
      for (const row of [...first, ...second]) assert.ok(recordedIds.has(row.id));
      await assert.rejects(listPatients(a, { limit: 102 }), /INVALID_PAGINATION/);
      await assert.rejects(listPatients(a, { offset: -1 }), /INVALID_PAGINATION/);
    });

    await context.test("audit failure rolls back both the resource and idempotency key", async () => {
      const failedKey = randomUUID();
      const before = (await admin.query("SELECT count(*)::int AS count FROM patients WHERE practice_id=$1", [a.practiceId])).rows[0].count;
      await assert.rejects(createPatient({ ...a, userId: "" }, { firstName: "Atomic", lastName: "Failure" }, failedKey));
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM patients WHERE practice_id=$1", [a.practiceId])).rows[0].count, before);
      assert.equal((await admin.query("SELECT request_key FROM clinical_request_keys WHERE request_key=$1", [failedKey])).rowCount, 0);
      await assert.rejects(listPatients({ ...a, userId: "" }));
    });

    await context.test("runtime cannot read or rewrite audit events, change keys, or bypass tenant context", async () => {
      for (const statement of ["SELECT * FROM clinical_audit_events", "UPDATE clinical_audit_events SET action='patients.list'", "DELETE FROM clinical_audit_events", "TRUNCATE clinical_audit_events", "UPDATE clinical_request_keys SET request_hash=repeat('a',64)", "DELETE FROM clinical_request_keys", "ALTER TABLE patients DISABLE ROW LEVEL SECURITY"]) {
        await assert.rejects(pool!.query(statement), (error: unknown) => (error as { code?: string }).code === "42501");
      }
      assert.equal((await pool!.query("SELECT * FROM clinical_request_keys")).rowCount, 0);
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.practice_id', $1, true)", [a.practiceId]);
        const records = await client.query("SELECT practice_id FROM clinical_request_keys");
        assert.equal(records.rowCount, 2);
        for (const row of records.rows) assert.equal(row.practice_id, a.practiceId);
        await assert.rejects(client.query("INSERT INTO clinical_audit_events(practice_id, actor_user_id, action) VALUES ($1, 'forged', 'patients.list')", [b.practiceId]), (error: unknown) => (error as { code?: string }).code === "42501");
      } finally { await client.query("ROLLBACK"); client.release(); }
      const security = await admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('clinical_request_keys'::regclass,'clinical_audit_events'::regclass)");
      for (const row of security.rows) assert.ok(row.relrowsecurity && row.relforcerowsecurity);
      const events = await admin.query("SELECT * FROM clinical_audit_events WHERE practice_id = ANY($1::uuid[])", [[a.practiceId, b.practiceId]]);
      assert.ok(events.rowCount! > 0);
      assert.doesNotMatch(JSON.stringify(events.rows), /example.invalid|Synthetic reason|Atomic/);
      for (const row of events.rows) assert.ok([a.userId, b.userId].includes(row.actor_user_id));
    });

    await context.test("dedicated audit reviewer reads only the selected tenant and cannot write", async () => {
      await admin.query(`CREATE ROLE ${reviewer} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
      reviewerCreated = true;
      await admin.query(await readGrant("grant-audit-reader", "audit_reader_role", reviewer));
      const reviewerUrl = new URL(target); reviewerUrl.username = reviewer; reviewerUrl.password = password;
      auditPool = new Pool({ connectionString: reviewerUrl.href, ssl: false });
      assert.equal((await auditPool.query("SELECT * FROM clinical_audit_events")).rowCount, 0);
      const client = await auditPool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SELECT set_config('app.practice_id', $1, true)", [a.practiceId]);
        const result = await client.query("SELECT practice_id FROM clinical_audit_events");
        assert.ok(result.rowCount! > 0);
        for (const row of result.rows) assert.equal(row.practice_id, a.practiceId);
      } finally { await client.query("ROLLBACK"); client.release(); }
      for (const statement of ["INSERT INTO clinical_audit_events(practice_id,actor_user_id,action) VALUES ('00000000-0000-4000-8000-000000000000','forged','patients.list')", "UPDATE clinical_audit_events SET action='patients.list'", "DELETE FROM clinical_audit_events", "SELECT * FROM patients"]) {
        await assert.rejects(auditPool.query(statement), (error: unknown) => (error as { code?: string }).code === "42501");
      }
      // Granting the review capability to an API login is refused transactionally.
      await assert.rejects(admin.query(await readGrant("grant-audit-reader", "audit_reader_role", role)), /separate from runtime/);
      await admin.query("ROLLBACK");
      assert.equal((await admin.query("SELECT pg_has_role($1, 'careiq_audit_reader', 'MEMBER') AS allowed", [role])).rows[0].allowed, false);
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalTls === undefined) delete process.env.DATABASE_SSL_MODE; else process.env.DATABASE_SSL_MODE = originalTls;
    await pool?.end(); await auditPool?.end();
    await admin.query("ROLLBACK");
    for (const table of ["clinical_audit_events", "clinical_request_keys", "appointments", "patients", "practices"]) {
      await admin.query(`DELETE FROM ${table} WHERE ${table === "practices" ? "id" : "practice_id"} = ANY($1::uuid[])`, [[a.practiceId, b.practiceId]]);
    }
    for (const [name, created] of [[role, runtimeCreated], [reviewer, reviewerCreated]] as const) {
      if (created) { await admin.query(`DROP OWNED BY ${name}`); await admin.query(`DROP ROLE ${name}`); }
    }
    await admin.end();
  }
});

test("clinical runtime provisioning rejects elevated roles, owners, unsafe memberships, and audit readers", { skip: !url }, async (context) => {
  localTarget();
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const cases = [
    ["superuser", "ALTER ROLE {role} SUPERUSER"], ["bypassrls", "ALTER ROLE {role} BYPASSRLS"],
    ["createrole", "ALTER ROLE {role} CREATEROLE"], ["createdb", "ALTER ROLE {role} CREATEDB"],
    ["replication", "ALTER ROLE {role} REPLICATION"],
    ["table owner", "ALTER TABLE patients OWNER TO {role}"],
    ["database owner", "ALTER DATABASE careiq_test OWNER TO {role}"],
    ["schema owner", "ALTER SCHEMA public OWNER TO {role}"],
    ["audit reader", "GRANT careiq_audit_reader TO {role}"],
    ["all data reader", "GRANT pg_read_all_data TO {role} WITH INHERIT FALSE, SET FALSE"],
    ["server file reader", "GRANT pg_read_server_files TO {role} WITH INHERIT FALSE, SET FALSE"],
    ["clinical delete", "GRANT DELETE ON patients TO {role}"],
    ["audit column reader", "GRANT SELECT (actor_user_id) ON clinical_audit_events TO {role}"],
    ["key column update", "GRANT UPDATE (request_hash) ON clinical_request_keys TO {role}"],
  ];
  try {
    for (const [name, statement] of cases) await context.test(name, async () => {
      const role = `careiq_unsafe_clinical_${randomBytes(6).toString("hex")}`;
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
        await client.query(statement.replaceAll("{role}", role).replace("careiq_test", new URL(url!).pathname.slice(1)));
        await assert.rejects(client.query(withoutTransaction(await readGrant("grant-clinical-runtime", "runtime_role", role))), (error: unknown) => (error as { code?: string }).code === "P0001");
      } finally { await client.query("ROLLBACK"); client.release(); }
      assert.equal((await admin.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [role])).rowCount, 0);
    });
  } finally { await admin.end(); }
});

test("audit reviewer provisioning rejects direct and indirect clinical access", { skip: !url }, async (context) => {
  localTarget();
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const cases = [
    ["direct patient reads", "SELECT ON patients", false],
    ["direct patient writes", "INSERT ON patients", false],
    ["patient column reads", "SELECT (first_name) ON patients", false],
    ["marketing column reads", "SELECT (email) ON marketing_interview_requests", false],
    ["custom group clinical access without current INHERIT or SET", "SELECT ON appointments", true],
  ] as const;
  try {
    for (const [name, privilege, indirect] of cases) await context.test(name, async () => {
      const reviewer = `careiq_unsafe_reviewer_${randomBytes(6).toString("hex")}`;
      const related = `careiq_reader_group_${randomBytes(6).toString("hex")}`;
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE ROLE ${reviewer} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
        if (indirect) {
          await client.query(`CREATE ROLE ${related} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
          await client.query(`GRANT ${related} TO ${reviewer} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
        }
        await client.query(`GRANT ${privilege} TO ${indirect ? related : reviewer}`);
        await assert.rejects(client.query(withoutTransaction(await readGrant("grant-audit-reader", "audit_reader_role", reviewer))), (error: unknown) => {
          const failure = error as { code?: string; message?: string };
          return failure.code === "P0001" && /clinical or marketing table access/.test(failure.message ?? "");
        });
      } finally { await client.query("ROLLBACK"); client.release(); }
      assert.equal((await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [[reviewer, related]])).rowCount, 0);
    });
  } finally { await admin.end(); }
});
