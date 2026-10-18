import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { loadWorkflowReadModel } from '../src/workflow/read-model.js';
import { WorkflowError } from '../src/workflow/policy.js';
const url=isolatedTestDatabaseUrl();

test('workflow pages cross 500 rows without losing microsecond boundaries, and details load complete exact evidence', {skip:!url},async context=>{
 const pool=new Pool({connectionString:url,ssl:false,max:1}),client=await pool.connect();
 const practiceId=randomUUID(),locationId=randomUUID(),userId='synthetic_reader',membershipId='synthetic_reader_member';
 const tenant={practiceId,locationId,userId,membershipId,orgId:'org_'+practiceId};const caps={patientsRead:true,appointmentsRead:true,documentsRead:true,configurationManage:true};
 try{
  await client.query('BEGIN');
  await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode) VALUES($1,$2,'Synthetic read model','location')",[practiceId,tenant.orgId]);
  await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic location','UTC')",[locationId,practiceId]);
  await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[practiceId,userId,membershipId]);
  await client.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)',[practiceId,userId,locationId]);
  const patients=(await client.query("INSERT INTO patients(practice_id,location_id,first_name,last_name,email,created_at) SELECT $1,$2,'Synthetic','Patient '||n,'patient'||n||'@example.invalid','2026-01-01T00:00:00Z'::timestamptz+(n||' microseconds')::interval FROM generate_series(1,620) n RETURNING id,created_at",[practiceId,locationId])).rows;
  const patientId=patients[0].id;
  const appointments=(await client.query("INSERT INTO appointments(practice_id,location_id,patient_id,scheduled_at,ends_at,status,created_at) SELECT $1,$2,$3,'2027-01-01T08:00:00Z'::timestamptz+(n||' hours')::interval,'2027-01-01T08:30:00Z'::timestamptz+(n||' hours')::interval,CASE WHEN n=2 THEN 'checked_in' ELSE 'scheduled' END,'2026-01-01T00:00:00Z'::timestamptz+(n||' microseconds')::interval FROM generate_series(1,620) n RETURNING id,scheduled_at",[practiceId,locationId,patientId])).rows;
  const type=(await client.query("INSERT INTO document_types(practice_id,code,name) VALUES($1,'synthetic','Synthetic form') RETURNING id",[practiceId])).rows[0].id;
  const documents=(await client.query("INSERT INTO documents(practice_id,location_id,patient_id,document_type_id,title,created_at) SELECT $1,$2,$3,$4,'Synthetic document '||n,'2026-01-01T00:00:00Z'::timestamptz+(n||' microseconds')::interval FROM generate_series(1,620) n RETURNING id",[practiceId,locationId,patientId,type])).rows;
  const documentId=documents[0].id;
  const file=(await client.query("INSERT INTO file_objects(practice_id,location_id,patient_id,storage_key,storage_version,original_filename,declared_media_type,detected_media_type,expected_bytes,actual_bytes,sha256,status,upload_expires_at) VALUES($1,$2,$3,$4,'synthetic','synthetic.pdf','application/pdf','application/pdf',1,1,$5,'available',now()+interval '1 hour') RETURNING id",[practiceId,locationId,patientId,randomUUID(),'a'.repeat(64)])).rows[0].id;
  const versions=(await client.query("INSERT INTO document_versions(id,practice_id,location_id,patient_id,document_id,version_number,source,file_object_id,created_by_actor_id,created_at) SELECT CASE WHEN n=30 THEN '00000000-0000-4000-8000-000000000001'::uuid ELSE uuidv7() END,$1,$2,$3,$4,n,'staff_upload',$5,$6,'2026-02-01T00:00:00Z'::timestamptz+(n||' microseconds')::interval FROM generate_series(1,30) n RETURNING id,version_number",[practiceId,locationId,patientId,documentId,file,userId])).rows;
  const oldest=versions.find(v=>v.version_number===1).id,newest=versions.find(v=>v.version_number===30).id;
  await client.query('UPDATE documents SET current_version_id=$2 WHERE id=$1',[documentId,newest]);
  const missing=(await client.query("INSERT INTO visit_requirements(practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot,review_required) VALUES($1,$2,$3,$4,$5,'Synthetic missing',false) RETURNING id",[practiceId,locationId,patientId,appointments[0].id,type])).rows[0].id;
  const satisfied=(await client.query("INSERT INTO visit_requirements(practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot,review_required) VALUES($1,$2,$3,$4,$5,'Synthetic satisfied',false) RETURNING id",[practiceId,locationId,patientId,appointments[1].id,type])).rows[0].id;
  await client.query('INSERT INTO requirement_evidence(practice_id,location_id,patient_id,requirement_id,document_version_id,linked_by_actor_id) VALUES($1,$2,$3,$4,$5,$6)',[practiceId,locationId,patientId,satisfied,oldest,userId]);
  const request=(await client.query("INSERT INTO document_requests(practice_id,location_id,patient_id,appointment_id,purpose,recipient_name,state,expires_at,created_by_actor_id) VALUES($1,$2,$3,$4,'collection','Synthetic','open',now()+interval '1 day',$5) RETURNING id",[practiceId,locationId,patientId,appointments[0].id,userId])).rows[0].id;
  await client.query('INSERT INTO document_request_items(practice_id,location_id,patient_id,request_id,requirement_id,document_type_id) VALUES($1,$2,$3,$4,$5,$6)',[practiceId,locationId,patientId,request,missing,type]);
  await client.query("INSERT INTO work_items(practice_id,location_id,patient_id,appointment_id,requirement_id,kind) VALUES($1,$2,$3,$4,$5,'collect')",[practiceId,locationId,patientId,appointments[0].id,missing]);
  await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)",[practiceId,locationId,userId]);
  await client.query('SET LOCAL ROLE careiq_clinical_runtime');

  await context.test('opaque keyset cursors retrieve all 620 distinct patients and bind actor, scope and filters',async()=>{
   const first=await loadWorkflowReadModel(client,tenant,caps,{collection:'patients',limit:100});assert.equal(first.primaryIds.patients.length,100);assert.equal(first.pagination.patients.total,620);assert.equal(first.pagination.patients.hasMore,true);assert.ok(first.pagination.patients.nextCursor);assert.equal(first.patients.some(p=>'__careiq_created_at' in p),false);
   const seen=new Set(first.primaryIds.patients);let cursor=first.pagination.patients.nextCursor;
   while(cursor){const next=await loadWorkflowReadModel(client,tenant,caps,{collection:'patients',limit:100,cursor});for(const patient of next.primaryIds.patients){assert.equal(seen.has(patient),false);seen.add(patient);}cursor=next.pagination.patients.nextCursor;}
   assert.equal(seen.size,620);
   await assert.rejects(loadWorkflowReadModel(client,{...tenant,userId:'other_actor'},caps,{collection:'patients',limit:100,cursor:first.pagination.patients.nextCursor!}),e=>e instanceof WorkflowError&&e.code==='INVALID_CURSOR');
   await assert.rejects(loadWorkflowReadModel(client,tenant,caps,{collection:'patients',limit:100,cursor:first.pagination.patients.nextCursor!,search:'different'}),e=>e instanceof WorkflowError&&e.code==='INVALID_CURSOR');
   await assert.rejects(loadWorkflowReadModel(client,tenant,caps,{collection:'patients',limit:100,cursor:first.pagination.patients.nextCursor!+'tampered'}),e=>e instanceof WorkflowError&&e.code==='INVALID_CURSOR');
   const searched=await loadWorkflowReadModel(client,tenant,caps,{collection:'patients',search:'patient620@example.invalid'});assert.equal(searched.pagination.patients.total,1);assert.equal(searched.patients[0].email,'patient620@example.invalid');
  });
  await context.test('first-page summaries count the complete filtered location rather than selected rows',async()=>{
   const graph=await loadWorkflowReadModel(client,tenant,caps);assert.equal(graph.primaryIds.appointments.length,50);assert.equal(graph.pagination.appointments.total,620);assert.equal(graph.pagination.documents.total,620);assert.equal(graph.summary.activeAppointments,620);assert.equal(graph.summary.checkedIn,1);assert.equal(graph.summary.appointmentsNeedingDocuments,1);assert.equal(graph.summary.openWorkItems,1);
   assert.ok(graph.patients.length<300);assert.ok(graph.documents.length<100);assert.ok(graph.appointments.length<100);
   const profile=await loadWorkflowReadModel(client,tenant,caps,{patientId});assert.equal(profile.primaryIds.patients.length,1);assert.equal(profile.pagination.documents.total,620);assert.equal(profile.pagination.appointments.total,620);
  });
  await context.test('old detail records and evidence versions stay available outside every primary/history first page',async()=>{
   const graph=await loadWorkflowReadModel(client,tenant,caps,{collection:'appointments',appointmentId:appointments[1].id});assert.deepEqual(graph.primaryIds.appointments,[appointments[1].id]);assert.equal(graph.requirements.length,1);assert.equal(graph.evidence[0].document_version_id,oldest);assert.ok(graph.versions.some(v=>v.id===oldest));assert.ok(graph.versions.some(v=>v.id===newest));assert.equal(graph.versions[0].id,newest);assert.equal(graph.objects.length,1);assert.equal(graph.summary.appointmentsNeedingDocuments,0);
   const doc=await loadWorkflowReadModel(client,tenant,caps,{collection:'documents',documentId});assert.equal(doc.relatedPagination.documentVersions[documentId].total,30);assert.equal(doc.relatedPagination.documentVersions[documentId].hasMore,true);
   const history=await loadWorkflowReadModel(client,tenant,caps,{collection:'documentVersions',documentId,limit:20,cursor:doc.relatedPagination.documentVersions[documentId].nextCursor!});assert.equal(history.primaryIds.documentVersions.length,10);assert.ok(history.primaryIds.documentVersions.includes(oldest));
   const limited=await loadWorkflowReadModel(client,tenant,{appointmentsRead:true},{collection:'appointments',appointmentId:appointments[0].id});assert.equal(limited.patients.length,0);assert.equal(limited.primaryIds.documents.length,0);assert.equal(limited.requestItems[0].request_id,request);assert.equal(limited.requests[0].state,'open');
  });
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
