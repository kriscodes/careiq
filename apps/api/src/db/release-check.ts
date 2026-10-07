import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { migrationsFolder, ReleaseCheckError } from "./migration-safety.js";

const clinical = ["practices", "patients", "appointments", "clinical_request_keys"];
const audits = ["clinical_audit_events", "practice_admin_events"];
const editable = ["locations", "practice_member_access", "location_assignments", "practice_invitations", "practice_invitation_attempts", "practice_onboarding", "onboarding_drafts"];
const protectedTables = [...clinical, ...audits, ...editable, "practice_provider_events", "marketing_interview_requests"];
const actor = "(actor_user_id = NULLIF(current_setting('app.actor_user_id'::text, true), ''::text))";
const practice = "(practice_id = careiq_context_uuid('app.practice_id'::text))";
const scope = "careiq_clinical_scope(practice_id, location_id)";
type Policy = { tablename: string; policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null };
const expectedPolicies: Policy[] = [];
function policy(table: string, name: string, command: string, expression: string, roles = ["public"]) {
  expectedPolicies.push({ tablename: table, policyname: name, cmd: command, roles, qual: command === "INSERT" ? null : expression, with_check: command === "SELECT" ? null : expression });
}
for (const table of ["patients", "appointments"]) policy(table, `${table}_scope`, "ALL", scope);
for (const table of editable.filter((table) => !["practice_onboarding", "onboarding_drafts"].includes(table))) policy(table, "practice_scope", "ALL", practice);
policy("practice_onboarding", "onboarding_actor", "ALL", actor);
policy("onboarding_drafts", "onboarding_draft_actor", "ALL", actor);
policy("practice_provider_events", "practice_event_scope", "ALL", practice);
policy("clinical_audit_events", "clinical_audit_events_insert", "INSERT", `(${scope} AND ${actor})`);
policy("clinical_audit_events", "clinical_audit_events_review", "SELECT", "(practice_id = (NULLIF(current_setting('app.practice_id'::text, true), ''::text))::uuid)", ["careiq_audit_reader"]);
policy("practice_admin_events", "admin_event_insert", "INSERT", `(${practice} AND ${actor})`);
policy("practice_admin_events", "admin_event_review", "SELECT", practice, ["careiq_audit_reader"]);
policy("clinical_request_keys", "clinical_request_keys_insert", "INSERT", `(${scope} AND ((location_id IS NULL) OR ${actor}))`);
policy("clinical_request_keys", "clinical_request_keys_select", "SELECT", `(${practice} AND (((location_id IS NULL) AND careiq_clinical_scope(practice_id, careiq_context_uuid('app.location_id'::text))) OR (${actor} AND ${scope})))`);
const normalize = (value: string | null) => value?.replace(/\s+/g, " ").trim() ?? null;

