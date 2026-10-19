import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { migrationsFolder, ReleaseCheckError } from './migration-safety.js';

type TableRule = { select: boolean; insert: boolean; update: boolean; delete?: boolean; updateColumns?: string[] };
const patientTables = ['communication_endpoints','communication_permission_events','delivery_intents','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases','patient_reminder_policies'];
const staffTables = ['staff_notification_events','staff_notifications','staff_notification_email_batches','staff_notification_snapshots','staff_notification_preferences','staff_notification_policies'];
const appendOnly = new Set(['communication_permission_events','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases']);
const rules: Record<string, TableRule> = Object.fromEntries(patientTables.map(table => [table,{select:true,insert:true,update:!appendOnly.has(table)}]));
Object.assign(rules, {
  staff_notification_events: {select:true,insert:true,update:false,updateColumns:['processed_at']},
  staff_notifications: {select:true,insert:true,update:false,updateColumns:['read_at','archived_at','snoozed_until','revision','email_state','email_destination_hash','email_attempt_count','email_next_at','email_provider_message_id','email_failure_code']},
  staff_notification_email_batches: {select:true,insert:true,update:true},
  staff_notification_snapshots: {select:true,insert:true,update:false,delete:true},
  staff_notification_preferences: {select:true,insert:true,update:true},
  staff_notification_policies: {select:true,insert:true,update:true},
  portal_communication_profiles: {select:true,insert:false,update:false},
  portal_communication_request_keys: {select:false,insert:false,update:false},
} satisfies Record<string,TableRule>);
const tableNames = Object.keys(rules);
const sorted = (values: string[]) => [...values].sort().join(',');
const normalized = (value: string | null | undefined) => value?.replaceAll('public.','').replaceAll('::text','').replace(/[\s()]/g,'').toLowerCase() ?? null;
const locationExpression = "careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')";
const selfExpression = (column: string) => `${column}=current_setting('app.actor_user_id',true)`;
type PolicyRule = { table: string; name: string; command: string; permissive: boolean; using: string | null; check: string | null };
const policyRules: PolicyRule[] = patientTables.map(table => ({table,name:'workflow_scope',command:'*',permissive:true,using:locationExpression,check:locationExpression}));
for (const table of staffTables) policyRules.push({table,name:'staff_location_scope',command:'*',permissive:false,using:locationExpression,check:locationExpression});
policyRules.push(
  {table:'staff_notification_events',name:'staff_events_scope',command:'*',permissive:true,using:'true',check:'true'},
  {table:'staff_notification_policies',name:'staff_policy_scope',command:'*',permissive:true,using:'true',check:'true'},
  {table:'staff_notification_preferences',name:'staff_preferences_self',command:'*',permissive:true,using:selfExpression('user_id'),check:selfExpression('user_id')},
  {table:'staff_notification_email_batches',name:'staff_email_self',command:'*',permissive:true,using:selfExpression('recipient_user_id'),check:selfExpression('recipient_user_id')},
  {table:'staff_notification_snapshots',name:'staff_snapshots_self',command:'*',permissive:true,using:selfExpression('recipient_user_id'),check:selfExpression('recipient_user_id')},
  {table:'staff_notifications',name:'staff_inbox_self',command:'r',permissive:true,using:selfExpression('recipient_user_id'),check:null},
  {table:'staff_notifications',name:'staff_receipt_self',command:'w',permissive:true,using:selfExpression('recipient_user_id'),check:selfExpression('recipient_user_id')},
  {table:'staff_notifications',name:'staff_fanout',command:'a',permissive:true,using:null,check:"EXISTS(SELECT 1 FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=staff_notifications.practice_id AND m.user_id=staff_notifications.recipient_user_id AND m.status='active' AND a.location_id=staff_notifications.location_id AND a.active)"},
  {table:'portal_communication_profiles',name:'workflow_scope',command:'r',permissive:true,using:locationExpression,check:null},
);
type TriggerRule = {table:string;name:string;schema:string;helper:string;type:number};
const triggerRules: TriggerRule[] = [
  ...patientTables.map(table=>({table,name:'workflow_mutation_evidence',schema:'audit',helper:'capture_mutation',type:29})),
  ...patientTables.map(table=>({table,name:'retained_delivery_fact',schema:'public',helper:'careiq_delivery_fact_guard',type:27})),
  ...staffTables.map(table=>({table,name:'notification_mutation_evidence',schema:'audit',helper:'capture_mutation',type:29})),
  {table:'portal_communication_profiles',name:'workflow_mutation_evidence',schema:'audit',helper:'capture_mutation',type:29},
  {table:'work_items',name:'staff_work_generation',schema:'public',helper:'careiq_staff_work_generation',type:19},
  {table:'work_items',name:'staff_ownership_event',schema:'public',helper:'careiq_staff_ownership_event',type:21},
  {table:'communication_permission_events',name:'communication_permission_profile_changed',schema:'public',helper:'careiq_communication_profile_changed',type:5},
  {table:'communication_endpoints',name:'communication_endpoint_profile_changed',schema:'public',helper:'careiq_communication_profile_changed',type:21},
];
const helperRules = [
  {name:'careiq_delivery_fact_guard',migration:0,arguments:'',definer:false,execute:false,path:true,result:'trigger'},
  {name:'careiq_delivery_destination_suppressed',migration:0,arguments:'account_value text, channel_value text, fingerprint_value text',definer:true,execute:true,path:true,result:'boolean'},
  {name:'careiq_staff_work_generation',migration:1,arguments:'',definer:false,execute:false,path:false,result:'trigger'},
  {name:'careiq_staff_ownership_event',migration:1,arguments:'',definer:false,execute:false,path:false,result:'trigger'},
  {name:'careiq_communication_profile_changed',migration:2,arguments:'',definer:true,execute:false,path:true,result:'trigger'},
  {name:'careiq_portal_communication_choices',migration:2,arguments:'grant_value uuid, choices_value jsonb, expected_revision bigint, email_account text, sms_account text, retry_key uuid, request_fingerprint text',definer:true,execute:true,path:true,result:'jsonb'},
  {name:'careiq_publish_completed_paperwork',migration:2,arguments:'request_uuid uuid, version_uuid uuid, is_signed boolean',definer:true,execute:true,path:true,result:'jsonb'},
];

