import { isolatedTestDatabaseUrl } from "./local-test-database.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { verifyDatabaseRelease } from "../src/db/release-check.js";

const url = isolatedTestDatabaseUrl();
test("restricted release verifier checks actual role/RLS metadata and transitive privileges", { skip: !url }, async () => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.equal(target.pathname, "/careiq_test"); assert.equal(target.search, "");
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const role = `careiq_release_${randomBytes(6).toString("hex")}`;
  const other = `careiq_release_other_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(20).toString("hex");
  let runtime: Pool | undefined;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    const grant = (await readFile(new URL("../src/db/grant-clinical-runtime.sql", import.meta.url), "utf8")).replace(/^\\set .*$/m, "").replace(":'runtime_role'", `'${role}'`);
    await admin.query(grant);
    const runtimeUrl = new URL(target); runtimeUrl.username = role; runtimeUrl.password = password;
    runtime = new Pool({ connectionString: runtimeUrl.href, ssl: false, max: 1 });
    await verifyDatabaseRelease(runtime);
    await assert.rejects(verifyDatabaseRelease(admin), /privileged|restricted/);
    // Use actual catalog results, replacing one value at a time. No global policy/ACL
    // mutation can interfere with other integration tests or the review workspace.
    for (const fault of ["forced RLS", "policy", "helper search path", "audit SELECT", "column UPDATE", "constraint", "constraint table", "constraint definition", "activation trigger", "trigger event", "trigger function", "predefined role"]) {
      const proxy = { query: async (sql: any, args: any) => {
        const result = await runtime!.query(sql, args);
        if (fault === "forced RLS" && sql.includes("c.relrowsecurity")) result.rows.find((r: any) => r.relname === "patients").relforcerowsecurity = false;
        if (fault === "policy" && sql.includes("FROM pg_policies")) result.rows.find((r: any) => r.tablename === "patients").qual = "true";
        if (fault === "helper search path" && sql.includes("p.prosrc")) result.rows[0].proconfig = null;
        if (fault === "audit SELECT" && sql.includes("c.relrowsecurity")) result.rows.find((r: any) => r.relname === "clinical_audit_events").can_select = true;
        if (fault === "column UPDATE" && sql.includes("bool_or")) result.rows.find((r: any) => r.relname === "patients").can_update = true;
        if (fault === "constraint" && sql.includes("FROM pg_constraint")) result.rows[0].convalidated = false;
        if (fault === "constraint table" && sql.includes("FROM pg_constraint")) result.rows[0].relname = "same_named_constraint_elsewhere";
        if (fault === "constraint definition" && sql.includes("FROM pg_constraint")) result.rows[0].definition = "CHECK (true)";
        if (fault === "activation trigger" && sql.includes("FROM pg_trigger")) result.rows[0].tgenabled = "D";
        if (fault === "trigger event" && sql.includes("FROM pg_trigger")) result.rows[0].definition = result.rows[0].definition.replace("BEFORE UPDATE", "AFTER UPDATE");
        if (fault === "trigger function" && sql.includes("FROM pg_trigger")) result.rows[0].proname = "different_function";
        if (fault === "predefined role" && sql.includes("FROM pg_roles r WHERE")) result.rows.push({ rolname: "pg_signal_backend" });
        return result;
      } };
      await assert.rejects(verifyDatabaseRelease(proxy as any), undefined, fault);
    }
    await admin.query(`CREATE ROLE ${other} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`GRANT SELECT(actor_user_id) ON clinical_audit_events TO ${other}`);
    await admin.query(`GRANT ${other} TO ${role} WITH INHERIT FALSE, SET FALSE, ADMIN TRUE`);
    await assert.rejects(verifyDatabaseRelease(runtime), /protected columns/);
  } finally {
    await runtime?.end();
    await admin.query(`REVOKE ${other} FROM ${role}`).catch(() => {});
    for (const name of [other, role]) {
      await admin.query(`DROP OWNED BY ${name}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${name}`);
    }
    await admin.end();
  }
});

test("hardened location RLS does not accept temporary-table shadows of enrollment or assignments", { skip: !url }, async () => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname)); assert.equal(target.pathname, "/careiq_test"); assert.equal(target.search, "");
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const role = `careiq_shadow_${randomBytes(6).toString("hex")}`, password = randomBytes(20).toString("hex");
  const practice = randomUUID(), location = randomUUID(), user = `user_${randomBytes(8).toString("hex")}`;
  let runtime: Pool | undefined;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
    await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic release test','location')", [practice, `org_${randomBytes(8).toString("hex")}`]);
    await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic','UTC')", [location, practice]);
    await admin.query("INSERT INTO patients(practice_id,location_id,first_name,last_name) VALUES($1,$2,'Synthetic','Denied')", [practice, location]);
    const runtimeUrl = new URL(target); runtimeUrl.username = role; runtimeUrl.password = password;
    runtime = new Pool({ connectionString: runtimeUrl.href, ssl: false, max: 1 });
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [practice, location, user]);
    await runtime.query("CREATE TEMP TABLE practices(id uuid,status text,authorization_mode text); CREATE TEMP TABLE practice_member_access(practice_id uuid,user_id text,status text); CREATE TEMP TABLE location_assignments(practice_id uuid,user_id text,location_id uuid,active boolean); CREATE TEMP TABLE locations(id uuid,practice_id uuid,status text)");
    await runtime.query("INSERT INTO pg_temp.practices VALUES($1,'active','location')", [practice]);
    await runtime.query("INSERT INTO pg_temp.practice_member_access VALUES($1,$2,'active')", [practice, user]);
    await runtime.query("INSERT INTO pg_temp.location_assignments VALUES($1,$2,$3,true)", [practice, user, location]);
    await runtime.query("INSERT INTO pg_temp.locations VALUES($1,$2,'active')", [location, practice]);
    assert.equal((await runtime.query("SELECT public.careiq_clinical_scope($1,$2) AS allowed", [practice, location])).rows[0].allowed, false);
    assert.equal((await runtime.query("SELECT count(*)::int AS count FROM public.patients WHERE practice_id=$1", [practice])).rows[0].count, 0);
    await runtime.query("ROLLBACK");
  } finally {
    await runtime?.end();
    await admin.query("DELETE FROM patients WHERE practice_id=$1", [practice]);
    await admin.query("DELETE FROM locations WHERE practice_id=$1", [practice]);
    await admin.query("DELETE FROM practices WHERE id=$1", [practice]);
    await admin.query(`DROP OWNED BY ${role}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  }
});
