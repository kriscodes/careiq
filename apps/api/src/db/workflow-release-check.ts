import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { verifyNotificationDatabaseRelease } from "./notification-release-check.js";
import { verifyInsuranceDatabaseRelease } from "./insurance-release-check.js";
import { verifyFormsStudioDatabaseRelease } from "./forms-studio-release-check.js";
import { migrationsFolder, ReleaseCheckError } from "./migration-safety.js";

/** Catalog checks only: never inspect patient payloads or weaken runtime grants. */
export async function verifyWorkflowDatabaseRelease(client: Pick<PoolClient, "query">) {
  const migration = await readFile(`${migrationsFolder}/0019_workflow-foundation.sql`, "utf8");
  const tables = [...migration.matchAll(/CREATE TABLE public\.([a-z_]+)\s*\(/g)].map(match => match[1]!);
  const immutable = new Set(["document_versions", "document_reviews", "signature_events", "file_access_observations", "file_scan_runs", "provider_webhook_receipts"]);
  const metadata = (await client.query(`SELECT c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables])).rows;
  if (metadata.length !== tables.length || metadata.some(row => !row.relrowsecurity || !row.relforcerowsecurity || row.owns || !row.can_select || !row.can_insert || row.excessive || row.can_update === immutable.has(row.table_name))) {
    throw new ReleaseCheckError("Workflow runtime grants or forced row-level security differ from this release.");
  }
  const auditTables = [...migration.matchAll(/CREATE TABLE audit\.([a-z_]+)\s*\(/g)].map(match => match[1]!);
  const audit = (await client.query(`SELECT c.relname AS table_name,
    has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='audit' AND c.relname=ANY($1::text[])`, [auditTables])).rows;
  if (audit.length !== auditTables.length || audit.some(row => row.excessive || row.owns)) throw new ReleaseCheckError("Workflow runtime has raw protected audit privileges.");
  const schema = (await client.query("SELECT has_schema_privilege(current_user,'audit','CREATE') AS can_create")).rows[0];
  if (!schema || schema.can_create) throw new ReleaseCheckError("Runtime must not create audit objects.");
  const functions = (await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='audit' AND p.proname=ANY($1::text[])`, [["record_event", "activity", "capture_mutation"]])).rows;
  if (functions.length !== 3 || functions.some(row => !row.prosecdef || row.public_execute || !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp"))) throw new ReleaseCheckError("Audit writer/projection helpers lack protected execution boundaries.");
  const evidence = (await client.query(`SELECT c.relname AS table_name,t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND t.tgname='workflow_mutation_evidence' AND c.relname=ANY($1::text[])`, [tables])).rows;
  if (evidence.length !== tables.length || evidence.some(row => !["O", "A"].includes(row.tgenabled))) throw new ReleaseCheckError("Workflow database mutation evidence is incomplete or disabled.");
  const appendOnly = (await client.query(`SELECT c.relname AS table_name,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='audit' AND t.tgname='audit_append_only' AND c.relname=ANY($1::text[])`, [auditTables])).rows;
  if (appendOnly.length !== auditTables.length || appendOnly.some(row => !["O", "A"].includes(row.tgenabled))) throw new ReleaseCheckError("Canonical audit tables must reject ordinary changes.");
  await verifyFormsStudioDatabaseRelease(client);
  await verifyInsuranceDatabaseRelease(client);
  await verifyNotificationDatabaseRelease(client);
}
