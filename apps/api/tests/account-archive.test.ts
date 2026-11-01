import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { isolatedTestDatabaseUrl } from "./local-test-database.js";
import { createAccountLifecycleService, lockActiveAccount } from "../src/services/account-lifecycle.service.js";
import { parseAccountRestoreArguments } from "../src/services/account-restore-policy.js";
import { verifyPersonalAccountArchiveDatabaseRelease } from "../src/db/account-lifecycle-release-check.js";
const auth = (userId: string, age = 0) => ({ isAuthenticated: true, userId, sessionId: "sess_ArchiveTest", sessionClaims: { fva: [age, -1] } });
const code = (expected: string) => (cause: unknown) => Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === expected);
const url = isolatedTestDatabaseUrl();

test("restoration command requires an explicit reviewed identity, reference, environment and exact confirmation", () => {
  const good = ["--user-id", "user_Synthetic", "--reference", "support:review123", "--confirm", "RESTORE", "--environment", "development"];
  assert.deepEqual(parseAccountRestoreArguments(good), { userId: "user_Synthetic", operatorReference: "support:review123", environment: "development", confirmation: "RESTORE" });
  for (const input of [[], good.slice(0, 6), [...good, "--force", "true"], good.map(value => value === "RESTORE" ? "restore" : value), good.map(value => value === "development" ? "prod" : value), good.map(value => value === "user_Synthetic" ? "other" : value), good.map(value => value === "support:review123" ? "private reference\n" : value), ["--user-id", "user_Synthetic", "--user-id", "user_Other", ...good.slice(4)]]) assert.throws(() => parseAccountRestoreArguments(input), /RESTORE_ARGUMENTS_INVALID/);
});

