import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { Pool,type PoolClient } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';

const url=isolatedTestDatabaseUrl();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function rejected(client:PoolClient,sql:string,values:unknown[],code:string) {
  await client.query('SAVEPOINT expected_rejection');
  try { await assert.rejects(client.query(sql,values),(error:unknown)=>(error as {code?:string}).code===code); }
  finally { await client.query('ROLLBACK TO SAVEPOINT expected_rejection'); }
}

test('workflow schema enforces clinical scope, scheduling, immutable evidence and append-only audit under restricted role', {skip:!url},async context=>{
 const pool=new Pool({connectionString:url,ssl:false,max:1});const client=await pool.connect();
 const p=randomUUID(),l=randomUUID(),otherLocation=randomUUID(),patient=randomUUID(),otherPatient=randomUUID(),provider=randomUUID(),type=randomUUID(),appointment=randomUUID(),docType=randomUUID(),doc=randomUUID(),version=randomUUID();
 const actor='synthetic_workflow_actor';
 try {
  await client.query('BEGIN');
  await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status,owner_user_id) VALUES($1,$2,'Synthetic workflow','location','active',$3)",[p,'org_'+p,actor]);
  await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic A','America/Los_Angeles'),($2,$3,'Synthetic B','America/Los_Angeles')",[l,otherLocation,p]);
  await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,'synthetic_membership','active')",[p,actor]);
  await client.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2),($1,$2,$4,true,$2)",[p,actor,l,otherLocation]);
  await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$3,$4,'Secret first','Secret last'),($2,$3,$5,'Other secret','Other last')",[patient,otherPatient,p,l,otherLocation]);
  await client.query("INSERT INTO providers(id,practice_id,display_name) VALUES($1,$2,'Synthetic provider')",[provider,p]);
  await client.query('INSERT INTO provider_locations(practice_id,location_id,provider_id) VALUES($1,$2,$4),($1,$3,$4)',[p,l,otherLocation,provider]);
  await client.query("INSERT INTO visit_types(id,practice_id,code,name,default_duration_minutes) VALUES($1,$2,'test','Synthetic visit',30)",[type,p]);
  await client.query("INSERT INTO document_types(id,practice_id,code,name) VALUES($1,$2,'intake','Synthetic intake')",[docType,p]);
  await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)",[p,l,actor]);
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');

  await context.test('provider overlap is rejected across locations while adjacent appointments remain valid',async()=>{
   await client.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at,ends_at,provider_id,visit_type_id) VALUES($1,$2,$3,$4,'2027-01-04T10:00Z','2027-01-04T10:30Z',$5,$6)",[appointment,p,l,patient,provider,type]);
   await client.query("SELECT set_config('app.location_id',$1,true)",[otherLocation]);
   await rejected(client,"INSERT INTO appointments(practice_id,location_id,patient_id,scheduled_at,ends_at,provider_id) VALUES($1,$2,$3,'2027-01-04T10:15Z','2027-01-04T10:45Z',$4)",[p,otherLocation,otherPatient,provider],'23P01');
   await client.query("INSERT INTO appointments(practice_id,location_id,patient_id,scheduled_at,ends_at,provider_id) VALUES($1,$2,$3,'2027-01-04T10:30Z','2027-01-04T11:00Z',$4)",[p,otherLocation,otherPatient,provider]);
   await client.query("SELECT set_config('app.location_id',$1,true)",[l]);
   assert.equal((await client.query('SELECT id FROM patients WHERE id=$1',[otherPatient])).rowCount,0);
  });
  await context.test('audit writer and independent row evidence preserve correlation without copying protected fields',async()=>{
   const event=(await client.query("SELECT audit.record_event($1::jsonb,$2::jsonb) AS id",[JSON.stringify({action:'patients.update',entityType:'patient',entityId:patient,metadata:{revision:2}}),JSON.stringify([{resourceType:'patient',resourceId:patient,relationship:'primary',patientId:patient}])])).rows[0].id;
   await client.query("UPDATE patients SET first_name='Changed private',revision=revision+1 WHERE id=$1",[patient]);
   await rejected(client,'SELECT * FROM audit.events',[],'42501');
   await rejected(client,"SELECT audit.record_event($1::jsonb)",[JSON.stringify({action:'patients.update',entityType:'patient',metadata:{firstName:'Must never be logged'}})],'22023');
   await rejected(client,"SELECT audit.record_event($1::jsonb,$2::jsonb)",[JSON.stringify({action:'patients.update',entityType:'patient'}),JSON.stringify([{resourceType:'patient',resourceId:otherPatient,patientId:otherPatient}])],'42501');
   const projected=await client.query('SELECT * FROM audit.activity($1::uuid)',[patient]);assert.equal(projected.rows[0].id,event);
   await client.query('RESET ROLE');
   const rows=await client.query("SELECT * FROM audit.database_records WHERE table_name='patients' AND row_key->>'id'=$1 AND operation='UPDATE'",[patient]);
   assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].application_event_id,event);assert.ok(rows.rows[0].changed_fields.includes('first_name'));
   assert.equal(JSON.stringify(rows.rows[0]).includes('Changed private'),false);assert.equal(JSON.stringify(rows.rows[0]).includes('Secret first'),false);
   await rejected(client,"UPDATE audit.events SET action='tampered' WHERE id=$1",[event],'23514');
   await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  });
  await context.test('waived requirements remain unique and document versions bind exact patient and scope',async()=>{
   await client.query("INSERT INTO visit_requirements(practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot,lifecycle_state,waiver_reason_code,waived_by_actor_id,waived_at) VALUES($1,$2,$3,$4,$5,'Synthetic intake','waived','not_needed',$6,now())",[p,l,patient,appointment,docType,actor]);
   await rejected(client,"INSERT INTO visit_requirements(practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot) VALUES($1,$2,$3,$4,$5,'Duplicate')",[p,l,patient,appointment,docType],'23505');
   await client.query('INSERT INTO documents(id,practice_id,location_id,patient_id,document_type_id,title) VALUES($1,$2,$3,$4,$5,\'Synthetic document\')',[doc,p,l,patient,docType]);
   await client.query("INSERT INTO document_versions(id,practice_id,location_id,patient_id,document_id,version_number,source,created_by_actor_id) VALUES($1,$2,$3,$4,$5,1,'staff_upload',$6)",[version,p,l,patient,doc,actor]);
   await rejected(client,'UPDATE document_versions SET version_number=2 WHERE id=$1',[version],'42501');
   await client.query('RESET ROLE');await rejected(client,'UPDATE document_versions SET version_number=2 WHERE id=$1',[version],'23514');await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  });
  await context.test('anonymous rejection remains platform scoped and protected events never enter clinical activity',async()=>{
   await client.query("SELECT audit.record_event($1::jsonb)",[JSON.stringify({action:'audit.export',entityType:'audit',metadata:{count:1}})]);
   assert.equal((await client.query('SELECT * FROM audit.activity()')).rows.some(row=>row.action==='audit.export'),false);
   await client.query("SELECT set_config('app.practice_id','',true),set_config('app.location_id','',true),set_config('app.actor_user_id','',true)");
   const event=(await client.query('SELECT audit.record_event($1::jsonb) AS id',[JSON.stringify({action:'patient_link.invalid',entityType:'access_grant',actorType:'anonymous',outcome:'denied',reasonCode:'INVALID_TOKEN'})])).rows[0].id;
   await client.query('RESET ROLE');const record=(await client.query('SELECT scope_kind,practice_id,location_id,actor_type,actor_id FROM audit.events WHERE id=$1',[event])).rows[0];
   assert.deepEqual(record,{scope_kind:'platform',practice_id:null,location_id:null,actor_type:'anonymous',actor_id:null});
  });
 } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});

