import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { ReleaseCheckError } from "./migration-safety.js";

const reviewedBody = /AS\s+\$\$([\s\S]*?)\$\$;/.exec(readFileSync(new URL("../../drizzle/0046_provider_availability_busy.sql", import.meta.url), "utf8"))?.[1];
const normalize = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const projectionColumns: Record<string, readonly string[]> = {
  practices: ["id", "status", "authorization_mode"], practice_member_access: ["practice_id", "user_id", "status"],
  location_assignments: ["practice_id", "user_id", "location_id", "active"], locations: ["id", "practice_id", "status"],
  providers: ["id", "practice_id", "status"], provider_locations: ["practice_id", "provider_id", "location_id", "active"],
  appointments: ["id", "practice_id", "location_id", "provider_id", "status", "scheduled_at", "ends_at"],
};

/** Catalog only: a private, nonprivileged owner receives only the reviewed conflict projection. */
export async function verifyAvailabilityDatabaseRelease(client: Pick<PoolClient, "query">) {
  const rows = (await client.query(`/* availability_busy_helper */
    SELECT p.prosecdef,p.proconfig,p.prosrc,p.proretset,p.prorettype='boolean'::regtype AS boolean_result,
      pg_has_role(current_user,p.proowner,'MEMBER') AS owns,
      owner_role.rolname='careiq_availability_reader' AS expected_owner,
      owner_role.rolcanlogin OR owner_role.rolsuper OR owner_role.rolbypassrls OR owner_role.rolcreatedb OR owner_role.rolcreaterole OR owner_role.rolinherit OR owner_role.rolreplication AS owner_privileged,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=p.proowner) AS owner_inherits,
      pg_has_role('careiq_clinical_runtime',p.proowner,'MEMBER') AS runtime_member,
      has_schema_privilege(owner_role.oid,'public','CREATE') OR has_schema_privilege(owner_role.oid,'audit','CREATE') OR has_database_privilege(owner_role.oid,current_database(),'CREATE') AS owner_can_create,
      has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
      has_function_privilege('careiq_clinical_runtime',p.oid,'EXECUTE') AS runtime_execute,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_roles owner_role ON owner_role.oid=p.proowner
    WHERE p.oid=to_regprocedure('public.careiq_provider_slot_busy(uuid,timestamptz,timestamptz,uuid)')`)).rows;
  if (!reviewedBody || rows.length !== 1 || rows.some(row => !row.prosecdef || row.proretset || !row.boolean_result || row.owns || !row.expected_owner || row.owner_privileged || row.owner_inherits || row.runtime_member || row.owner_can_create || !row.can_execute || !row.runtime_execute || row.public_execute || !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp") || normalize(row.prosrc) !== normalize(reviewedBody))) {
    throw new ReleaseCheckError("Provider availability helper differs from the reviewed protected boolean boundary.");
  }
  const policies = (await client.query(`/* availability_projection_policy */ SELECT policyname,permissive,cmd,roles::text[],qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appointments_availability_projection'`)).rows;
  const expression = "(practice_id = careiq_context_uuid('app.practice_id'::text))";
  if (policies.length !== 1 || policies.some(row => row.permissive !== "PERMISSIVE" || row.cmd !== "SELECT" || row.roles.join() !== "careiq_availability_reader" || normalize(row.qual) !== expression || row.with_check !== null)) throw new ReleaseCheckError("Provider availability projection policy differs from the reviewed private reader boundary.");
  const columns = (await client.query(`/* availability_projection_columns */ SELECT n.nspname,c.relname,a.attname,
    has_column_privilege('careiq_availability_reader',c.oid,a.attnum,'SELECT') AS can_select,
    has_column_privilege('careiq_availability_reader',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') AS excessive,
    has_table_privilege('careiq_availability_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_privilege,
    pg_has_role('careiq_availability_reader',c.relowner,'MEMBER') AS owns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname IN ('public','audit') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`)).rows;
  const expected = Object.entries(projectionColumns).flatMap(([table, names]) => names.map(name => `${table}.${name}`));
  if (columns.some(row => row.excessive || row.table_privilege || row.owns || row.can_select !== (row.nspname === "public" && (projectionColumns[row.relname]?.includes(row.attname) ?? false))) || expected.some(key => !columns.some(row => row.nspname === "public" && `${row.relname}.${row.attname}` === key && row.can_select))) throw new ReleaseCheckError("Provider availability reader grants exceed the reviewed scheduling projection.");
}
