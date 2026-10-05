import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { assertCurrentEnrollment, assertOwner, assertRoleGrant, currentCapabilities, parseLocation } from "../src/services/practice-policy.js";

const url = process.env.TEST_DATABASE_URL;
test("fresh permissions never infer clinical authority from admin or member roles", () => {
  for (const role of ["org:admin", "org:member"]) assert.deepEqual(currentCapabilities({ id: "m", userId: "u", role, permissions: [] }), { patients: { read: false, create: false }, appointments: { read: false, create: false } });
  assert.equal(currentCapabilities({ id: "m", userId: "u", role: "org:clinician", permissions: ["org:patients:read"] }).patients.read, true);
  assert.throws(() => assertCurrentEnrollment({ membership_id: "old", status: "active" }, { id: "new", userId: "u", role: "org:admin", permissions: [] }), /ENROLLMENT REQUIRED/);
  assert.throws(() => assertCurrentEnrollment({ membership_id: "m", status: "suspended" }, { id: "m", userId: "u", role: "org:admin", permissions: [] }), /ENROLLMENT REQUIRED/);
  assert.throws(() => assertOwner({ owner_user_id: "owner" }, "other", { id: "m", userId: "other", role: "org:admin", permissions: [] }), /OWNER REQUIRED/);
  assert.throws(() => assertRoleGrant("u", "u", "org:member", "org:admin", ["org:admin"]), /SELF ROLE CHANGE FORBIDDEN/);
  assert.throws(() => parseLocation({ name: "Clinic", timeZone: "Invalid/Zone" }), /INVALID TIME ZONE/);
});

