import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { verifyNotificationDatabaseRelease } from '../src/db/notification-release-check.js';

const patient=['communication_endpoints','communication_permission_events','delivery_intents','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases','patient_reminder_policies'];
const staff=['staff_notification_events','staff_notifications','staff_notification_email_batches','staff_notification_snapshots','staff_notification_preferences','staff_notification_policies'];
const immutable=['communication_permission_events','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases'];
const files=['0039_notification_delivery.sql','0040_staff_notifications.sql','0041_patient_communication_preferences.sql'].map(file=>readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
type Rows=Record<string,any>[];
type Fixture={metadata:Rows;policies:Rows;triggers:Rows;helpers:Rows;generations:Rows};
function fixture(change?:(data:Fixture)=>void){
  const metadata=[...patient,...staff,'portal_communication_profiles','portal_communication_request_keys'].map(table_name=>{
    const portal=table_name.startsWith('portal_'),hidden=table_name==='portal_communication_request_keys',partial=['staff_notification_events','staff_notifications'].includes(table_name);
    return {table_name,relkind:'r',relrowsecurity:true,relforcerowsecurity:true,owns:false,can_select:!hidden,can_insert:!portal,can_update:!portal&&!partial&&!immutable.includes(table_name)&&table_name!=='staff_notification_snapshots',can_delete:table_name==='staff_notification_snapshots',column_select:!hidden,column_insert:!portal,column_references:false,excessive:false,public_access:false,update_columns:table_name==='staff_notification_events'?['processed_at']:table_name==='staff_notifications'?['read_at','archived_at','snoozed_until','revision','email_state','email_destination_hash','email_attempt_count','email_next_at','email_provider_message_id','email_failure_code']:[]};
  });
  const location="(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))",self=(column:string)=>`(${column} = current_setting('app.actor_user_id'::text, true))`;
  const p=(table_name:string,policy_name:string,command:string,permissive:boolean,using_expression:string|null,check_expression:string|null)=>({table_name,policy_name,command,permissive,public_role:true,using_expression,check_expression});
  const policies=[...patient.map(t=>p(t,'workflow_scope','*',true,location,location)),...staff.map(t=>p(t,'staff_location_scope','*',false,location,location)),p('staff_notification_events','staff_events_scope','*',true,'true','true'),p('staff_notification_policies','staff_policy_scope','*',true,'true','true'),p('staff_notification_preferences','staff_preferences_self','*',true,self('user_id'),self('user_id')),p('staff_notification_email_batches','staff_email_self','*',true,self('recipient_user_id'),self('recipient_user_id')),p('staff_notification_snapshots','staff_snapshots_self','*',true,self('recipient_user_id'),self('recipient_user_id')),p('staff_notifications','staff_inbox_self','r',true,self('recipient_user_id'),null),p('staff_notifications','staff_receipt_self','w',true,self('recipient_user_id'),self('recipient_user_id')),p('staff_notifications','staff_fanout','a',true,null,"(EXISTS ( SELECT 1 FROM (practice_member_access m JOIN location_assignments a ON (((a.practice_id = m.practice_id) AND (a.user_id = m.user_id)))) WHERE ((m.practice_id = staff_notifications.practice_id) AND (m.user_id = staff_notifications.recipient_user_id) AND (m.status = 'active'::text) AND (a.location_id = staff_notifications.location_id) AND a.active)))"),p('portal_communication_profiles','workflow_scope','r',true,location,null)];
  const tr=(table_name:string,trigger_name:string,helper:string,trigger_type:number,function_schema='public')=>({table_name,trigger_name,helper,trigger_type,function_schema,tgenabled:'O'});
  const triggers=[...patient.map(t=>tr(t,'workflow_mutation_evidence','capture_mutation',29,'audit')),...patient.map(t=>tr(t,'retained_delivery_fact','careiq_delivery_fact_guard',27)),...staff.map(t=>tr(t,'notification_mutation_evidence','capture_mutation',29,'audit')),tr('portal_communication_profiles','workflow_mutation_evidence','capture_mutation',29,'audit'),tr('work_items','staff_work_generation','careiq_staff_work_generation',19),tr('work_items','staff_ownership_event','careiq_staff_ownership_event',21),tr('communication_permission_events','communication_permission_profile_changed','careiq_communication_profile_changed',5),tr('communication_endpoints','communication_endpoint_profile_changed','careiq_communication_profile_changed',21)];
  const definitions=[['careiq_delivery_fact_guard',0,'',false,false,true,'trigger'],['careiq_delivery_destination_suppressed',0,'account_value text, channel_value text, fingerprint_value text',true,true,true,'boolean'],['careiq_staff_work_generation',1,'',false,false,false,'trigger'],['careiq_staff_ownership_event',1,'',false,false,false,'trigger'],['careiq_communication_profile_changed',2,'',true,false,true,'trigger'],['careiq_portal_communication_choices',2,'grant_value uuid, choices_value jsonb, expected_revision bigint, email_account text, sms_account text, retry_key uuid, request_fingerprint text',true,true,true,'jsonb'],['careiq_publish_completed_paperwork',2,'request_uuid uuid, version_uuid uuid, is_signed boolean',true,true,true,'jsonb']] as const;
  const helpers=definitions.map(([proname,file,arguments_,prosecdef,can_execute,path,result])=>{const start=files[file]!.indexOf('FUNCTION public.'+proname+'('),tail=files[file]!.slice(start);return {proname,arguments:arguments_,prosrc:tail.split(' AS $$')[1]!.split('$$;')[0]!.trim(),prosecdef,can_execute,proconfig:path?['search_path=pg_catalog, public, pg_temp']:null,result,owns:false,public_execute:false};});
  const generations=[{table_name:'work_items',attname:'notification_due_generation',attnotnull:true,type:'bigint'},{table_name:'work_items',attname:'notification_owner_generation',attnotnull:true,type:'bigint'},{table_name:'document_requests',attname:'delivery_generation',attnotnull:true,type:'integer'}];
  const data={metadata,policies,triggers,helpers,generations};change?.(data);
  return {query:async(sql:string)=>{const key=Object.keys(data).find(key=>sql.includes('notification_'+(key==='generations'?'generation_columns':key)));if(!key)throw new Error('Unexpected release query');return {rows:data[key as keyof Fixture]};}} as unknown as Pick<PoolClient,'query'>;
}
test('notification release accepts scoped runtime grants, exact receipt updates and helper-only portal writes',async()=>{await verifyNotificationDatabaseRelease(fixture());});
test('notification release rejects missing forced RLS, public access and owning runtime',async()=>{
  for(const field of ['relforcerowsecurity','public_access','owns'])await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata[0]![field]=field!=='relforcerowsecurity';})),/privileges/);
});
test('notification release rejects mutation of append-only delivery facts or extra ownership columns',async()=>{
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata.find(r=>r.table_name==='delivery_attempt_events')!.update_columns=['event_type'];})),/privileges/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata.find(r=>r.table_name==='staff_notifications')!.update_columns.push('recipient_user_id');})),/privileges/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata.find(r=>r.table_name==='staff_notification_events')!.can_update=true;})),/privileges/);
});
test('notification release forbids direct or column-level reads/writes on private portal idempotency records',async()=>{
  for(const field of ['can_select','can_insert','column_select','column_insert'])await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata.find(r=>r.table_name==='portal_communication_request_keys')![field]=true;})),/portal access/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.metadata.find(r=>r.table_name==='portal_communication_profiles')!.can_insert=true;})),/portal access/);
});
test('notification release rejects a permissive location policy, missing recipient restriction or extra bypass policy',async()=>{
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.policies.find(r=>r.policy_name==='staff_location_scope')!.permissive=true;})),/policies/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.policies.find(r=>r.policy_name==='staff_inbox_self')!.using_expression='true';})),/policies/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.policies.push({...d.policies[0],policy_name:'unexpected_bypass',using_expression:'true'});})),/policies/);
});
test('notification release requires audit, retained-fact and ownership/profile generation triggers',async()=>{
  for(const name of ['workflow_mutation_evidence','retained_delivery_fact','staff_work_generation','communication_permission_profile_changed'])await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.triggers.find(r=>r.trigger_name===name)!.tgenabled='D';})),/guards/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.triggers.find(r=>r.trigger_name==='staff_ownership_event')!.trigger_type=5;})),/guards/);
});
test('notification release rejects public/private helper execution or an unsafe definer search path',async()=>{
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.helpers.find(r=>r.proname==='careiq_communication_profile_changed')!.can_execute=true;})),/boundaries/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.helpers.find(r=>r.proname==='careiq_portal_communication_choices')!.public_execute=true;})),/boundaries/);
  await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.helpers.find(r=>r.proname==='careiq_delivery_destination_suppressed')!.proconfig=['search_path=public'];})),/boundaries/);
});
test('notification release pins reviewed portal eligibility, opt-out and exact-copy helper bodies',async()=>{
  for(const name of ['careiq_delivery_destination_suppressed','careiq_portal_communication_choices','careiq_publish_completed_paperwork'])await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.helpers.find(r=>r.proname===name)!.prosrc+=' RETURN NULL;';})),/boundaries/);
});
test('notification release requires non-null generations of the reviewed types',async()=>{await assert.rejects(verifyNotificationDatabaseRelease(fixture(d=>{d.generations[0]!.attnotnull=false;})),/generations/);});
