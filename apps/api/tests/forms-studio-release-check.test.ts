import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { verifyFormsStudioDatabaseRelease } from "../src/db/forms-studio-release-check.js";

const tables = ["form_submissions", "template_publication_checks", "template_field_bindings", "form_change_candidates", "form_change_decisions", "patient_portal_grants", "paperwork_library_items", "paperwork_notifications"];
const immutable = new Set(["form_submissions", "template_publication_checks", "template_field_bindings", "form_change_decisions"]);
function fixture(change?: (metadata: Record<string, unknown>[], evidence: Record<string, unknown>[], helpers: Record<string, unknown>[], eligibility: Record<string, unknown>[], fulfillment: Record<string, unknown>[]) => void) {
  const metadata = tables.map(table_name => ({table_name,relrowsecurity:true,relforcerowsecurity:true,owns:false,can_select:true,can_insert:!["paperwork_library_items","paperwork_notifications"].includes(table_name),can_update:!immutable.has(table_name),column_update:!immutable.has(table_name),excessive:false,column_references:false,public_access:false}));
  const evidence = tables.map(table_name => ({table_name,tgenabled:"O"}));
  const helpers = ["careiq_patient_form_scope","careiq_publish_completed_paperwork","careiq_portal_paperwork", "careiq_record_portal_failure", "careiq_form_signer_authorized", "careiq_patient_adult_self_eligible"].map(proname => ({proname,prosecdef:true,proconfig:["search_path=pg_catalog, public, pg_temp"],owns:false,can_execute:true,public_execute:false}));
  const eligibility = [{prosecdef:false,proconfig:["search_path=pg_catalog, public, pg_temp"],owns:false,can_execute:false,public_execute:false}];
  const fulfillment = [{prosrc:/AS\s+\$\$([\s\S]*?)\$\$;/.exec(readFileSync(new URL("../drizzle/0033_patient-fulfillment-purpose.sql", import.meta.url),"utf8"))?.[1],prosecdef:true,proconfig:["search_path=pg_catalog, public, pg_temp"],owns:false,can_execute:true,public_execute:false}];
  change?.(metadata,evidence,helpers,eligibility,fulfillment);
  return {query:async (sql: string) => ({rows:sql.includes("forms_studio_metadata")?metadata:sql.includes("forms_studio_evidence")?evidence:sql.includes("forms_studio_private_eligibility")?eligibility:sql.includes("forms_studio_fulfillment_purpose")?fulfillment:helpers})} as unknown as Pick<PoolClient,"query">;
}
test("forms studio release accepts forced RLS, helper-only publication and protected audit capture",async()=>{await verifyFormsStudioDatabaseRelease(fixture());});
test("forms studio release rejects column UPDATE on an immutable signed-source fact",async()=>{await assert.rejects(verifyFormsStudioDatabaseRelease(fixture(rows=>{rows[0]!.column_update=true;})),/privileges/);});
test("forms studio release rejects direct runtime library insertion",async()=>{await assert.rejects(verifyFormsStudioDatabaseRelease(fixture(rows=>{rows.find(row=>row.table_name==="paperwork_library_items")!.can_insert=true;})),/privileges/);});
test("forms studio release rejects disabled mutation audit or publicly executable portal helper",async()=>{await assert.rejects(verifyFormsStudioDatabaseRelease(fixture((_rows,evidence)=>{evidence[0]!.tgenabled="D";})),/evidence/);await assert.rejects(verifyFormsStudioDatabaseRelease(fixture((_rows,_evidence,helpers)=>{helpers[0]!.public_execute=true;})),/boundaries/);});
test("forms studio release rejects runtime control of the private eligibility clock",async()=>{await assert.rejects(verifyFormsStudioDatabaseRelease(fixture((_rows,_evidence,_helpers,eligibility)=>{eligibility[0]!.can_execute=true;})),/clock/);});
test("forms studio release rejects a changed patient fulfillment purpose guard",async()=>{await assert.rejects(verifyFormsStudioDatabaseRelease(fixture((_rows,_evidence,_helpers,_eligibility,fulfillment)=>{fulfillment[0]!.prosrc=String(fulfillment[0]!.prosrc).replace("NOT IN (\'collection\',\'replacement\')","IS NULL");})),/purpose boundary/);});