test('patient tokens authorize only their live request and exact source documents', {skip:!url},async()=>{
 const pool=new Pool({connectionString:url,ssl:false,max:1});const client=await pool.connect();
 const p=randomUUID(),l=randomUUID(),patient=randomUUID(),otherPatient=randomUUID(),type=randomUUID(),request=randomUUID(),otherRequest=randomUUID(),grant=randomUUID(),session=randomUUID(),doc=randomUUID(),unrelatedDoc=randomUUID(),version=randomUUID(),packet=randomUUID();
 const grantHash=hash(randomUUID()),sessionHash=hash(randomUUID());
 try {
  await client.query('BEGIN');
  await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic public scope','location')",[p,'org_'+p]);
  await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic public','UTC')",[l,p]);
  await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$3,$4,'Synthetic','One'),($2,$3,$4,'Synthetic','Two')",[patient,otherPatient,p,l]);
  await client.query("INSERT INTO document_types(id,practice_id,code,name) VALUES($1,$2,'consent','Synthetic consent')",[type,p]);
  await client.query("INSERT INTO document_requests(id,practice_id,location_id,patient_id,purpose,recipient_name,expires_at,state,created_by_actor_id) VALUES($1,$3,$4,$5,'signature','Synthetic',now()+interval '1 day','open','synthetic'),($2,$3,$4,$6,'collection','Synthetic',now()+interval '1 day','open','synthetic')",[request,otherRequest,p,l,patient,otherPatient]);
  await client.query("INSERT INTO patient_access_grants(id,practice_id,location_id,patient_id,request_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day')",[grant,p,l,patient,request,grantHash]);
  await client.query("INSERT INTO patient_sessions(id,practice_id,location_id,patient_id,request_id,grant_id,token_hash,request_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,now()+interval '1 hour')",[session,p,l,patient,request,grant,sessionHash]);
  await client.query("INSERT INTO documents(id,practice_id,location_id,patient_id,document_type_id,title) VALUES($1,$3,$4,$5,$6,'Allowed source'),($2,$3,$4,$5,$6,'Unrelated secret')",[doc,unrelatedDoc,p,l,patient,type]);
  await client.query("INSERT INTO document_versions(id,practice_id,location_id,patient_id,document_id,version_number,source,created_by_actor_id) VALUES($1,$2,$3,$4,$5,1,'staff_upload','synthetic')",[version,p,l,patient,doc]);
  await client.query("INSERT INTO signature_packets(id,practice_id,location_id,patient_id,request_id,source_version_id,consent_text_version,consent_text,consent_hash) VALUES($1,$2,$3,$4,$5,$6,'v1','Synthetic consent',$7)",[packet,p,l,patient,request,version,hash('Synthetic consent')]);
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  await client.query("SELECT set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session','true',true)",[sessionHash]);
  const resolved=(await client.query('SELECT careiq_resolve_patient_access($1,true) AS access',[sessionHash])).rows[0].access;assert.equal(resolved.request_id,request);
  assert.deepEqual((await client.query('SELECT id FROM document_requests ORDER BY id')).rows.map(row=>row.id),[request]);
  assert.deepEqual((await client.query('SELECT id FROM documents ORDER BY id')).rows.map(row=>row.id),[doc]);
  assert.equal((await client.query('SELECT id FROM patients')).rowCount,0);
  await rejected(client,"INSERT INTO documents(practice_id,location_id,patient_id,document_type_id,title,request_id) VALUES($1,$2,$3,$4,'Wrong patient',$5)",[p,l,otherPatient,type,request],'42501');
  const event=(await client.query('SELECT audit.record_event($1::jsonb) AS id',[JSON.stringify({action:'signatures.presented',entityType:'signature_packet',entityId:packet})])).rows[0].id;
  await client.query('RESET ROLE');const audited=(await client.query('SELECT actor_type,actor_id,practice_id FROM audit.events WHERE id=$1',[event])).rows[0];assert.equal(audited.actor_type,'patient_session');assert.equal(audited.actor_id,session);assert.equal(audited.practice_id,p);
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  const file=randomUUID(),operation=randomUUID(),job=randomUUID(),outputVersion=randomUUID();
  await client.query("INSERT INTO file_objects(id,practice_id,location_id,patient_id,request_id,storage_key,storage_version,original_filename,declared_media_type,detected_media_type,expected_bytes,actual_bytes,sha256,status,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,'immutable-version','synthetic.pdf','application/pdf','application/pdf',1,1,$7,'available',now()+interval '10 minutes')",[file,p,l,patient,request,randomUUID(),hash('bytes')]);
  await rejected(client,'UPDATE file_objects SET sha256=$2 WHERE id=$1',[file,hash('changed bytes')],'23514');
  await client.query("INSERT INTO workflow_operations(id,practice_id,location_id,patient_request_id,operation_type,initiating_actor_type,initiating_actor_id,target_type,target_id,command_fingerprint,state,result_type,result_id) VALUES($1,$2,$3,$4,'signature_completion','patient_session',$5,'signature_packet',$6,$7,'running','document_version',$8)",[operation,p,l,request,session,packet,hash('completion'),outputVersion]);
  await client.query("INSERT INTO job_runs(id,practice_id,location_id,operation_id,job_type,job_version,attempt,executor_id,fencing_token) VALUES($1,$2,$3,$4,'signature_completion','v1',1,'synthetic_renderer',$5)",[job,p,l,operation,randomUUID()]);
  await client.query("INSERT INTO file_scan_runs(practice_id,location_id,patient_id,file_object_id,job_run_id,attempt,scanner_version,ruleset_version,verified_storage_version,verified_sha256,verdict,audit_event_id) VALUES($1,$2,$3,$4,$5,1,'synthetic_scanner','test-v1','immutable-version',$6,'clean',$7)",[p,l,patient,file,job,hash('bytes'),event]);
  await client.query("UPDATE job_runs SET state='succeeded',finished_at=now() WHERE id=$1",[job]);
  await rejected(client,"UPDATE job_runs SET failure_code='tampered' WHERE id=$1",[job],'23514');
  await client.query("INSERT INTO document_versions(id,practice_id,location_id,patient_id,request_id,document_id,version_number,source,source_version_id,file_object_id,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,2,'signed_output',$7,$8,$9)",[outputVersion,p,l,patient,request,doc,version,file,session]);
  await client.query("UPDATE signature_packets SET state='completed',output_version_id=$2,evidence_object_id=$3 WHERE id=$1",[packet,outputVersion,file]);
  await client.query("UPDATE workflow_operations SET state='succeeded',completed_at=now() WHERE id=$1",[operation]);
  const closed=(await client.query("SELECT careiq_patient_close_request('completed') AS receipt")).rows[0].receipt;assert.equal(closed.state,'completed');
  assert.equal((await client.query('SELECT id FROM document_requests')).rowCount,0);
  const receipt=(await client.query('SELECT careiq_patient_completion_receipt($1) AS receipt',[sessionHash])).rows[0].receipt;
  assert.equal(receipt.operationId,operation);assert.equal(receipt.documentVersionId,outputVersion);assert.equal(receipt.commandFingerprint,hash('completion'));
  assert.equal(Object.keys(receipt).some(key=>/token|name|email|answer|consent/i.test(key)),false);
  await client.query('RESET ROLE');
  await client.query('UPDATE patient_sessions SET revoked_at=now() WHERE id=$1',[session]);await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  assert.equal((await client.query('SELECT careiq_resolve_patient_access($1,true) AS access',[sessionHash])).rows[0].access,null);assert.equal((await client.query('SELECT careiq_patient_completion_receipt($1) AS receipt',[sessionHash])).rows[0].receipt,null);assert.equal((await client.query('SELECT id FROM documents')).rowCount,0);
 } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});