test("immediate account archive denies existing tokens, confirms provider ban and restores safely", { skip: !url }, async context => {
  const admin = new Pool({ connectionString: url, ssl: false });
  const role = `careiq_archive_test_${randomBytes(6).toString("hex")}`, password = randomBytes(20).toString("hex");
  const tag = randomBytes(8).toString("hex"), actors: string[] = [], practices: string[] = [];
  let runtime: Pool | undefined;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
    const target = new URL(url!); target.username = role; target.password = password;
    runtime = new Pool({ connectionString: target.href, ssl: false, max: 4 });
    const transaction = async <T>(practiceId: string | null, actor: string, operation: (client: PoolClient) => Promise<T>) => {
      const client = await runtime!.connect();
      try { await client.query("BEGIN"); await client.query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.practice_id',$2,true)", [actor, practiceId ?? ""]); const result = await operation(client); await client.query("COMMIT"); return result; }
      catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
    };
    const fresh = (suffix: string) => { const user = `user_${suffix}${tag}`; actors.push(user); return user; };
    const bans: string[] = [], unbans: string[] = [];
    let failBan = false, failUnban = false, wrongBan = false;
    let pendingBan: Promise<void> | null = null, pendingUnban: Promise<void> | null = null;
    const provider = {
      banUser: async (userId: string) => { bans.push(userId); if (pendingBan) await pendingBan; if (failBan) throw new Error("Synthetic provider diagnostic must remain private"); return { id: wrongBan ? "user_Wrong" : userId, banned: true }; },
      unbanUser: async (userId: string) => { unbans.push(userId); if (pendingUnban) await pendingUnban; if (failUnban) throw new Error("Synthetic private provider error"); return { id: userId, banned: false }; },
    };
    const service = createAccountLifecycleService(transaction, provider);
    await context.test("archive catalog checks cover actor RLS, evidence immutability and narrow status updates", async () => {
      await verifyPersonalAccountArchiveDatabaseRelease(runtime!);
      for (const fault of ["RLS", "event update", "policy"]) {
        const proxy = { query: async (sql: any, args: any) => { const result = await runtime!.query(sql, args);
          if (fault === "RLS" && sql.includes("c.relrowsecurity")) result.rows[0].relforcerowsecurity = false;
          if (fault === "event update" && sql.includes("GROUP BY c.relname,a.attname")) result.rows.find((row: any) => row.relname === "personal_account_events").can_update = true;
          if (fault === "policy" && sql.includes("pg_policies")) result.rows[0].qual = "true";
          return result;
        } };
        await assert.rejects(verifyPersonalAccountArchiveDatabaseRelease(proxy as any), undefined, fault);
      }
    });
    await context.test("exact confirmation and fresh verified factor precede every archive and cannot target others", async () => {
      const user = fresh("Input");
      for (const input of [null, [], {}, { confirmation: "archive" }, { confirmation: " ARCHIVE" }, { confirmation: "ARCHIVE ", userId: user }, { confirmation: "ARCHIVE", userId: "user_Other" }, { confirmation: "ARCHIVE", extra: true }]) await assert.rejects(service.archive(auth(user), input));
      for (const age of [5, 6, -1, NaN, Infinity]) await assert.rejects(service.archive(auth(user, age), { confirmation: "ARCHIVE" }), code("RECENT_AUTHENTICATION_REQUIRED"));
      assert.equal(bans.length, 0); assert.equal((await service.state(auth(user))).account.status, "active");
    });
    await context.test("all owned practices block immediate archive, regardless of active organization or practice status", async () => {
      const user = fresh("Owner");
      for (const status of ["active", "pending", "suspended"]) { const id = randomUUID(); practices.push(id); await admin.query("INSERT INTO practices(id,clerk_org_id,name,status,owner_user_id) VALUES($1,$2,'Synthetic archive guard',$3,$4)", [id, `org_${randomUUID()}`, status, user]); }
      await assert.rejects(service.archive(auth(user), { confirmation: "ARCHIVE" }), code("ACCOUNT_OWNS_PRACTICES")); assert.equal(bans.length, 0); assert.equal((await service.state(auth(user))).account.status, "active");
    });
    await context.test("personal patients and nonowner staff archive their own identity without changing memberships or clinical records", async () => {
      for (const persona of ["Patient", "Admin", "Member", "Clinician", "Pending", "Suspended"]) {
        const user = fresh(persona);
        const identity = { ...auth(user), ...(persona === "Patient" ? {} : { orgId: "org_Synthetic", orgRole: persona === "Admin" ? "org:admin" : "org:member" }) };
        const result = await service.archive(identity, { confirmation: "ARCHIVE" }); assert.equal(result.status, "archived"); assert.ok(result.archivedAt);
        await assert.rejects(service.assertActive(identity), code("ACCOUNT_ARCHIVED"));
        await assert.rejects(service.requestClosure(identity, { action: "delete", confirmation: "DELETE" }), code("ACCOUNT_ARCHIVED"));
        const count = bans.filter(id => id === user).length; assert.equal((await service.archive(identity, { confirmation: "ARCHIVE" })).status, "archived"); assert.equal(bans.filter(id => id === user).length, count);
      }
    });
    await context.test("archive and restoration preserve an existing member, assigned location, patient record and practice audit event byte-for-byte", async () => {
      const user = fresh("Retained"), owner = fresh("RetainedOwner"), practice = randomUUID(), location = randomUUID(), patient = randomUUID(); practices.push(practice);
      await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,owner_user_id) VALUES($1,$2,'Synthetic retention practice','location',$3)", [practice, `org_${randomUUID()}`, owner]);
      await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic retained location','UTC')", [location, practice]);
      await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practice, user, `mem_${tag}`]);
      await admin.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$4)", [practice, user, location, owner]);
      await admin.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic','Retention')", [patient, practice, location]);
      await admin.query("INSERT INTO practice_admin_events(practice_id,actor_user_id,action,subject_id) VALUES($1,$2,'synthetic.retained',$3)", [practice, owner, user]);
      const retained = async () => Promise.all(["patients", "practice_member_access", "location_assignments", "practice_admin_events"].map(async table => (await admin.query(`SELECT row_to_json(t) AS row FROM ${table} t WHERE practice_id=$1`, [practice])).rows));
      const before = await retained(); await service.archive(auth(user), { confirmation: "ARCHIVE" }); assert.deepEqual(await retained(), before);
      await service.restoreForOperator(user, { operatorReference: "support:retained-test", confirmation: "RESTORE" }); assert.deepEqual(await retained(), before);
    });
    await context.test("committed archiving denies old tokens immediately while provider ban is still in flight", async () => {
      const user = fresh("Slow"); let finish!: () => void; pendingBan = new Promise<void>(resolve => { finish = resolve; });
      const archive = service.archive(auth(user), { confirmation: "ARCHIVE" });
      while (!bans.includes(user)) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal((await service.state(auth(user))).account.status, "archiving");
      await assert.rejects(Promise.race([service.assertActive(auth(user)), new Promise((_, reject) => setTimeout(() => reject(new Error("Access check waited for provider")), 1000))]), code("ACCOUNT_ARCHIVED"));
      finish(); pendingBan = null; assert.equal((await archive).status, "archived");
    });
    await context.test("provider failure stays blocked and a serialized retry completes one archive evidence pair", async () => {
      const user = fresh("Retry"); failBan = true;
      await assert.rejects(service.archive(auth(user), { confirmation: "ARCHIVE" }), code("ACCOUNT_ARCHIVE_INCOMPLETE")); assert.equal((await service.state(auth(user))).account.status, "archiving"); await assert.rejects(service.assertActive(auth(user)), code("ACCOUNT_ARCHIVED"));
      failBan = false;
      const results = await Promise.all([service.archive(auth(user), { confirmation: "ARCHIVE" }), service.archive(auth(user), { confirmation: "ARCHIVE" })]); assert.ok(results.every(result => result.status === "archived"));
      assert.deepEqual((await admin.query("SELECT event FROM personal_account_events WHERE user_id=$1 ORDER BY occurred_at,id", [user])).rows.map(row => row.event), ["archive_requested", "archive_completed"]);
      const wrong = fresh("WrongProvider"); wrongBan = true; await assert.rejects(service.archive(auth(wrong), { confirmation: "ARCHIVE" }), code("ACCOUNT_ARCHIVE_INCOMPLETE")); wrongBan = false; await assert.rejects(service.assertActive(auth(wrong)), code("ACCOUNT_ARCHIVED"));
    });
    await context.test("a database failure after provider ban retains denial until a safe retry", async () => {
      const user = fresh("DatabaseRetry"); let failCompletion = true;
      const interrupted = createAccountLifecycleService((practice, actor, operation) => transaction(practice, actor, async client => {
        const proxy = { query: (...args: any[]) => { if (failCompletion && String(args[0]).includes("SET status='archived'")) throw new Error("Synthetic completion failure"); return (client.query as any)(...args); } } as PoolClient;
        return operation(proxy);
      }), provider);
      await assert.rejects(interrupted.archive(auth(user), { confirmation: "ARCHIVE" }), code("ACCOUNT_ARCHIVE_INCOMPLETE")); assert.ok(bans.includes(user)); await assert.rejects(service.assertActive(auth(user)), code("ACCOUNT_ARCHIVED"));
      failCompletion = false; assert.equal((await interrupted.archive(auth(user), { confirmation: "ARCHIVE" })).status, "archived");
    });
    await context.test("internal reviewed restoration keeps denial until provider unban succeeds and is retry-idempotent", async () => {
      const user = fresh("Restore"); await service.archive(auth(user), { confirmation: "ARCHIVE" });
      await assert.rejects(service.restoreForOperator(user, { operatorReference: "", confirmation: "RESTORE" }), code("INVALID_REQUEST"));
      failUnban = true; await assert.rejects(service.restoreForOperator(user, { operatorReference: "support:synthetic", confirmation: "RESTORE" }), code("ACCOUNT_RESTORE_INCOMPLETE")); await assert.rejects(service.assertActive(auth(user)), code("ACCOUNT_ARCHIVED")); assert.equal((await service.state(auth(user))).account.status, "restoring");
      failUnban = false; let finish!: () => void; pendingUnban = new Promise<void>(resolve => { finish = resolve; });
      const restoring = service.restoreForOperator(user, { operatorReference: "support:synthetic", confirmation: "RESTORE" });
      while (unbans.filter(id => id === user).length < 2) await new Promise(resolve => setTimeout(resolve, 5));
      await assert.rejects(service.assertActive(auth(user)), code("ACCOUNT_ARCHIVED")); finish(); pendingUnban = null;
      assert.equal((await restoring).status, "active"); await service.assertActive(auth(user));
      const count = unbans.length; assert.equal((await service.restoreForOperator(user, { operatorReference: "support:synthetic", confirmation: "RESTORE" })).status, "active"); assert.equal(unbans.length, count);
      assert.deepEqual((await admin.query("SELECT event FROM personal_account_events WHERE user_id=$1 ORDER BY occurred_at,id", [user])).rows.map(row => row.event), ["archive_requested", "archive_completed", "restore_requested", "restore_completed"]);
      await assert.rejects(service.restoreForOperator(fresh("Unknown"), { operatorReference: "support:synthetic", confirmation: "RESTORE" }), code("ACCOUNT_RESTORE_NOT_AVAILABLE"));
    });
    await context.test("database interruption after provider unban still denies application access until reviewed retry", async () => {
      const user = fresh("RestoreDatabaseRetry"); await service.archive(auth(user), { confirmation: "ARCHIVE" }); let failCompletion = true;
      const interrupted = createAccountLifecycleService((practice, actor, operation) => transaction(practice, actor, async client => {
        const proxy = { query: (...args: any[]) => { if (failCompletion && String(args[0]).includes("SET status='active'")) throw new Error("Synthetic restore completion failure"); return (client.query as any)(...args); } } as PoolClient;
        return operation(proxy);
      }), provider);
      const review = { operatorReference: "support:restore-database", confirmation: "RESTORE" as const };
      await assert.rejects(interrupted.restoreForOperator(user, review), code("ACCOUNT_RESTORE_INCOMPLETE")); assert.ok(unbans.includes(user)); await assert.rejects(service.assertActive(auth(user)), code("ACCOUNT_ARCHIVED"));
      failCompletion = false; assert.equal((await interrupted.restoreForOperator(user, review)).status, "active"); await service.assertActive(auth(user));
      assert.equal((await service.archive(auth(user), { confirmation: "ARCHIVE" })).status, "archived");
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM personal_account_events WHERE user_id=$1 AND event='archive_completed'", [user])).rows[0].count, 2);
    });
    await context.test("target checks restore actor scope even on denial; runtime cannot forge actors or erase evidence", async () => {
      const user = fresh("Scope"); await service.archive(auth(user), { confirmation: "ARCHIVE" }); const other = fresh("Other");
      await transaction(null, other, async client => { await assert.rejects(lockActiveAccount(client, user), code("ACCOUNT_ARCHIVED")); assert.equal((await client.query("SELECT current_setting('app.actor_user_id') AS actor")).rows[0].actor, other); assert.equal((await client.query("SELECT * FROM personal_account_lifecycle WHERE user_id=$1", [user])).rowCount, 0); });
      await assert.rejects(transaction(null, other, client => client.query("INSERT INTO personal_account_lifecycle(user_id,status,archive_session_id) VALUES($1,'active','sess_Synthetic')", [user])), /row-level security/);
      await assert.rejects(transaction(null, user, client => client.query("DELETE FROM personal_account_lifecycle WHERE user_id=$1", [user])), /permission denied/);
      await assert.rejects(transaction(null, user, client => client.query("UPDATE personal_account_events SET event='restore_completed' WHERE user_id=$1", [user])), /permission denied/);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practices WHERE id=ANY($1::uuid[])", [practices])).rows[0].count, practices.length);
    });
  } finally {
    await runtime?.end();
    for (const table of ["personal_account_events", "personal_account_lifecycle", "account_closure_requests"]) await admin.query(`DELETE FROM ${table} WHERE ${table === "account_closure_requests" ? "actor_user_id" : "user_id"}=ANY($1::text[])`, [actors]);
    for (const table of ["clinical_audit_events", "practice_admin_events", "patients", "location_assignments", "practice_member_access", "locations"]) await admin.query(`DELETE FROM ${table} WHERE practice_id=ANY($1::uuid[])`, [practices]);
    await admin.query("DELETE FROM practices WHERE id=ANY($1::uuid[])", [practices]);
    await admin.query(`DROP OWNED BY ${role}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end();
  }
});
