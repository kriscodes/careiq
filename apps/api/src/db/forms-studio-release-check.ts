import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { ReleaseCheckError } from "./migration-safety.js";

const tables = ["form_submissions", "template_publication_checks", "template_field_bindings", "form_change_candidates", "form_change_decisions", "patient_portal_grants", "paperwork_library_items", "paperwork_notifications"];
const immutable = new Set(["form_submissions", "template_publication_checks", "template_field_bindings", "form_change_decisions"]);
const helperOnlyInsert = new Set(["paperwork_library_items", "paperwork_notifications"]);

const reviewedFulfillmentBody = /AS\s+\$\$([\s\S]*?)\$\$;/.exec(readFileSync(new URL("../../drizzle/0033_patient-fulfillment-purpose.sql", import.meta.url), "utf8"))?.[1]?.trim();

/** Catalog-only release checks. Clinical payloads and credentials are never selected. */
export async function verifyFormsStudioDatabaseRelease(client: Pick<PoolClient, "query">) {
  const metadata = (await client.query(`/* forms_studio_metadata */
    SELECT c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity,
      pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
      has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
      has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
      has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
      has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND has_column_privilege(current_user,c.oid,a.attname,'UPDATE')) AS column_update,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND has_column_privilege(current_user,c.oid,a.attname,'REFERENCES')) AS column_references,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_access
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables])).rows;
  if (metadata.length !== tables.length || metadata.some(row =>
    !row.relrowsecurity || !row.relforcerowsecurity || row.owns || !row.can_select ||
    row.can_insert === helperOnlyInsert.has(row.table_name) ||
    row.can_update === immutable.has(row.table_name) ||
    immutable.has(row.table_name) && row.column_update || row.excessive || row.column_references || row.public_access)) {
    throw new ReleaseCheckError("Forms studio runtime privileges or forced row-level security differ from this release.");
  }
  const evidence = (await client.query(`/* forms_studio_evidence */
    SELECT c.relname AS table_name,t.tgenabled FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.tgname='workflow_mutation_evidence'
      AND pn.nspname='audit' AND p.proname='capture_mutation' AND c.relname=ANY($1::text[])`, [tables])).rows;
  if (evidence.length !== tables.length || evidence.some(row => !["O", "A"].includes(row.tgenabled))) {
    throw new ReleaseCheckError("Forms studio database mutation evidence is incomplete or disabled.");
  }
  const helpers = ["careiq_patient_form_scope", "careiq_publish_completed_paperwork", "careiq_portal_paperwork", "careiq_record_portal_failure", "careiq_form_signer_authorized", "careiq_patient_adult_self_eligible"];
  const functions = (await client.query(`/* forms_studio_helpers */
    SELECT p.proname,p.prosecdef,p.proconfig,
      pg_has_role(current_user,p.proowner,'MEMBER') AS owns,
      has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[])`, [helpers])).rows;
  if (functions.length !== helpers.length || functions.some(row =>
    !row.prosecdef || row.owns || !row.can_execute || row.public_execute ||
    !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp"))) {
    throw new ReleaseCheckError("Patient paperwork helpers lack protected execution boundaries.");
  }
  const eligibility = (await client.query(`/* forms_studio_private_eligibility */
    SELECT p.prosecdef,p.proconfig,pg_has_role(current_user,p.proowner,'MEMBER') AS owns,
      has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='careiq_adult_self_eligible_at'
      AND pg_get_function_identity_arguments(p.oid)='birth_date date, zone_value text, checked_at timestamp with time zone'`)).rows;
  if (eligibility.length !== 1 || eligibility.some(row => row.prosecdef || row.owns || row.can_execute || row.public_execute ||
    !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp"))) {
    throw new ReleaseCheckError("Patient eligibility evaluation clock is not private.");
  }
  const fulfillment = (await client.query(`/* forms_studio_fulfillment_purpose */
    SELECT p.prosrc,p.prosecdef,p.proconfig,pg_has_role(current_user,p.proowner,'MEMBER') AS owns,
      has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p WHERE p.oid=to_regprocedure('public.careiq_patient_fulfill_item(uuid,uuid)')`)).rows;
  if (!reviewedFulfillmentBody || fulfillment.length !== 1 || fulfillment.some(row =>
    row.prosrc?.trim() !== reviewedFulfillmentBody || !row.prosecdef || row.owns || !row.can_execute || row.public_execute ||
    !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp"))) {
    throw new ReleaseCheckError("Patient fulfillment purpose boundary differs from the reviewed release.");
  }
}
