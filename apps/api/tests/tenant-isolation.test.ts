import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;

test("tenant reads, writes, references, and empty context are isolated", { skip: !url }, async () => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "Use a disposable local database.");
  assert.ok(["/careiq_review", "/careiq_test"].includes(target.pathname), "Use careiq_review or careiq_test.");
  const pool = new Pool({ connectionString: url, ssl: false });
  const client = await pool.connect();
  const role = `careiq_test_${randomBytes(8).toString("hex")}`;
  const a = randomUUID(), b = randomUUID(), patientA = randomUUID(), patientB = randomUUID();
  const appointmentA = randomUUID(), appointmentB = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON practices, patients, appointments TO ${role}`);
    const security = await client.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('patients'::regclass, 'appointments'::regclass)");
    assert.equal(security.rowCount, 2);
    for (const table of security.rows) assert.ok(table.relrowsecurity && table.relforcerowsecurity);
    await client.query(`SET LOCAL ROLE ${role}`);
    const context = async (id: string) => client.query("SELECT set_config('app.practice_id', $1, true)", [id]);
    const blocked = async (query: string, params: unknown[], code: string) => {
      await client.query("SAVEPOINT denial");
      try {
        await assert.rejects(client.query(query, params), (error: unknown) => (error as { code?: string }).code === code);
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT denial");
        await client.query("RELEASE SAVEPOINT denial");
      }
    };
    for (const [practice, patient, appointment] of [[a, patientA, appointmentA], [b, patientB, appointmentB]]) {
      await context(practice);
      await client.query("INSERT INTO practices (id, clerk_org_id, name) VALUES ($1, $2, 'Disposable demo')", [practice, `test_${practice}`]);
      await client.query("INSERT INTO patients (id, practice_id, first_name, last_name) VALUES ($1, $2, 'Demo', 'Patient')", [patient, practice]);
      await client.query("INSERT INTO appointments (id, practice_id, patient_id, scheduled_at) VALUES ($1, $2, $3, now())", [appointment, practice, patient]);
    }
    for (const [own, other, ownPatient, otherPatient, ownAppointment, otherAppointment] of [
      [a, b, patientA, patientB, appointmentA, appointmentB],
      [b, a, patientB, patientA, appointmentB, appointmentA],
    ]) {
      await context(own);
      assert.equal((await client.query("SELECT id FROM appointments WHERE id=$1", [ownAppointment])).rowCount, 1);
      assert.equal((await client.query("SELECT id FROM appointments WHERE id=$1", [otherAppointment])).rowCount, 0);
      assert.equal((await client.query("SELECT id FROM patients WHERE id=$1", [otherPatient])).rowCount, 0);
      assert.equal((await client.query("UPDATE appointments SET reason='forbidden' WHERE id=$1", [otherAppointment])).rowCount, 0);
      assert.equal((await client.query("DELETE FROM appointments WHERE id=$1", [otherAppointment])).rowCount, 0);
      await blocked("INSERT INTO appointments (practice_id, patient_id, scheduled_at) VALUES ($1, $2, now())", [other, otherPatient], "42501");
      await blocked("INSERT INTO appointments (practice_id, patient_id, scheduled_at) VALUES ($1, $2, now())", [own, otherPatient], "23503");
      await blocked("INSERT INTO patients (practice_id, first_name, last_name) VALUES ($1, 'Demo', 'Forbidden')", [other], "42501");
      assert.equal((await client.query("SELECT id FROM patients WHERE id=$1", [ownPatient])).rowCount, 1);
    }
    await context("");
    assert.equal((await client.query("SELECT id FROM patients")).rowCount, 0);
    assert.equal((await client.query("SELECT id FROM appointments")).rowCount, 0);
    await blocked("INSERT INTO patients (practice_id, first_name, last_name) VALUES ($1, 'Demo', 'Missing context')", [a], "42501");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
