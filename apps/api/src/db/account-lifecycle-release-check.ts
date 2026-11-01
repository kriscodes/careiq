import type { PoolClient } from "pg";
import { ReleaseCheckError } from "./migration-safety.js";

const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
/** Catalog-only: personal requests stay actor-scoped and append-only for the API runtime. */
export async function verifyAccountLifecycleDatabaseRelease(client: Pick<PoolClient, "query">) {
  const metadata = (await client.query(`SELECT c.relrowsecurity,c.relforcerowsecurity,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='account_closure_requests'`)).rows;
  if (metadata.length !== 1 || metadata.some(row => !row.relrowsecurity || !row.relforcerowsecurity || row.owns || !row.can_select || row.excessive)) throw new ReleaseCheckError("Account closure runtime grants or forced row-level security differ from this release.");
  const columns = (await client.query(`SELECT a.attname,
    bool_or(has_column_privilege(r.oid,a.attrelid,a.attnum,'INSERT')) AS can_insert,
    bool_or(has_column_privilege(r.oid,a.attrelid,a.attnum,'UPDATE,REFERENCES')) AS excessive
    FROM pg_attribute a CROSS JOIN pg_roles r
    WHERE a.attrelid='public.account_closure_requests'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')) GROUP BY a.attname`)).rows;
  const insertable = ["actor_user_id", "requested_session_id", "action"];
  if (columns.length !== 6 || columns.some(row => row.excessive || row.can_insert !== insertable.includes(row.attname))) throw new ReleaseCheckError("Account closure column grants permit unreviewed lifecycle changes.");
  const policies = (await client.query("SELECT policyname,cmd,roles::text[],qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='account_closure_requests'")).rows;
  const actor = "(actor_user_id = NULLIF(current_setting('app.actor_user_id'::text, true), ''::text))";
  const request = "((actor_user_id = NULLIF(current_setting('app.actor_user_id'::text, true), ''::text)) AND (status = 'pending'::text))";
  if (policies.length !== 2 || !policies.some(row => row.policyname === "account_closure_self_read" && row.cmd === "SELECT" && row.roles.join() === "public" && normalize(row.qual) === actor && row.with_check === null) || !policies.some(row => row.policyname === "account_closure_self_request" && row.cmd === "INSERT" && row.roles.join() === "public" && row.qual === null && normalize(row.with_check) === request)) throw new ReleaseCheckError("Account closure actor isolation policies differ from this release.");
  const indexes = (await client.query(`SELECT i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='account_closure_one_pending'`)).rows;
  if (indexes.length !== 1 || !indexes[0].indisunique || !indexes[0].indisvalid || normalize(indexes[0].definition) !== "CREATE UNIQUE INDEX account_closure_one_pending ON public.account_closure_requests USING btree (actor_user_id) WHERE (status = 'pending'::text)") throw new ReleaseCheckError("Account closure pending-request uniqueness differs from this release.");
  await verifyPersonalAccountArchiveDatabaseRelease(client);
}

/** Migration 44: the guard's authority source and lifecycle evidence stay narrowly scoped. */
export async function verifyPersonalAccountArchiveDatabaseRelease(client: Pick<PoolClient, "query">) {
  const tables = (await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('personal_account_lifecycle','personal_account_events')`)).rows;
  if (tables.length !== 2 || tables.some(row => !row.relrowsecurity || !row.relforcerowsecurity || row.owns || !row.can_select || row.excessive || row.can_insert !== (row.relname === "personal_account_lifecycle"))) throw new ReleaseCheckError("Personal account archive grants or forced row-level security differ from this release.");
  const columns = (await client.query(`SELECT c.relname,a.attname,
    bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'INSERT')) AS can_insert,
    bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE')) AS can_update,
    bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES')) AS can_reference
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN pg_roles r
    WHERE n.nspname='public' AND c.relname IN ('personal_account_lifecycle','personal_account_events') AND a.attnum>0 AND NOT a.attisdropped
    AND (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')) GROUP BY c.relname,a.attname`)).rows;
  const mutable = ["status", "archive_session_id", "archive_requested_at", "archived_at", "restored_at", "updated_at"];
  if (columns.length !== 12 || columns.some(row => row.can_reference || row.can_update !== (row.relname === "personal_account_lifecycle" && mutable.includes(row.attname)) || row.can_insert !== (row.relname === "personal_account_lifecycle" || ["user_id", "actor_reference", "event"].includes(row.attname)))) throw new ReleaseCheckError("Personal account archive column grants differ from this release.");
  const policies = (await client.query("SELECT tablename,policyname,cmd,roles::text[],qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('personal_account_lifecycle','personal_account_events')")).rows;
  const actor = "(user_id = NULLIF(current_setting('app.actor_user_id'::text, true), ''::text))";
  const expected = [
    ["personal_account_lifecycle", "personal_account_self", "ALL", actor, actor],
    ["personal_account_events", "personal_account_event_self_read", "SELECT", actor, null],
    ["personal_account_events", "personal_account_event_self_insert", "INSERT", null, actor],
  ];
  if (policies.length !== expected.length || expected.some(([table, name, command, using, check]) => !policies.some(row => row.tablename === table && row.policyname === name && row.cmd === command && row.roles.join() === "public" && (row.qual === null ? null : normalize(row.qual)) === using && (row.with_check === null ? null : normalize(row.with_check)) === check))) throw new ReleaseCheckError("Personal account archive actor policies differ from this release.");
}
