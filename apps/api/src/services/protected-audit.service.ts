import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { createDatabasePool } from "../db/pool.js";
import type { TenantContext } from "../middleware/tenant-context.js";
import { connectionOptions } from "../db/connection.js";
import { camel, WorkflowError } from "../workflow/policy.js";
import { readPrivate, sha256, writePrivateIfAbsent } from "../workflow/storage.js";
import { verifyPrivateStorageDirectory } from "../workflow/storage-config.js";

export type AuditFilter = { from: string; to: string; action?: string; outcome?: string; actorId?: string; resourceId?: string; operationId?: string; cursor?: string; limit: number; includeEvidence?: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secret = process.env.CAREIQ_AUDIT_CURSOR_SECRET || randomBytes(32).toString("hex");
const archiveEnvironment = (): NodeJS.ProcessEnv => ({...process.env, CAREIQ_PRIVATE_STORAGE_DIR:process.env.CAREIQ_AUDIT_EXPORT_DIR || (process.env.NODE_ENV === "production" ? undefined : resolve(".local-review/audit-exports"))});
let reader: Pool | undefined;
function auditReader() {
  if (!process.env.CAREIQ_AUDIT_DATABASE_URL) throw new WorkflowError("AUDIT_READER_UNAVAILABLE", 503, { message: "Protected audit access is not configured." });
  const options = connectionOptions({ ...process.env, DATABASE_URL: process.env.CAREIQ_AUDIT_DATABASE_URL, DATABASE_SSL_MODE: process.env.CAREIQ_AUDIT_SSL_MODE || "verify-full" });
  if (process.env.NODE_ENV === "production" && options.ssl === false) throw new WorkflowError("AUDIT_READER_TLS_REQUIRED", 503);
  reader ??= createDatabasePool({ ...options, max: 2 });
  return reader;
}
export function parseAuditFilter(input: Record<string, unknown>): AuditFilter {
  if (Object.keys(input).some(key => !["from", "to", "action", "outcome", "actorId", "resourceId", "operationId", "cursor", "limit", "purpose", "includeEvidence"].includes(key))) throw new WorkflowError("INVALID_AUDIT_FILTER", 422);
  const from = typeof input.from === "string" ? input.from : "";
  const to = typeof input.to === "string" ? input.to : "";
  const a = Date.parse(from), b = Date.parse(to);
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(from) || !/[zZ]|[+-]\d\d:\d\d$/.test(to) || !Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 31 * 86400000) throw new WorkflowError("INVALID_AUDIT_RANGE", 422, { message: "Choose an audit period of at most 31 days with explicit time zones." });
  if (input.limit !== undefined && !(typeof input.limit === "number" || (typeof input.limit === "string" && /^\d+$/.test(input.limit)))) throw new WorkflowError("INVALID_AUDIT_LIMIT", 422);
  if (input.includeEvidence !== undefined && ![true, false, "true", "false"].includes(input.includeEvidence as boolean | string)) throw new WorkflowError("INVALID_AUDIT_FILTER", 422);
  const limit = Number(input.limit ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new WorkflowError("INVALID_AUDIT_LIMIT", 422);
  const result: AuditFilter = { from: new Date(a).toISOString(), to: new Date(b).toISOString(), limit };
  for (const field of ["action", "outcome", "actorId", "resourceId", "operationId", "cursor"] as const) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !input[field] || input[field].length > (field === "cursor" ? 4000 : 256) || /[\u0000-\u001f]/.test(input[field])) throw new WorkflowError("INVALID_AUDIT_FILTER", 422);
    result[field] = input[field];
  }
  if (result.operationId && !uuid.test(result.operationId)) throw new WorkflowError("INVALID_AUDIT_FILTER", 422);
  if (result.outcome && !["accepted", "succeeded", "denied", "rejected", "failed", "unknown"].includes(result.outcome)) throw new WorkflowError("INVALID_AUDIT_FILTER", 422);
  result.includeEvidence = input.includeEvidence === true || input.includeEvidence === "true";
  return result;
}
function filterBinding(tenant: TenantContext, filter: AuditFilter) { return sha256(Buffer.from(JSON.stringify([tenant.practiceId, tenant.locationId, tenant.userId, tenant.membershipId, filter.includeEvidence, filter.from, filter.to, filter.action, filter.outcome, filter.actorId, filter.resourceId, filter.operationId]))); }
function signCursor(value: Record<string, unknown>) { const payload = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`; }
function decodeCursor(value: string | undefined, binding: string): { time: string; id: string } | null {
  if (!value) return null;
  try {
    const [payload, supplied, extra] = value.split(".");
    if (!payload || !supplied || extra) throw new Error();
    const expected = createHmac("sha256", secret).update(payload).digest();
    const signature = Buffer.from(supplied, "base64url");
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now() || parsed.binding !== binding || !uuid.test(parsed.id) || !Number.isFinite(Date.parse(parsed.time))) throw new Error();
    return parsed;
  } catch { throw new WorkflowError("INVALID_AUDIT_CURSOR", 422); }
}
async function logAccess(tenant: TenantContext, requestId: string, action: string, entityId: string, extra: { count?: number; outputHash?: string; sourceHash?: string; purpose?: string; eventIds?: string[]; byteCount?: number } = {}) {
  const { scoped } = await import("../workflow/transaction.js");
  const { recordWorkflowAudit } = await import("./workflow-audit.js");
  return scoped(tenant, client => recordWorkflowAudit(client, tenant, {
    action, entityType: "audit", entityId, requestId, reasonCode: extra.purpose,
    resources: extra.eventIds?.map(resourceId => ({ resourceType: "audit_event", resourceId, relationship: "affected" as const })),
    metadata: { ...(extra.count !== undefined ? { count: extra.count } : {}), ...(extra.byteCount !== undefined ? { byteCount: extra.byteCount } : {}), ...(extra.outputHash ? { outputHash: extra.outputHash } : {}), ...(extra.sourceHash ? { sourceHash: extra.sourceHash } : {}) }
  }), requestId);
}
/** Shared startup and request boundary: inspect effective access and every reachable role without reading audit contents. */
async function assertAuditReaderIdentity(client: Pick<PoolClient, "query">): Promise<void> {
    const identity = (await client.query(`WITH reachable AS (
      SELECT oid,rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_roles WHERE oid=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR pg_has_role(current_user,oid,'MEMBER')
    ) SELECT current_user=session_user AS direct,
      pg_has_role(current_user,'careiq_audit_reader','MEMBER') AS reviewer,
      pg_has_role(current_user,'careiq_clinical_runtime','MEMBER') AS runtime,
      has_schema_privilege(current_user,'audit','USAGE') AND NOT EXISTS(
        SELECT 1 FROM unnest(ARRAY['events','event_resources','changes','database_records']) required_table
        WHERE NOT has_table_privilege(current_user,format('audit.%I',required_table),'SELECT')
      ) AS can_read_required,
      EXISTS(SELECT 1 FROM reachable WHERE rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR left(rolname,3)='pg_') AS privileged,
      EXISTS(SELECT 1 FROM reachable r,pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname NOT IN ('clinical_audit_events','practice_admin_events') AND c.relkind IN ('r','p','v','m','f') AND (
          has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR
          has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS clinical,
      EXISTS(SELECT 1 FROM reachable r,pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE (n.nspname='audit' OR (n.nspname='public' AND c.relname IN ('clinical_audit_events','practice_admin_events'))) AND c.relkind IN ('r','p','v','m','f') AND (
          has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR
          has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES'))) AS audit_write,
      EXISTS(SELECT 1 FROM reachable r WHERE has_database_privilege(r.oid,current_database(),'CREATE') OR
        has_schema_privilege(r.oid,'public','CREATE') OR has_schema_privilege(r.oid,'audit','CREATE')) AS can_create,
      EXISTS(SELECT 1 FROM reachable r JOIN pg_namespace n ON n.nspowner=r.oid WHERE n.nspname IN ('public','audit')) OR
      EXISTS(SELECT 1 FROM reachable r JOIN pg_proc p ON p.proowner=r.oid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','audit')) AS owns_protected
      `)).rows[0];
    if (!identity?.direct || !identity.reviewer || !identity.can_read_required || identity.runtime || identity.clinical || identity.audit_write || identity.privileged || identity.can_create || identity.owns_protected) throw new WorkflowError("AUDIT_READER_IDENTITY_INVALID", 503);
}

/** An unconfigured audit reader leaves the optional audit feature disabled; a configured unsafe reader blocks activation. */
export async function verifyConfiguredAuditReader(): Promise<void> {
  if (!process.env.CAREIQ_AUDIT_DATABASE_URL) return;
  if (process.env.NODE_ENV === "production") await verifyPrivateStorageDirectory(archiveEnvironment());
  const client = await auditReader().connect();
  try { await assertAuditReaderIdentity(client); }
  finally { client.release(); }
}

async function withReader<T>(tenant: TenantContext, read: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await auditReader().connect();
  try {
    await assertAuditReaderIdentity(client);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '3s'");
    await client.query("SELECT set_config('app.practice_id',$1,true)", [tenant.practiceId]);
    const result = await read(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const selected = "e.id,e.schema_version,e.recorded_at::text AS seek_time,e.recorded_at,e.occurred_at,e.scope_kind,e.practice_id,e.location_id,e.actor_type,e.actor_id,e.initiating_actor_type,e.initiating_actor_id,e.executor_id,e.channel,e.action,e.entity_type,e.entity_id,e.outcome,e.reason_code,e.request_id,e.operation_id,e.workflow_id,e.causation_event_id,e.transaction_id,e.authorization_context,e.metadata";
function selection(tenant: TenantContext, filter: AuditFilter, max: number) {
  const cursor = decodeCursor(filter.cursor, filterBinding(tenant, filter));
  const values: unknown[] = [tenant.practiceId, tenant.locationId, filter.from, filter.to];
  const clauses = ["e.practice_id=$1", "e.location_id=$2", "e.recorded_at >= $3", "e.recorded_at < $4"];
  for (const [field, column] of [["action", "action"], ["outcome", "outcome"], ["actorId", "actor_id"], ["operationId", "operation_id"]] as const) if (filter[field]) { values.push(filter[field]); clauses.push(`e.${column}=$${values.length}`); }
  if (filter.resourceId) { values.push(filter.resourceId); clauses.push(`EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_id=$${values.length})`); }
  if (cursor) { values.push(cursor.time, cursor.id); clauses.push(`(e.recorded_at,e.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`); }
  values.push(max);
  return { text: `SELECT ${selected} FROM audit.events e WHERE ${clauses.join(" AND ")} ORDER BY e.recorded_at DESC,e.id DESC LIMIT $${values.length}`, values };
}
export async function searchAudit(tenant: TenantContext, filter: AuditFilter, requestId: string, purpose: string) {
  auditReader();
  const accessId = await logAccess(tenant, requestId, "audit.search.authorized", filterBinding(tenant, filter), { purpose, sourceHash: filterBinding(tenant, filter) });
  const rows = await withReader(tenant, client => client.query(selection(tenant, filter, filter.limit + 1)).then(result => result.rows));
  const items = rows.slice(0, filter.limit), last = items.at(-1);
  await logAccess(tenant, requestId, "audit.search.completed", accessId, { count: items.length, eventIds: items.map(item => item.id) });
  return { data: camel(items.map(({ seek_time: _seekTime, ...item }) => item)), pagination: { hasMore: rows.length > filter.limit, nextCursor: rows.length > filter.limit && last ? signCursor({ binding: filterBinding(tenant, filter), time: last.seek_time, id: last.id, expiresAt: Date.now() + 15 * 60000 }) : null }, live: true };
}
export async function auditDetail(tenant: TenantContext, eventId: string, requestId: string, purpose: string, includeEvidence = false) {
  if (!uuid.test(eventId)) throw new WorkflowError("INVALID_AUDIT_EVENT_ID", 422);
  auditReader();
  await logAccess(tenant, requestId, "audit.detail.authorized", eventId, { purpose });
  const result = await withReader(tenant, async client => {
    const event = (await client.query(`SELECT ${selected} FROM audit.events e WHERE e.id=$1 AND e.practice_id=$2 AND e.location_id=$3`, [eventId, tenant.practiceId, tenant.locationId])).rows[0];
    if (!event) throw new WorkflowError("RESOURCE_NOT_FOUND", 404);
    const resources = (await client.query("SELECT ordinal,resource_type,resource_id,relationship,patient_id FROM audit.event_resources WHERE event_id=$1 ORDER BY ordinal", [eventId])).rows;
    const changes = (await client.query("SELECT resource_type,resource_id,field_path,capture_mode,before_value,after_value,protected_reference FROM audit.changes WHERE event_id=$1 ORDER BY id", [eventId])).rows;
    const databaseRecords = includeEvidence ? (await client.query("SELECT * FROM audit.database_records WHERE practice_id=$1 AND location_id=$2 AND (application_event_id=$3 OR transaction_id=$4) ORDER BY recorded_at,id LIMIT 1001", [tenant.practiceId, tenant.locationId, eventId, event.transaction_id])).rows : undefined;
    if (databaseRecords && databaseRecords.length > 1000) throw new WorkflowError("AUDIT_EVIDENCE_TOO_LARGE", 422);
    const { seek_time: _seekTime, ...safeEvent } = event;
    return camel({ ...safeEvent, resources, changes, ...(databaseRecords ? { databaseRecords } : {}) });
  });
  await logAccess(tenant, requestId, "audit.detail.completed", eventId, { count: 1, eventIds: [eventId] });
  return result;
}
export async function exportAudit(tenant: TenantContext, filter: AuditFilter, requestId: string, purpose: string, idempotencyKey: string) {
  if (!uuid.test(idempotencyKey)) throw new WorkflowError("INVALID_IDEMPOTENCY_KEY", 422);
  auditReader();
  const exportId = createHmac("sha256", secret).update(JSON.stringify([tenant.practiceId, tenant.locationId, tenant.userId, filterBinding(tenant, filter), idempotencyKey])).digest("hex");
  // Stable filename, opaque to callers, with no scope or patient data in the path.
  const filename = `${exportId}.json`;
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  await logAccess(tenant, requestId, "audit.export.authorized", exportId, { purpose, sourceHash: filterBinding(tenant, filter) });
  const dataset = await withReader(tenant, async client => {
    const events = (await client.query(selection(tenant, { ...filter, cursor: undefined }, 10001))).rows;
    if (events.length > 10000) throw new WorkflowError("AUDIT_EXPORT_TOO_LARGE", 422, { message: "Choose a smaller period for this export." });
    const ids = events.map(event => event.id);
    const resources = ids.length ? (await client.query("SELECT * FROM audit.event_resources WHERE event_id=ANY($1::uuid[]) ORDER BY event_id,ordinal LIMIT 100001", [ids])).rows : [];
    const changes = ids.length ? (await client.query("SELECT * FROM audit.changes WHERE event_id=ANY($1::uuid[]) ORDER BY event_id,id LIMIT 50001", [ids])).rows : [];
    if (resources.length > 100000 || changes.length > 50000) throw new WorkflowError("AUDIT_EXPORT_TOO_LARGE", 422, { message: "Choose a smaller period for this export." });
    const transactionIds = events.map(event => event.transaction_id).filter(Boolean);
    const databaseRecords = filter.includeEvidence && ids.length ? (await client.query("SELECT * FROM audit.database_records WHERE practice_id=$1 AND location_id=$2 AND (application_event_id=ANY($3::uuid[]) OR transaction_id=ANY($4::uuid[])) ORDER BY recorded_at,id LIMIT 50001", [tenant.practiceId, tenant.locationId, ids, transactionIds])).rows : undefined;
    if (databaseRecords && databaseRecords.length > 50000) throw new WorkflowError("AUDIT_EXPORT_TOO_LARGE", 422);
    return { events: events.map(({ seek_time: _seekTime, ...event }) => event), resources, changes, ...(databaseRecords ? { databaseRecords } : {}) };
  });
  const manifest = { version: 1, id: exportId, practiceId: tenant.practiceId, locationId: tenant.locationId, actorId: tenant.userId, purpose, createdAt: new Date().toISOString(), expiresAt, filter: { ...filter, cursor: undefined }, eventIds: dataset.events.map(event => event.id), ...dataset };
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > 32 * 1024 * 1024) throw new WorkflowError("AUDIT_EXPORT_TOO_LARGE", 422, { message: "Choose a smaller period for this export." });
  await writePrivateIfAbsent(filename, bytes, archiveEnvironment());
  const existingBytes = await readPrivate(filename, archiveEnvironment());
  const existing = JSON.parse(existingBytes.toString("utf8"));
  if (existing.practiceId !== tenant.practiceId || existing.locationId !== tenant.locationId || existing.actorId !== tenant.userId) throw new WorkflowError("AUDIT_EXPORT_SCOPE_DENIED", 403);
  const hash = sha256(existingBytes);
  await logAccess(tenant, requestId, "audit.export.prepared", exportId, { count: existing.eventIds.length, outputHash: hash, purpose });
  return { id: exportId, state: "ready", recordCount: existing.eventIds.length, sha256: hash, expiresAt: existing.expiresAt };
}
export async function auditExportContent(tenant: TenantContext, exportId: string, requestId: string) {
  if (!/^[a-f0-9]{64}$/.test(exportId)) throw new WorkflowError("INVALID_EXPORT_ID", 422);
  auditReader();
  await verifyConfiguredAuditReader();
  const bytes = await readPrivate(`${exportId}.json`, archiveEnvironment()).catch(() => { throw new WorkflowError("RESOURCE_NOT_FOUND", 404); });
  const manifest = JSON.parse(bytes.toString());
  if (manifest.practiceId !== tenant.practiceId || manifest.locationId !== tenant.locationId || manifest.actorId !== tenant.userId) throw new WorkflowError("RESOURCE_NOT_FOUND", 404);
  if (Date.parse(manifest.expiresAt) <= Date.now()) throw new WorkflowError("AUDIT_EXPORT_EXPIRED", 410);
  await logAccess(tenant, requestId, "audit.export.access_authorized", exportId, { count: manifest.eventIds.length });
  return bytes;
}

export async function closeProtectedAuditReader() { await reader?.end(); reader = undefined; }

export async function observeAuditExport(tenant: TenantContext, exportId: string, requestId: string, byteCount: number, complete = true) { await logAccess(tenant, requestId, complete ? "audit.export.transferred" : "audit.export.transfer_failed", exportId, { byteCount }); }