/** Catalog-only checks. Never select message bodies, endpoints, bearer material, patient rows or secrets. */
export async function verifyNotificationDatabaseRelease(client: Pick<PoolClient,'query'>) {
  const metadata = (await client.query(`/* notification_metadata */
    SELECT c.relname AS table_name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
      pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
      has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
      has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
      has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
      has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
      has_any_column_privilege(current_user,c.oid,'SELECT') AS column_select,
      has_any_column_privilege(current_user,c.oid,'INSERT') AS column_insert,
      has_any_column_privilege(current_user,c.oid,'REFERENCES') AS column_references,
      has_table_privilege(current_user,c.oid,'TRUNCATE,REFERENCES,TRIGGER') AS excessive,
      ARRAY(SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,c.oid,a.attname,'UPDATE') ORDER BY a.attname) AS update_columns,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) OR
        EXISTS(SELECT 1 FROM pg_attribute at CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE at.attrelid=c.oid AND a.grantee=0) AS public_access
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tableNames])).rows;
  if(metadata.length!==tableNames.length || metadata.some(row=>{
    const rule=rules[row.table_name];
    return !rule || row.relkind!=='r' || !row.relrowsecurity || !row.relforcerowsecurity || row.owns || row.public_access || row.excessive || row.column_references ||
      row.can_select!==rule.select || row.can_insert!==rule.insert || row.can_update!==rule.update || row.can_delete!==Boolean(rule.delete) ||
      !rule.select&&row.column_select || !rule.insert&&row.column_insert ||
      !rule.update&&sorted(row.update_columns??[])!==sorted(rule.updateColumns??[]);
  })) throw new ReleaseCheckError('Notification runtime privileges, helper-only portal access or forced row-level security differ from this release.');

  const policies=(await client.query(`/* notification_policies */
    SELECT c.relname AS table_name,p.polname AS policy_name,p.polcmd AS command,p.polpermissive AS permissive,
      p.polroles=ARRAY[0::oid] AS public_role,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tableNames])).rows;
  if(policies.length!==policyRules.length || policyRules.some(rule=>{
    const row=policies.find(r=>r.table_name===rule.table&&r.policy_name===rule.name);
    return !row || row.command!==rule.command || row.permissive!==rule.permissive || !row.public_role || normalized(row.using_expression)!==normalized(rule.using) || normalized(row.check_expression)!==normalized(rule.check);
  })) throw new ReleaseCheckError('Notification location or recipient row-level security policies differ from this release.');

  const triggers=(await client.query(`/* notification_triggers */
    SELECT c.relname AS table_name,t.tgname AS trigger_name,t.tgenabled,t.tgtype AS trigger_type,p.proname AS helper,nf.nspname AS function_schema
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`,[[...tableNames,'work_items']])).rows;
  if(triggerRules.some(rule=>!triggers.some(row=>row.table_name===rule.table&&row.trigger_name===rule.name&&row.helper===rule.helper&&row.function_schema===rule.schema&&Number(row.trigger_type)===rule.type&&['O','A'].includes(row.tgenabled)))) {
    throw new ReleaseCheckError('Notification mutation evidence, ownership generation or retained-fact guards are incomplete or disabled.');
  }
  const helpers=(await client.query(`/* notification_helpers */
    SELECT p.proname,p.prosrc,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) AS arguments,p.prorettype::regtype::text AS result,
      pg_has_role(current_user,p.proowner,'MEMBER') AS owns,has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[])`,[helperRules.map(r=>r.name)])).rows;
  const migrations=await Promise.all(['0039_notification_delivery.sql','0040_staff_notifications.sql','0041_patient_communication_preferences.sql'].map(file=>readFile(`${migrationsFolder}/${file}`,'utf8')));
  if(helpers.length!==helperRules.length || helperRules.some(rule=>{
    const row=helpers.find(r=>r.proname===rule.name);
    const reviewed=new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${rule.name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`).exec(migrations[rule.migration]!)?.[1]?.trim();
    return !row || !reviewed || row.prosrc?.trim()!==reviewed || row.arguments!==rule.arguments || row.result!==rule.result || row.prosecdef!==rule.definer || row.owns || row.public_execute || row.can_execute!==rule.execute ||
      (rule.path ? !row.proconfig?.includes('search_path=pg_catalog, public, pg_temp') : row.proconfig!==null&&row.proconfig!==undefined);
  })) throw new ReleaseCheckError('Notification or portal communication helpers differ from their reviewed execution and integrity boundaries.');

  const generations=(await client.query(`/* notification_generation_columns */
    SELECT c.relname AS table_name,a.attname,a.attnotnull,a.atttypid::regtype::text AS type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND ((c.relname='work_items' AND a.attname IN('notification_due_generation','notification_owner_generation')) OR (c.relname='document_requests' AND a.attname='delivery_generation')) AND NOT a.attisdropped`)).rows;
  if(generations.length!==3 || generations.some(row=>!row.attnotnull || row.type!==(row.table_name==='work_items'?'bigint':'integer')))throw new ReleaseCheckError('Notification source generations are missing or have changed type/nullability.');
}
