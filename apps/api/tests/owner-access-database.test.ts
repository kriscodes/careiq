import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { isolatedTestDatabaseUrl } from "./local-test-database.js";
import { verifyOwnerAccessDatabaseRelease } from "../src/db/owner-access-release-check.js";

const url = isolatedTestDatabaseUrl();
const permissionKeys = ["org:patients:read", "org:patients:create", "org:patients:update", "org:appointments:read", "org:appointments:create", "org:appointments:update", "org:documents:read", "org:documents:upload", "org:documents:review", "org:documents:archive", "org:requests:send", "org:requirements:waive", "org:requirements:manage", "org:work:manage", "org:workflow:configure", "org:paperwork:manage", "org:activity:read"];
const pgCode = (expected: string) => (cause: unknown) => Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === expected);

test("owner preferences retain actor/practice isolation and restricted database authority", { skip: !url }, async context => {
  const admin = new Pool({ connectionString: url, ssl: false });
  const suffix = randomBytes(10).toString("hex"), role = `careiq_owner_test_${suffix}`, password = randomBytes(20).toString("hex");
  const owner = `user_Owner${suffix}`, other = `user_Other${suffix}`, practices = [randomUUID(), randomUUID()];
  let runtime: Pool | undefined, createdRole = false;
  async function scoped<T>(practice: string | null, actor: string | null, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await runtime!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.actor_user_id',$2,true),set_config('app.location_id','',true)", [practice ?? "", actor ?? ""]);
      const result = await operation(client); await client.query("COMMIT"); return result;
    } catch (cause) { await client.query("ROLLBACK"); throw cause; }
    finally { client.release(); }
  }
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`); createdRole = true;
    await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
    const target = new URL(url!); target.username = role; target.password = password;
    runtime = new Pool({ connectionString: target.href, ssl: false, max: 1 });
    for (const practiceId of practices) {
      await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status,owner_user_id) VALUES($1,$2,'Synthetic owner preferences','location','active',$3)", [practiceId, `org_${randomUUID()}`, owner]);
      for (const user of [owner, other]) await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practiceId, user, `mem_${randomUUID()}`]);
    }
    await context.test("the reviewed migration initializes only active owners, preserves grants and attributes its audit to the system", async () => {
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE practices SET status='suspended' WHERE id=$1", [practices[1]]);
        const active = [randomUUID(), randomUUID()], closed = randomUUID();
        for (const [id, status] of [...active.map(id => [id, "active"]), [closed, "closed"]]) await client.query("INSERT INTO locations(id,practice_id,name,time_zone,status) VALUES($1,$2,'Synthetic migration location','UTC',$3)", [id, practices[0], status]);
        await client.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,false,$4),($1,$4,$3,true,$4)", [practices[0], owner, active[0], other]);
        const source = await readFile(new URL("../drizzle/0045_owner_operator_access.sql", import.meta.url), "utf8");
        const backfill = source.split("--> statement-breakpoint")[1]!;
        assert.equal(backfill.split("AND m.status='active'").length, 3);
        // Exercise the reviewed migration statements with an additional fixture-only
        // predicate. Other tests' practice metadata is never selected or changed.
        const bounded = backfill.replaceAll("AND m.status='active'", "AND m.status='active' AND p.id=ANY($1::uuid[])");
        for (const statement of bounded.replace(/^--.*$/gm, "").split(";").filter(value => value.trim())) await client.query(statement, [practices]);
        const profiles = (await client.query("SELECT practice_id,owner_user_id,all_locations,disabled_permissions FROM practice_owner_access WHERE practice_id=ANY($1::uuid[])", [practices])).rows;
        assert.equal(profiles.length, 1); assert.equal(profiles[0].owner_user_id, owner); assert.equal(profiles[0].all_locations, true); assert.deepEqual(profiles[0].disabled_permissions, []);
        const assigned = (await client.query("SELECT user_id,location_id,active,granted_by FROM location_assignments WHERE practice_id=ANY($1::uuid[]) ORDER BY user_id,location_id", [practices])).rows;
        assert.equal(assigned.length, 3); assert.equal(assigned.filter(row => row.user_id === owner && row.active).length, 2);
        assert.equal(assigned.find(row => row.user_id === owner && row.location_id === active[0]).granted_by, other);
        assert.equal(assigned.filter(row => row.user_id === other && row.active).length, 1);
        assert.equal(assigned.some(row => row.location_id === closed), false);
        const events = (await client.query("SELECT actor_user_id,action,subject_id FROM practice_admin_events WHERE practice_id=ANY($1::uuid[])", [practices])).rows;
        assert.deepEqual(events, [{ actor_user_id: "system:owner-operator-migration", action: "owner.operator_access_initialized", subject_id: owner }]);
        assert.equal((await client.query("SELECT count(*)::int AS count FROM practice_member_access WHERE practice_id=ANY($1::uuid[]) AND status='active'", [practices])).rows[0].count, 4);
      } finally { await client.query("ROLLBACK"); client.release(); }
    });
    await context.test("managed-owner repair obeys forced RLS, preserves saved narrowing and restores context", async () => {
      const client = await admin.connect();
      const active = randomUUID(), narrow = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic managed seed','UTC'),($3,$4,'Synthetic saved narrowing','UTC')", [active, practices[0], narrow, practices[1]]);
        await client.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,false,$4)", [practices[0], owner, active, other]);
        await client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id,disabled_permissions,all_locations) VALUES($1,$2,ARRAY['org:patients:create'],false)", [practices[1], owner]);
        await client.query("SELECT set_config('app.practice_id','',true),set_config('app.actor_user_id','synthetic-original-context',true)");
        await client.query(`SET LOCAL ROLE ${role}`);
        const identity = (await client.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
        assert.equal(identity.rolsuper, false); assert.equal(identity.rolbypassrls, false);
        const source = await readFile(new URL("../drizzle/0047_managed_owner_availability.sql", import.meta.url), "utf8");
        // Restrict the real reconciliation block to these synthetic fixtures only.
        const backfill = source.split("--> statement-breakpoint")[0]!.replace("owner_user_id IS NOT NULL", `owner_user_id IS NOT NULL AND id IN ('${practices[0]}','${practices[1]}')`);
        await client.query(backfill); await client.query(backfill);
        const restored = (await client.query("SELECT current_setting('app.practice_id') AS practice,current_setting('app.actor_user_id') AS actor")).rows[0];
        assert.deepEqual(restored, { practice: "", actor: "synthetic-original-context" });
        await client.query("RESET ROLE");
        const profiles = (await client.query("SELECT practice_id,all_locations,disabled_permissions FROM practice_owner_access WHERE practice_id=ANY($1::uuid[])", [practices])).rows;
        assert.equal(profiles.length, 2);
        assert.equal(profiles.find(row => row.practice_id === practices[0]).all_locations, true);
        assert.deepEqual(profiles.find(row => row.practice_id === practices[1]), { practice_id: practices[1], all_locations: false, disabled_permissions: ["org:patients:create"] });
        const assignments = (await client.query("SELECT practice_id,active,granted_by FROM location_assignments WHERE practice_id=ANY($1::uuid[])", [practices])).rows;
        assert.deepEqual(assignments, [{ practice_id: practices[0], active: true, granted_by: other }]);
        const events = (await client.query("SELECT actor_user_id,action,subject_id FROM practice_admin_events WHERE practice_id=ANY($1::uuid[])", [practices])).rows;
        assert.deepEqual(events, [{ actor_user_id: "system:owner-operator-migration", action: "owner.operator_access_initialized", subject_id: owner }]);
      } finally { await client.query("ROLLBACK"); client.release(); }
    });
    await context.test("catalog verification accepts the actual restricted runtime and rejects widened boundaries", async () => {
      await verifyOwnerAccessDatabaseRelease(runtime!);
      for (const fault of ["forced RLS", "PUBLIC grants", "table UPDATE", "identity UPDATE", "default", "policy", "extra policy", "constraint", "foreign key"]) {
        const proxy = { query: async (sql: string, values?: unknown[]) => {
          const result = await runtime!.query(sql, values);
          if (fault === "forced RLS" && sql.includes("owner_access_metadata")) result.rows[0].relforcerowsecurity = false;
          if (fault === "PUBLIC grants" && sql.includes("owner_access_metadata")) result.rows[0].public_access = true;
          if (fault === "table UPDATE" && sql.includes("owner_access_metadata")) result.rows[0].excessive = true;
          if (fault === "identity UPDATE" && sql.includes("owner_access_columns")) result.rows.find(row => row.attname === "owner_user_id").can_update = true;
          if (fault === "default" && sql.includes("owner_access_columns")) result.rows.find(row => row.attname === "all_locations").default_value = "false";
          if (fault === "policy" && sql.includes("owner_access_policies")) result.rows[0].using_expression = "true";
          if (fault === "extra policy" && sql.includes("owner_access_policies")) result.rows.push({ ...result.rows[0], polname: "unexpected_bypass" });
          if (fault === "constraint" && sql.includes("owner_access_constraints")) result.rows.find(row => row.conname === "practice_owner_access_permissions_check").definition = "CHECK (true)";
          if (fault === "foreign key" && sql.includes("owner_access_constraints")) result.rows.find(row => row.conname === "practice_owner_access_member_fk").convalidated = false;
          return result;
        } };
        await assert.rejects(verifyOwnerAccessDatabaseRelease(proxy as unknown as Pick<PoolClient, "query">), undefined, fault);
      }
    });
    await context.test("defaults support the owner preset without changing memberships or creating an assignment bypass", async () => {
      await scoped(practices[0]!, owner, client => client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id) VALUES($1,$2)", [practices[0], owner]));
      const row = await scoped(practices[0]!, owner, async client => (await client.query("SELECT * FROM practice_owner_access")).rows[0]);
      assert.deepEqual(row.disabled_permissions, []); assert.equal(row.all_locations, true); assert.equal(row.revision, 0);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM location_assignments WHERE practice_id=ANY($1::uuid[])", [practices])).rows[0].count, 0);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practice_member_access WHERE practice_id=ANY($1::uuid[]) AND status='active'", [practices])).rows[0].count, 4);
    });
    await context.test("another actor, practice and missing context cannot read or forge a preference", async () => {
      for (const [practice, actor] of [[practices[0], other], [practices[1], owner], [null, owner], [practices[0], null]] as const) assert.equal(await scoped(practice!, actor, async client => (await client.query("SELECT * FROM practice_owner_access")).rowCount), 0);
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id) VALUES($1,$2)", [practices[0], other])), pgCode("42501"));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id) VALUES($1,$2)", [practices[1], owner])), pgCode("42501"));
      assert.equal(await scoped(practices[0]!, other, async client => (await client.query("UPDATE practice_owner_access SET revision=revision+1 WHERE owner_user_id=$1", [owner])).rowCount), 0);
    });
    await context.test("only reviewed self restrictions and a nonnegative revision can be persisted", async () => {
      await scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET disabled_permissions=$1,all_locations=false,revision=revision+1 WHERE practice_id=$2 AND owner_user_id=$3", [permissionKeys, practices[0], owner]));
      const row = await scoped(practices[0]!, owner, async client => (await client.query("SELECT disabled_permissions,all_locations,revision FROM practice_owner_access")).rows[0]);
      assert.deepEqual(row.disabled_permissions, permissionKeys); assert.equal(row.all_locations, false); assert.equal(row.revision, 1);
      for (const value of [["org:audit:export"], [null], Array(18).fill("org:patients:read")]) await assert.rejects(scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET disabled_permissions=$1", [value])), pgCode("23514"));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET disabled_permissions=ARRAY[['org:patients:read']]::text[]")));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET revision=-1")), pgCode("23514"));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET disabled_permissions=NULL")), pgCode("23502"));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("UPDATE practice_owner_access SET all_locations=NULL")), pgCode("23502"));
    });
    await context.test("runtime cannot retarget identity, delete preferences or create an un-enrolled profile", async () => {
      for (const sql of ["UPDATE practice_owner_access SET owner_user_id=owner_user_id", "UPDATE practice_owner_access SET practice_id=practice_id", "DELETE FROM practice_owner_access"]) await assert.rejects(scoped(practices[0]!, owner, client => client.query(sql)), pgCode("42501"));
      const absent = `user_Absent${suffix}`;
      await assert.rejects(scoped(practices[0]!, absent, client => client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id) VALUES($1,$2)", [practices[0], absent])), pgCode("23503"));
      await assert.rejects(scoped(practices[0]!, owner, client => client.query("INSERT INTO practice_owner_access(practice_id,owner_user_id) VALUES($1,$2)", [practices[0], owner])), pgCode("23505"));
    });
    await context.test("membership cleanup cascades only preference metadata", async () => {
      await admin.query("DELETE FROM practice_member_access WHERE practice_id=$1 AND user_id=$2", [practices[0], owner]);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practice_owner_access WHERE practice_id=$1", [practices[0]])).rows[0].count, 0);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practices WHERE id=ANY($1::uuid[])", [practices])).rows[0].count, 2);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practice_member_access WHERE practice_id=ANY($1::uuid[])", [practices])).rows[0].count, 3);
    });
  } finally {
    await runtime?.end();
    try {
      await admin.query("DELETE FROM practice_member_access WHERE practice_id=ANY($1::uuid[])", [practices]);
      await admin.query("DELETE FROM practices WHERE id=ANY($1::uuid[])", [practices]);
    } finally {
      if (createdRole) { await admin.query(`DROP OWNED BY ${role}`); await admin.query(`DROP ROLE ${role}`); }
      await admin.end();
    }
  }
});