/** Catalog-only, read-only checks. Does not read clinical/contact rows or change grants. */
export async function verifyDatabaseRelease(client: Pick<PoolClient, "query">, marketingEnabled = false) {
  const identity = (await client.query("SELECT current_user,session_user,current_setting('server_version_num')::int AS version")).rows[0];
  if (identity.current_user !== identity.session_user || identity.version < 180000) throw new ReleaseCheckError("Runtime must connect directly using its restricted login on PostgreSQL 18 or newer.");
  const roles = (await client.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication
    FROM pg_roles r WHERE r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')`)).rows;
  // Predefined roles can expose other sessions, signal backends or alter server
  // behavior even when ordinary table ACLs appear narrow. None are API roles.
  if (!roles.some((role) => role.rolname === "careiq_clinical_runtime") || roles.some((role) => role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolname.startsWith("pg_"))) throw new ReleaseCheckError("API runtime has privileged memberships or lacks its clinical runtime group.");
  const ownership = (await client.query(`SELECT pg_has_role(current_user,n.nspowner,'MEMBER') OR pg_has_role(current_user,d.datdba,'MEMBER')
    OR has_schema_privilege(current_user,'public','CREATE') OR has_database_privilege(current_user,current_database(),'CREATE') AS unsafe
    FROM pg_namespace n CROSS JOIN pg_database d WHERE n.nspname='public' AND d.datname=current_database()`)).rows[0];
  if (!ownership || ownership.unsafe) throw new ReleaseCheckError("API runtime must not own or create schemas in the application database.");
  const tables = (await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')) AND has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [protectedTables])).rows;
  if (tables.length !== protectedTables.length) throw new ReleaseCheckError("Required release tables are missing; apply the complete reviewed migration journal.");
  for (const table of tables) {
    if (table.owns || table.excessive) throw new ReleaseCheckError("API runtime has ownership or excessive table privileges.");
    if (!["practices", "marketing_interview_requests"].includes(table.relname) && (!table.relrowsecurity || !table.relforcerowsecurity)) throw new ReleaseCheckError("Required forced row-level security is missing.");
    if (audits.includes(table.relname) && (!table.can_insert || table.can_select || table.can_update)) throw new ReleaseCheckError("Runtime audit access must be append-only.");
    if (clinical.includes(table.relname) && (!table.can_select || !table.can_insert || table.can_update)) throw new ReleaseCheckError("Clinical runtime table grants differ from the reviewed release.");
    if (editable.includes(table.relname) && (!table.can_select || !table.can_insert || !table.can_update)) throw new ReleaseCheckError("Required practice/onboarding metadata grants are missing.");
    if (table.relname === "practice_provider_events" && (!table.can_select || !table.can_insert || table.can_update)) throw new ReleaseCheckError("Provider event grants differ from the reviewed release.");
    if (table.relname === "marketing_interview_requests" && (table.can_select || table.can_update || (marketingEnabled && !table.can_insert))) throw new ReleaseCheckError("Marketing runtime grants differ from the reviewed release.");
  }
  const columns = (await client.query(`SELECT c.relname,a.attname,bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'SELECT')) AS can_select,
    bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE')) AS can_update,bool_or(has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES')) AS can_reference
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    AND (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')) GROUP BY c.relname,a.attname`, [protectedTables])).rows;
  for (const column of columns) {
    if (column.can_reference || (column.can_select && (audits.includes(column.relname) || (column.relname === "marketing_interview_requests" && column.attname !== "submission_key"))) || (column.can_update && !editable.includes(column.relname) && !(column.relname === "practices" && column.attname === "owner_user_id"))) throw new ReleaseCheckError("API runtime can read or modify protected columns.");
  }
  if (!columns.some((column) => column.relname === "practices" && column.attname === "owner_user_id" && column.can_update) || (marketingEnabled && !columns.some((column) => column.relname === "marketing_interview_requests" && column.attname === "submission_key" && column.can_select))) throw new ReleaseCheckError("Required narrowly scoped column grants are missing.");
  const policies = (await client.query("SELECT tablename,policyname,cmd,roles::text[],qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])", [protectedTables])).rows as Policy[];
  if (policies.length !== expectedPolicies.length || expectedPolicies.some((expected) => !policies.some((actual) => actual.tablename === expected.tablename && actual.policyname === expected.policyname && actual.cmd === expected.cmd && actual.roles.join() === expected.roles.join() && normalize(actual.qual) === normalize(expected.qual) && normalize(actual.with_check) === normalize(expected.with_check)))) throw new ReleaseCheckError("Row-level security policies differ from the reviewed release.");
  const functions = (await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[])`, [["careiq_context_uuid", "careiq_clinical_scope", "careiq_location_activation_guard"]])).rows;
  const migration = await readFile(`${migrationsFolder}/0016_location-membership.sql`, "utf8");
  if (functions.length !== 3 || functions.some((fn) => {
    const source = new RegExp(`CREATE FUNCTION ${fn.proname}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`).exec(migration)?.[1];
    return !source || fn.prosecdef || !fn.proconfig?.includes("search_path=pg_catalog, public, pg_temp") || normalize(fn.prosrc) !== normalize(source);
  })) throw new ReleaseCheckError("RLS/rollout helper functions differ from the reviewed hardened release.");
  const expectedConstraints = [
    ["patients", "patients_location_practice_fk", "FOREIGN KEY (location_id, practice_id) REFERENCES locations(id, practice_id)"],
    ["appointments", "appointments_location_practice_fk", "FOREIGN KEY (location_id, practice_id) REFERENCES locations(id, practice_id)"],
    ["appointments", "appointments_patient_location_fk", "FOREIGN KEY (patient_id, practice_id, location_id) REFERENCES patients(id, practice_id, location_id)"],
    ["clinical_request_keys", "clinical_request_keys_context", "CHECK ((((location_id IS NULL) AND (actor_user_id IS NULL)) OR ((location_id IS NOT NULL) AND (actor_user_id IS NOT NULL) AND ((length(btrim(actor_user_id)) >= 1) AND (length(btrim(actor_user_id)) <= 256)))))"],
  ];
  const constraints = (await client.query(`SELECT c.conname,c.convalidated,t.relname,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND c.conname=ANY($1::text[])`, [expectedConstraints.map((item) => item[1])])).rows;
  const trigger = (await client.query(`SELECT t.tgenabled,pg_get_triggerdef(t.oid) AS definition,p.proname,n.nspname
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid='public.practices'::regclass AND t.tgname='practices_location_activation' AND NOT t.tgisinternal`)).rows;
  if (constraints.length !== expectedConstraints.length || expectedConstraints.some(([table, name, definition]) => !constraints.some((actual) => actual.relname === table && actual.conname === name && actual.convalidated && normalize(actual.definition) === normalize(definition!))) || trigger.length !== 1 || !["O", "A"].includes(trigger[0].tgenabled) || trigger[0].proname !== "careiq_location_activation_guard" || trigger[0].nspname !== "public" || normalize(trigger[0].definition) !== "CREATE TRIGGER practices_location_activation BEFORE UPDATE OF authorization_mode ON public.practices FOR EACH ROW EXECUTE FUNCTION careiq_location_activation_guard()") throw new ReleaseCheckError("Location constraint definitions or the reviewed activation trigger differ from this release.");
}
