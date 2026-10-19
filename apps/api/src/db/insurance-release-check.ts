import type { PoolClient } from "pg";
import { ReleaseCheckError } from "./migration-safety.js";

/** Catalog checks only: do not query member identifiers, benefits or source references. */
export async function verifyInsuranceDatabaseRelease(client: Pick<PoolClient, "query">) {
  const tables = ["insurance_cases", "insurance_evidence"];
  const metadata = (await client.query(`SELECT c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_any_column_privilege(current_user,c.oid,'UPDATE') AS can_update_column,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables])).rows;
  if (metadata.length !== 2 || metadata.some(row => !row.relrowsecurity || !row.relforcerowsecurity || row.owns || !row.can_select || !row.can_insert || row.excessive || (row.table_name === "insurance_cases" ? !row.can_update : row.can_update || row.can_update_column))) {
    throw new ReleaseCheckError("Insurance runtime grants or forced row-level security differ from this release.");
  }
  const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname,t.tgenabled,p.proname,nf.nspname AS function_schema
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`, [tables])).rows;
  for (const table of tables) {
    const mutation = triggers.find(row => row.table_name === table && row.tgname === "workflow_mutation_evidence" && row.proname === "capture_mutation" && row.function_schema === "audit" && ["O","A"].includes(row.tgenabled));
    const integrity = triggers.find(row => row.table_name === table && row.tgname === (table === "insurance_cases" ? "insurance_case_guard" : "insurance_evidence_immutable") && row.proname === (table === "insurance_cases" ? "careiq_insurance_case_guard" : "careiq_reject_immutable") && row.function_schema === "public" && ["O","A"].includes(row.tgenabled));
    if (!mutation || !integrity) throw new ReleaseCheckError("Insurance database mutation or integrity evidence is incomplete or disabled.");
  }
  const observationGuard = triggers.find(row => row.table_name === "insurance_evidence" && row.tgname === "insurance_evidence_guard" && row.proname === "careiq_insurance_evidence_guard" && row.function_schema === "public" && ["O","A"].includes(row.tgenabled));
  if (!observationGuard) throw new ReleaseCheckError("Insurance evidence must retain exact appointment and policy applicability.");
  const helpers = (await client.query(`SELECT p.prosecdef,p.proconfig,
    pg_has_role(current_user,p.proowner,'MEMBER') AS owns,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='audit' AND p.proname='insurance_activity'`)).rows;
  if (helpers.length !== 1 || helpers.some(row => !row.prosecdef || row.owns || !row.can_execute || row.public_execute || !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp"))) {
    throw new ReleaseCheckError("Insurance activity must use a protected executable projection without public or owning access.");
  }
}