test("location clinical services and raw RLS enforce assignments, composite FKs, audit, retry isolation, and revocation", { skip: !url }, async (context) => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.ok(["/careiq_test", "/careiq_review"].includes(target.pathname));
  assert.equal(target.search, "");
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const role = `careiq_location_test_${randomBytes(6).toString("hex")}`, password = randomBytes(20).toString("hex");
  const p = randomUUID(), otherP = randomUUID(), a = randomUUID(), b = randomUUID();
  const user = `user_${randomUUID()}`, otherUser = `user_${randomUUID()}`;
  const member = `mem_${randomUUID()}`, otherMember = `mem_${randomUUID()}`;
  let runtime: Pool | undefined;
  let createdRole = false;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`); createdRole = true;
    const grant = (await readFile(new URL("../src/db/grant-clinical-runtime.sql", import.meta.url), "utf8")).replace(/^\\set .*$/m, "").replace(":'runtime_role'", `'${role}'`);
    await admin.query(grant);
    await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,owner_user_id) VALUES($1,$2,'Location test','location',$3),($4,$5,'Other test','location',$3)", [p, `org_${p}`, user, otherP, `org_${otherP}`]);
    await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'A','UTC'),($2,$3,'B','UTC')", [a, b, p]);
    await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active'),($1,$4,$5,'active')", [p, user, member, otherUser, otherMember]);
    for (const actor of [user, otherUser]) for (const location of [a, b]) await admin.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)", [p, actor, location]);
    const runtimeUrl = new URL(target); runtimeUrl.username = role; runtimeUrl.password = password;
    process.env.DATABASE_URL = runtimeUrl.href; process.env.DATABASE_SSL_MODE = "disable";
    ({ pool: runtime } = await import("../src/db/client.js"));
    const { createPatient, listPatients } = await import("../src/services/patient.service.js");
    const { createAppointment } = await import("../src/services/appointment.service.js");
    const ta = { practiceId: p, orgId: `org_${p}`, userId: user, locationId: a, membershipId: member };
    const tb = { ...ta, locationId: b };
    const tc = { ...ta, userId: otherUser, membershipId: otherMember };
    const input = { firstName: "Synthetic", lastName: "Location" }, key = randomUUID();
    let patientA = "", patientB = "";
    await context.test("identical simultaneous retries create once; each actor and location have independent scope", async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => createPatient(ta, input, key)));
      assert.equal(new Set(results.map((r) => r.id)).size, 1); patientA = results[0].id;
      patientB = (await createPatient(tb, input, key)).id;
      const actorPatient = await createPatient(tc, input, key);
      assert.equal(new Set([patientA, patientB, actorPatient.id]).size, 3);
      assert.equal((await listPatients(ta)).length, 2); assert.equal((await listPatients(tb)).length, 1);
      await assert.rejects(createPatient(ta, { ...input, lastName: "Changed" }, key), /IDEMPOTENCY_KEY_REUSED/);
    });
    await context.test("cross-location patient substitution fails; audit identifies exact actor and location", async () => {
      await assert.rejects(createAppointment(tb, { patientId: patientA, scheduledAt: new Date() }), /PATIENT_NOT_FOUND/);
      const appointment = await createAppointment(ta, { patientId: patientA, scheduledAt: new Date() });
      assert.equal(appointment.locationId, a);
      await assert.rejects(admin.query("INSERT INTO appointments(practice_id,location_id,patient_id,scheduled_at) VALUES($1,$2,$3,now())", [p, b, patientA]), (error: any) => error.code === "23503");
      await assert.rejects(admin.query("INSERT INTO patients(practice_id,location_id,first_name,last_name) VALUES($1,$2,'Cross','Practice')", [otherP, a]), (error: any) => error.code === "23503");
      const events = (await admin.query("SELECT actor_user_id,location_id FROM clinical_audit_events WHERE practice_id=$1", [p])).rows;
      assert.ok(events.length > 4); assert.ok(events.every((event) => [user, otherUser].includes(event.actor_user_id) && [a, b].includes(event.location_id)));
    });
    await context.test("raw restricted SQL with missing, invalid, closed, foreign, or unassigned context returns no clinical rows", async () => {
      const client = await runtime!.connect();
      try {
        for (const [practice, actor, location] of [[p, user, ""], [p, "", a], [p, "missing_actor", a], [otherP, user, a], [p, user, "invalid"]]) {
          await client.query("BEGIN"); await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.actor_user_id',$2,true),set_config('app.location_id',$3,true)", [practice, actor, location]);
          assert.equal((await client.query("SELECT id FROM patients")).rowCount, 0);
          assert.equal((await client.query("SELECT resource_id FROM clinical_request_keys")).rowCount, 0);
          await assert.rejects(client.query("INSERT INTO patients(practice_id,location_id,first_name,last_name) VALUES($1,$2,'Blocked','Write')", [p, a]), (error: any) => error.code === "42501");
          await client.query("ROLLBACK");
        }
        assert.equal((await client.query("SELECT id FROM patients")).rowCount, 0);
        assert.equal((await client.query("SELECT nullif(current_setting('app.actor_user_id',true),'') AS actor")).rows[0].actor, null);
        await assert.rejects(client.query("SELECT * FROM clinical_audit_events"), (error: any) => error.code === "42501");
        await assert.rejects(client.query("SELECT * FROM practice_admin_events"), (error: any) => error.code === "42501");
      } finally { await client.query("ROLLBACK"); client.release(); }
    });
    await context.test("suspension, changed provider membership, and closed locations deny stored retries as well as fresh writes", async () => {
      await admin.query("UPDATE practice_member_access SET status='suspended' WHERE practice_id=$1 AND user_id=$2", [p, user]);
      await assert.rejects(createPatient(ta, input, key), /LOCATION_ACCESS_DENIED/);
      await admin.query("UPDATE practice_member_access SET status='active' WHERE practice_id=$1 AND user_id=$2", [p, user]);
      await assert.rejects(listPatients({ ...ta, membershipId: "stale_member" }), /LOCATION_ACCESS_DENIED/);
      await admin.query("UPDATE locations SET status='closed' WHERE id=$1", [a]);
      await assert.rejects(createPatient(ta, input, key), /LOCATION_ACCESS_DENIED/);
      await admin.query("UPDATE locations SET status='active' WHERE id=$1", [a]);
      await admin.query("UPDATE location_assignments SET active=false WHERE practice_id=$1 AND user_id=$2 AND location_id=$3", [p, user, a]);
      await assert.rejects(listPatients(ta), /LOCATION_ACCESS_DENIED/);
      await admin.query("UPDATE location_assignments SET active=true WHERE practice_id=$1 AND user_id=$2 AND location_id=$3", [p, user, a]);
    });
    await context.test("unattributable historic retry keys conflict without returning a resource or duplicating a write", async () => {
      const historical = randomUUID();
      await admin.query("INSERT INTO clinical_request_keys(practice_id,operation,request_key,request_hash,resource_id) VALUES($1,'patients.create',$2,repeat('a',64),$3)", [p, historical, patientA]);
      const client = await runtime!.connect();
      try {
        await client.query("BEGIN"); await client.query("SELECT set_config('app.practice_id',$1,true)",[p]);
        assert.equal((await client.query("SELECT resource_id FROM clinical_request_keys")).rowCount,0);
      } finally { await client.query("ROLLBACK"); client.release(); }
      const count = (await admin.query("SELECT count(*) FROM patients WHERE practice_id=$1", [p])).rows[0].count;
      await assert.rejects(createPatient(tb, input, historical), /HISTORIC_IDEMPOTENCY_CONFLICT/);
      assert.equal((await admin.query("SELECT count(*) FROM patients WHERE practice_id=$1", [p])).rows[0].count, count);
    });
    await context.test("location retry records require a non-null actor even for the database owner", async () => {
      await assert.rejects(admin.query("INSERT INTO clinical_request_keys(practice_id,location_id,actor_user_id,operation,request_key,request_hash,resource_id) VALUES($1,$2,NULL,'patients.create',$3,repeat('a',64),$4)", [p,a,randomUUID(),patientA]), (error: any) => error.code === "23514");
    });
    await context.test("legacy writes hold the practice lock and cannot slip an unmapped record past activation", async () => {
      const legacy = randomUUID(), legacyLocation = randomUUID();
      await admin.query("INSERT INTO practices(id,clerk_org_id,name,owner_user_id) VALUES($1,$2,'Activation test',$3)", [legacy,`org_${legacy}`,user]);
      await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Reviewed','UTC')", [legacyLocation,legacy]);
      await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [legacy,user,`activation_${member}`]);
      const { withTenant } = await import("../src/db/with-tenant.js");
      const { sql } = await import("drizzle-orm");
      let releaseWrite!: () => void, enteredWrite!: () => void;
      const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
      const hold = new Promise<void>((resolve) => { releaseWrite = resolve; });
      const write = withTenant({ practiceId: legacy, userId: user, orgId: `org_${legacy}` }, async (tx) => {
        await tx.execute(sql`insert into patients(practice_id,first_name,last_name) values(${legacy},'Pending','Legacy')`);
        enteredWrite(); await hold;
      });
      await entered;
      const operator = new Pool({ connectionString: url, ssl: false, max: 1 });
      try {
        await operator.query("BEGIN"); await operator.query("SET LOCAL lock_timeout='100ms'"); await operator.query("SET LOCAL careiq.rollout_reviewed='true'");
        await assert.rejects(operator.query("UPDATE practices SET authorization_mode='location' WHERE id=$1", [legacy]), (error: any) => error.code === "55P03");
        await operator.query("ROLLBACK"); releaseWrite(); await write;
        await operator.query("BEGIN"); await operator.query("SET LOCAL careiq.rollout_reviewed='true'");
        await assert.rejects(operator.query("UPDATE practices SET authorization_mode='location' WHERE id=$1", [legacy]), /complete verified clinical mappings/);
        await operator.query("ROLLBACK");
      } finally {
        releaseWrite(); await write; await operator.end();
        await admin.query("DELETE FROM patients WHERE practice_id=$1",[legacy]);
        await admin.query("DELETE FROM practice_member_access WHERE practice_id=$1",[legacy]);
        await admin.query("DELETE FROM locations WHERE practice_id=$1",[legacy]);
        await admin.query("DELETE FROM practices WHERE id=$1",[legacy]);
      }
    });
    await context.test("migration mode cannot be rolled back and runtime cannot activate old practices", async () => {
      await assert.rejects(admin.query("UPDATE practices SET authorization_mode='legacy' WHERE id=$1", [p]), /cannot be rolled back/);
      await assert.rejects(runtime!.query("UPDATE practices SET authorization_mode='location' WHERE id=$1", [p]), (error: any) => error.code === "42501");
    });
  } finally {
    await runtime?.end();
    for (const table of ["clinical_audit_events", "clinical_request_keys", "appointments", "patients", "practice_admin_events", "practice_provider_events", "location_assignments", "practice_member_access", "locations"]) await admin.query(`DELETE FROM ${table} WHERE practice_id=ANY($1::uuid[])`, [[p, otherP]]);
    await admin.query("DELETE FROM practices WHERE id=ANY($1::uuid[])", [[p, otherP]]);
    if (createdRole) { await admin.query(`DROP OWNED BY ${role}`); await admin.query(`DROP ROLE ${role}`); }
    await admin.end();
  }
});
