import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { isolatedTestDatabaseUrl } from "./local-test-database.js";
import { parseAuditFilter, searchAudit, auditDetail, exportAudit, auditExportContent, closeProtectedAuditReader, verifyConfiguredAuditReader } from "../src/services/protected-audit.service.js";

test("protected audit filters reject unbounded periods, ambiguous timestamps, array coercion and oversized pages", () => {
  const filter = { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" };
  assert.equal(parseAuditFilter(filter).limit, 50);
  for (const input of [{ ...filter, from: "2026-10-01" }, { ...filter, to: filter.from }, { ...filter, to: "2027-01-01T00:00:00Z" }, { ...filter, limit: 101 }, { ...filter, limit: 1.5 }, { ...filter, limit: [1] }, { ...filter, limit: true }, { ...filter, includeEvidence: ["true"] }, { ...filter, action: ["patients.read"] }, { ...filter, outcome: "made_up" }, { ...filter, operationId: "anything" }]) assert.throws(() => parseAuditFilter(input));
});

const url = isolatedTestDatabaseUrl();
test("protected audit uses a dedicated reader, isolates locations, rejects changed cursors and freezes export manifests", { skip: !url }, async context => {
  const admin = new Pool({ connectionString: url, ssl: false, max: 1 });
  const runtimeRole = `careiq_audit_app_${randomBytes(5).toString("hex")}`;
  const readerRole = `careiq_audit_review_${randomBytes(5).toString("hex")}`;
  const password = randomBytes(18).toString("hex");
  const practiceId = randomUUID(), locationId = randomUUID(), otherLocation = randomUUID();
  const userId = `user_${randomUUID()}`, membershipId = `mem_${randomUUID()}`;
  const temporary = await mkdtemp(join(tmpdir(), "careiq-audit-test-"));
  let runtime: Pool | undefined;
  try {
    for (const name of [runtimeRole, readerRole]) await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`GRANT careiq_clinical_runtime TO ${runtimeRole}; GRANT careiq_audit_reader TO ${readerRole}`);
    await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic audit test','location','active')", [practiceId, `org_${practiceId}`]);
    await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'A','UTC'),($2,$3,'B','UTC')", [locationId, otherLocation, practiceId]);
    await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practiceId, userId, membershipId]);
    for (const location of [locationId, otherLocation]) await admin.query("INSERT INTO location_assignments(practice_id,location_id,user_id,active,granted_by) VALUES($1,$2,$3,true,$3)", [practiceId, location, userId]);
    const target = new URL(url!); target.username = runtimeRole; target.password = password;
    process.env.DATABASE_URL = target.href; process.env.DATABASE_SSL_MODE = "disable";
    target.username = readerRole; process.env.CAREIQ_AUDIT_DATABASE_URL = target.href;
    process.env.CAREIQ_AUDIT_SSL_MODE = "disable"; process.env.CAREIQ_AUDIT_EXPORT_DIR = temporary;
    ({ pool: runtime } = await import("../src/db/client.js"));
    const { scoped } = await import("../src/workflow/transaction.js");
    const { recordWorkflowAudit } = await import("../src/services/workflow-audit.js");
    const tenant = { practiceId, locationId, userId, membershipId, orgId: `org_${practiceId}` };
    const emit = (location: string, action: string) => scoped({ ...tenant, locationId: location }, client => recordWorkflowAudit(client, { ...tenant, locationId: location }, { action, entityType: "test", entityId: randomUUID() }));
    const own = await emit(locationId, "patients.read");
    const other = await emit(otherLocation, "patients.read");
    const filter = parseAuditFilter({ from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 3600000).toISOString(), limit: 1 });
    await verifyConfiguredAuditReader();
    await context.test("a terminated idle audit-reader connection is safely logged and later verified reads reconnect", async () => {
      const initial = (await admin.query("SELECT pid FROM pg_stat_activity WHERE usename=$1 AND state='idle'", [readerRole])).rows;
      assert.equal(initial.length, 1); const pid = initial[0].pid;
      const messages: unknown[][] = [], originalError = console.error; let noticed!: () => void;
      const observed = new Promise<void>(resolve => { noticed = resolve; });
      console.error = (...args) => { messages.push(args); if (args[0] === "PostgreSQL idle connection failed") noticed(); };
      let timer: NodeJS.Timeout | undefined;
      try {
        assert.equal((await admin.query("SELECT pg_terminate_backend($1) AS terminated", [pid])).rows[0].terminated, true);
        await Promise.race([observed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("AUDIT_IDLE_FAILURE_NOT_OBSERVED")), 5000); })]);
        assert.deepEqual(messages, [["PostgreSQL idle connection failed", { code: "57P01" }]]);
        await verifyConfiguredAuditReader();
        const replacement = (await admin.query("SELECT pid FROM pg_stat_activity WHERE usename=$1 AND state='idle'", [readerRole])).rows;
        assert.equal(replacement.length, 1); assert.notEqual(replacement[0].pid, pid);
        const read = await searchAudit(tenant, filter, randomUUID(), "idle-recovery-review"); assert.equal(read.live, true); assert.ok(read.data.every((event: { locationId: string }) => event.locationId === locationId));
      } finally { if (timer) clearTimeout(timer); console.error = originalError; }
    });
    await context.test("search/detail are scoped and runtime retains no raw audit SELECT", async () => {
      const result = await searchAudit(tenant, filter, randomUUID(), "local-test-case");
      assert.equal(result.data.length, 1); assert.equal(result.live, true);
      assert.ok(result.data.every((event: { locationId: string }) => event.locationId === locationId));
      assert.equal((await auditDetail(tenant, own, randomUUID(), "local-test-case")).id, own);
      await assert.rejects(auditDetail(tenant, other, randomUUID(), "local-test-case"), error => (error as { code: string }).code === "RESOURCE_NOT_FOUND");
      await assert.rejects(runtime!.query("SELECT * FROM audit.events"), error => (error as { code: string }).code === "42501");
      const next = await searchAudit(tenant, filter, randomUUID(), "local-test-case");
      assert.ok(next.pagination.nextCursor);
      await assert.rejects(searchAudit(tenant, { ...filter, cursor: next.pagination.nextCursor!.slice(0, -2) + "xx" }, randomUUID(), "local-test-case"), error => (error as { code: string }).code === "INVALID_AUDIT_CURSOR");
      await assert.rejects(searchAudit({ ...tenant, locationId: otherLocation }, { ...filter, cursor: next.pagination.nextCursor! }, randomUUID(), "local-test-case"), error => (error as { code: string }).code === "INVALID_AUDIT_CURSOR");
    });
    await context.test("reader rejects column grants and privileged inherited memberships at startup and request time", async () => {
      const configuredUrl = process.env.CAREIQ_AUDIT_DATABASE_URL;
      delete process.env.CAREIQ_AUDIT_DATABASE_URL;
      try { await verifyConfiguredAuditReader(); }
      finally { process.env.CAREIQ_AUDIT_DATABASE_URL = configuredUrl; }
      await verifyConfiguredAuditReader();
      const verifyCli = () => promisify(execFile)(process.execPath, [fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)), fileURLToPath(new URL("../src/db/verify-release.ts", import.meta.url)), "--database-only"], { env: { ...process.env, NODE_ENV: "development", INTERVIEW_REQUESTS_ENABLED: "false" }, timeout: 10000, maxBuffer: 16384 });
      const cli = await verifyCli();
      assert.match(cli.stdout, /API release database checks passed/);
      await admin.query(`GRANT careiq_audit_reader TO ${readerRole} WITH INHERIT FALSE`);
      try {
        await assert.rejects(verifyConfiguredAuditReader(), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID");
        await assert.rejects(searchAudit(tenant, filter, randomUUID(), "reader-boundary"), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID");
      } finally { await admin.query(`GRANT careiq_audit_reader TO ${readerRole} WITH INHERIT TRUE`); }
      await verifyConfiguredAuditReader();
      await admin.query(`GRANT SELECT(id) ON public.patients TO ${readerRole}`);
      try { await assert.rejects(verifyConfiguredAuditReader(), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID");
        await assert.rejects(verifyCli(), error => (error as { code?: number; killed?: boolean }).code === 1 && !(error as { killed?: boolean }).killed);
        await assert.rejects(searchAudit(tenant, filter, randomUUID(), "reader-boundary"), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); }
      finally { await admin.query(`REVOKE SELECT(id) ON public.patients FROM ${readerRole}`); }
      const unsafeRole = `careiq_unsafe_${randomBytes(5).toString("hex")}`;
      await admin.query(`CREATE ROLE ${unsafeRole} NOLOGIN CREATEROLE; GRANT ${unsafeRole} TO ${readerRole}`);
      try { await assert.rejects(verifyConfiguredAuditReader(), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); await assert.rejects(searchAudit(tenant, filter, randomUUID(), "reader-boundary"), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); }
      finally { await admin.query(`REVOKE ${unsafeRole} FROM ${readerRole}; DROP ROLE ${unsafeRole}`); }
      await admin.query(`GRANT pg_monitor TO ${readerRole}`);
      try { await assert.rejects(verifyConfiguredAuditReader(), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); await assert.rejects(searchAudit(tenant, filter, randomUUID(), "reader-boundary"), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); }
      finally { await admin.query(`REVOKE pg_monitor FROM ${readerRole}`); }
      await admin.query(`CREATE ROLE ${unsafeRole} NOLOGIN; GRANT SELECT(id) ON public.patients TO ${unsafeRole}; GRANT ${unsafeRole} TO ${readerRole} WITH INHERIT FALSE, SET FALSE, ADMIN TRUE`);
      try { await assert.rejects(verifyConfiguredAuditReader(), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); await assert.rejects(searchAudit(tenant, filter, randomUUID(), "reader-boundary"), error => (error as { code: string }).code === "AUDIT_READER_IDENTITY_INVALID"); }
      finally { await admin.query(`REVOKE ${unsafeRole} FROM ${readerRole}; DROP OWNED BY ${unsafeRole}; DROP ROLE ${unsafeRole}`); }
    });
    await context.test("microsecond keyset pages preserve every event and redact private cursor fields", async () => {
      await admin.query(`INSERT INTO audit.events(scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,outcome,transaction_id,recorded_at)
        SELECT 'location',$1,$2,'user',$3,'dense.audit','test','succeeded',$4,'2026-10-16T12:00:00Z'::timestamptz + n * interval '1 microsecond' FROM generate_series(1,6) n`, [practiceId, locationId, userId, randomUUID()]);
      const dense = parseAuditFilter({ from: "2026-10-16T11:59:59Z", to: "2026-10-16T12:00:01Z", action: "dense.audit", limit: 1 });
      const ids = new Set<string>(); let cursor: string | undefined;
      do {
        const page = await searchAudit(tenant, { ...dense, cursor }, randomUUID(), "microsecond-review");
        assert.equal(page.data.length, 1);
        assert.ok(!("seekTime" in page.data[0]) && !("seek_time" in page.data[0]));
        assert.ok(!ids.has(page.data[0].id)); ids.add(page.data[0].id);
        cursor = page.pagination.nextCursor || undefined;
      } while (cursor);
      assert.equal(ids.size, 6);
    });
    await context.test("optional database evidence links event and transaction without crossing location", async () => {
      const transaction = randomUUID(), eventId = randomUUID();
      await admin.query(`INSERT INTO audit.events(id,scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,outcome,transaction_id) VALUES($1,'location',$2,$3,'user',$4,'evidence.audit','test','succeeded',$5)`, [eventId, practiceId, locationId, userId, transaction]);
      for (const location of [locationId, otherLocation]) await admin.query(`INSERT INTO audit.database_records(schema_name,table_name,operation,row_key,practice_id,location_id,changed_fields,transaction_id,authenticated_login,execution_role) VALUES('public','test','UPDATE','{}',$1,$2,ARRAY['revision'],$3,'test','test')`, [practiceId, location, transaction]);
      assert.equal((await auditDetail(tenant, eventId, randomUUID(), "evidence-review")).databaseRecords, undefined);
      const detail = await auditDetail(tenant, eventId, randomUUID(), "evidence-review", true);
      assert.equal(detail.databaseRecords.length, 1); assert.equal(detail.databaseRecords[0].locationId, locationId);
    });
    await context.test("export materializes an immutable manifest and reauthorizes each download", async () => {
      const exported = await exportAudit(tenant, filter, randomUUID(), "local-test-case", randomUUID());
      const firstBytes = await auditExportContent(tenant, exported.id, randomUUID());
      const manifest = JSON.parse(firstBytes.toString());
      assert.equal(manifest.eventIds.length, exported.recordCount);
      assert.ok(manifest.events.every((event: { location_id: string }) => event.location_id === locationId));
      await emit(locationId, "patients.update");
      const secondBytes = await auditExportContent(tenant, exported.id, randomUUID());
      assert.deepEqual(secondBytes, firstBytes);
      await assert.rejects(auditExportContent({ ...tenant, locationId: otherLocation }, exported.id, randomUUID()));
      await admin.query("UPDATE location_assignments SET active=false WHERE practice_id=$1 AND location_id=$2 AND user_id=$3", [practiceId, locationId, userId]);
      await assert.rejects(auditExportContent(tenant, exported.id, randomUUID()), error => (error as { code: string }).code === "LOCATION_ACCESS_DENIED");
    });
  } finally {
    await closeProtectedAuditReader(); await runtime?.end();
    await admin.query("DELETE FROM location_assignments WHERE practice_id=$1", [practiceId]);
    await admin.query("DELETE FROM practice_member_access WHERE practice_id=$1", [practiceId]);
    await admin.query("DELETE FROM locations WHERE practice_id=$1", [practiceId]);
    await admin.query("DELETE FROM practices WHERE id=$1", [practiceId]);
    for (const name of [runtimeRole, readerRole]) { await admin.query(`DROP OWNED BY ${name}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${name}`); }
    await admin.end(); await rm(temporary, { recursive: true, force: true });
  }
});