test('failed command evidence can be recorded in a new transaction after business rollback', {skip:!url},async()=>{
 const pool=new Pool({connectionString:url,ssl:false,max:1});const client=await pool.connect();
 try {
  await client.query('BEGIN');await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  const aborted=(await client.query("SELECT audit.record_event($1::jsonb) AS id",[JSON.stringify({action:'security.synthetic_failed_attempt',entityType:'command',actorType:'anonymous',outcome:'rejected'})])).rows[0].id;
  await client.query('ROLLBACK');
  await client.query('BEGIN');await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  const recorded=(await client.query("SELECT audit.record_event($1::jsonb) AS id",[JSON.stringify({action:'security.synthetic_failed_attempt',entityType:'command',actorType:'anonymous',outcome:'failed',reasonCode:'TEST_ROLLBACK'})])).rows[0].id;
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT id FROM audit.events WHERE id=$1',[aborted])).rowCount,0);
  assert.equal((await client.query('SELECT id FROM audit.events WHERE id=$1',[recorded])).rowCount,1);
 } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});

test('public collection fulfillment validates bytes and projects review work or selected evidence atomically', {skip:!url},async()=>{
 const pool=new Pool({connectionString:url,ssl:false,max:1});const client=await pool.connect();
 const p=randomUUID(),l=randomUUID(),patient=randomUUID(),appointment=randomUUID(),request=randomUUID(),grant=randomUUID(),session=randomUUID();
 const types=[randomUUID(),randomUUID()],requirements=[randomUUID(),randomUUID()],items=[randomUUID(),randomUUID()],docs=[randomUUID(),randomUUID()],versions=[randomUUID(),randomUUID()],files=[randomUUID(),randomUUID()];
 const tokenHash=hash(randomUUID()),commandKey=randomUUID();
 try {
  await client.query('BEGIN');
  await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic collection','location')",[p,'org_'+p]);
  await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic collection','UTC')",[l,p]);
  await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic','Collection')",[patient,p,l]);
  await client.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[appointment,p,l,patient]);
  await client.query("INSERT INTO document_requests(id,practice_id,location_id,patient_id,appointment_id,purpose,recipient_name,expires_at,state,created_by_actor_id) VALUES($1,$2,$3,$4,$5,'collection','Synthetic',now()+interval '1 day','open','synthetic')",[request,p,l,patient,appointment]);
  await client.query("INSERT INTO patient_access_grants(id,practice_id,location_id,patient_id,request_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day')",[grant,p,l,patient,request,hash(randomUUID())]);
  await client.query("INSERT INTO patient_sessions(id,practice_id,location_id,patient_id,request_id,grant_id,token_hash,request_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,now()+interval '1 hour')",[session,p,l,patient,request,grant,tokenHash]);
  for(let i=0;i<2;i++){
   await client.query('INSERT INTO document_types(id,practice_id,code,name) VALUES($1,$2,$3,\'Synthetic type\')',[types[i],p,'type_'+i]);
   await client.query("INSERT INTO visit_requirements(id,practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot,review_required) VALUES($1,$2,$3,$4,$5,$6,'Synthetic requirement',$7)",[requirements[i],p,l,patient,appointment,types[i],i===0]);
   await client.query('INSERT INTO document_request_items(id,practice_id,location_id,patient_id,request_id,requirement_id,document_type_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[items[i],p,l,patient,request,requirements[i],types[i]]);
   await client.query("INSERT INTO work_items(practice_id,location_id,patient_id,appointment_id,requirement_id,kind) VALUES($1,$2,$3,$4,$5,'collect')",[p,l,patient,appointment,requirements[i]]);
   await client.query("INSERT INTO file_objects(id,practice_id,location_id,patient_id,request_id,storage_key,original_filename,declared_media_type,expected_bytes,status,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,'synthetic.pdf','application/pdf',1,$7,now()+interval '1 hour')",[files[i],p,l,patient,request,randomUUID(),i===0?'available':'quarantined']);
   await client.query("INSERT INTO documents(id,practice_id,location_id,patient_id,request_id,document_type_id,title) VALUES($1,$2,$3,$4,$5,$6,'Synthetic upload')",[docs[i],p,l,patient,request,types[i]]);
   await client.query("INSERT INTO document_versions(id,practice_id,location_id,patient_id,request_id,document_id,version_number,source,file_object_id,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,1,'patient_upload',$7,$8)",[versions[i],p,l,patient,request,docs[i],files[i],session]);
  }
  // A staff transport row with a non-UUID target must remain invisible without breaking a public retry lookup.
  await client.query("INSERT INTO workflow_request_keys(practice_id,location_id,actor_user_id,request_key,request_hash,operation,target_id) VALUES($1,$2,'synthetic_staff',$3,$4,'patients.create','')",[p,l,randomUUID(),hash('staff-command')]);
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  await client.query("SELECT set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session','true',true)",[tokenHash]);
  assert.equal((await client.query('SELECT id FROM workflow_request_keys')).rowCount,0);
  await client.query("INSERT INTO workflow_request_keys(practice_id,location_id,actor_user_id,request_key,request_hash,operation,target_id,response) VALUES($1,$2,$3,$4,$5,'patient_upload.completion',$6,$7)",[p,l,session,commandKey,hash('patient-command'),request,JSON.stringify({id:items[0]})]);
  assert.equal((await client.query('SELECT id FROM workflow_request_keys')).rowCount,1);
  await rejected(client,"INSERT INTO upload_sessions(practice_id,location_id,patient_id,request_id,document_id,document_version_id,base_version_id,file_object_id,declared_size_bytes,declared_media_type,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'application/pdf',now()+interval '1 hour')",[p,l,patient,request,docs[0],versions[0],versions[1],files[0]],'23503');
  await rejected(client,'SELECT careiq_patient_fulfill_item($1,$2)',[items[0],versions[1]],'23514');
  await rejected(client,'SELECT careiq_patient_fulfill_item($1,$2)',[items[1],versions[1]],'23514');
  const first=(await client.query('SELECT careiq_patient_fulfill_item($1,$2) AS result',[items[0],versions[0]])).rows[0].result;assert.equal(first.state,'fulfilled');
  await client.query('RESET ROLE');
  assert.equal((await client.query("SELECT id FROM work_items WHERE requirement_id=$1 AND kind='review' AND state='open'",[requirements[0]])).rowCount,1);
  assert.equal((await client.query("SELECT id FROM work_items WHERE requirement_id=$1 AND kind='collect' AND state='completed'",[requirements[0]])).rowCount,1);
  assert.equal((await client.query('SELECT id FROM requirement_evidence WHERE requirement_id=$1',[requirements[0]])).rowCount,0);
  await client.query("UPDATE file_objects SET status='available' WHERE id=$1",[files[1]]);await client.query('SET LOCAL ROLE careiq_clinical_runtime');
  await client.query('SELECT careiq_patient_fulfill_item($1,$2)',[items[1],versions[1]]);
  await client.query("SELECT careiq_patient_close_request('completed')");
  const replay=(await client.query('SELECT careiq_patient_command_receipt($1,$2) AS receipt',[tokenHash,commandKey])).rows[0].receipt;
  assert.equal(replay.requestHash,hash('patient-command'));assert.equal(replay.sessionId,session);assert.equal(replay.response.id,items[0]);
  assert.equal((await client.query('SELECT careiq_patient_command_receipt($1,$2) AS receipt',[tokenHash,randomUUID()])).rows[0].receipt,null);
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT document_version_id FROM requirement_evidence WHERE requirement_id=$1 AND revoked_at IS NULL',[requirements[1]])).rows[0].document_version_id,versions[1]);
  assert.equal((await client.query("SELECT state FROM document_requests WHERE id=$1",[request])).rows[0].state,'completed');
 } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
