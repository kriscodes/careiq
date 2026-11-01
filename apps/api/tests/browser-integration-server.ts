/** Optional synthetic loopback fixture; never imported by the production app. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Pool} from 'pg';
import express from 'express';
import {PDFDocument} from 'pdf-lib';
import {isolatedTestDatabaseUrl} from './local-test-database.js';
import type {TenantContext,RequestAuthentication} from '../src/middleware/tenant-context.js';
import type {PracticeAccess} from '../src/routes/practice-access.js';
if(process.env.CAREIQ_REAL_API_E2E!=='true'||!process.send)throw new Error('EXPLICIT_ISOLATED_BROWSER_TEST_REQUIRED');
const database=isolatedTestDatabaseUrl();if(!database)throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
const assets=process.env.CAREIQ_E2E_ASSET_DIR;
if(!assets||!resolve(assets).startsWith(resolve(tmpdir())+'/careiq-real-browser-'))throw new Error('PRIVATE_FIXTURE_ASSETS_REQUIRED');
const role='careiq_browser_'+randomUUID().replaceAll('-',''),password=randomUUID().replaceAll('-','');
const practiceIds=[randomUUID(),randomUUID()],requestIds=new Set<string>();
const subject='user_Browser'+randomUUID().replaceAll('-',''),sessionId='sess_Browser'+randomUUID().replaceAll('-',''),bearer=randomUUID();
const admin=new Pool({connectionString:database,ssl:false,max:2});
const storage=await mkdtemp(join(tmpdir(),'careiq-real-pdf-'));
let runtime:Pool|undefined,server:Server|undefined,closing=false,roleCreated=false,runtimeEnded=false;
type Flow={requestId:string;token:string;title:string;templateVersionId:string;patientId:string};
const flows={} as Record<'unsigned'|'signed',Flow>;
const staffBearer=randomUUID(),staffSession='sess_Staff'+randomUUID().replaceAll('-','');
let staff:{tenant:TenantContext;appointmentId:string;patientId:string;date:string}|undefined;
const send=(message:unknown)=>{if(process.connected)process.send!(message);};
const fixtureRequestId=()=>{const id=randomUUID();requestIds.add(id);return id;};
async function cleanup(){
 if(closing)return;closing=true;
 let failure:unknown;
 try{
 if(server)await new Promise<void>((ok,bad)=>{server!.close(error=>error?bad(error):ok());server!.closeIdleConnections();});
 if(runtime){await runtime.end();runtimeEnded=true;}
 // LOCAL to this guarded cleanup connection. Every row belongs to two generated
 // practice UUIDs or captured fixture request IDs; no shared trigger DDL/reset.
 const client=await admin.connect();
 try{
  await client.query('BEGIN');await client.query('SET LOCAL session_replication_role=replica');
  const events=(await client.query('SELECT id FROM audit.events WHERE practice_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[]) OR actor_id=$3',[practiceIds,[...requestIds],subject])).rows.map(row=>row.id);
  for(const table of ['event_resources','changes'])await client.query(`DELETE FROM audit.${table} WHERE event_id=ANY($1::uuid[])`,[events]);
  await client.query('DELETE FROM audit.database_records WHERE practice_id=ANY($1::uuid[]) OR authenticated_login=$2 OR application_event_id=ANY($3::uuid[])',[practiceIds,role,events]);
  await client.query('DELETE FROM audit.retention_assignments WHERE event_id=ANY($1::uuid[])',[events]);
  await client.query('DELETE FROM audit.events WHERE id=ANY($1::uuid[])',[events]);
  const tables=(await client.query("SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema='public' AND c.column_name='practice_id' AND t.table_type='BASE TABLE' ORDER BY c.table_name")).rows;
  for(const {table_name:table} of tables){assert.match(table,/^[a-z_]+$/);await client.query(`DELETE FROM public."${table}" WHERE practice_id=ANY($1::uuid[])`,[practiceIds]);assert.equal((await client.query(`SELECT count(*) FROM public."${table}" WHERE practice_id=ANY($1::uuid[])`,[practiceIds])).rows[0].count,'0');}
  await client.query('DELETE FROM practices WHERE id=ANY($1::uuid[])',[practiceIds]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 assert.equal((await admin.query('SELECT count(*) FROM practices WHERE id=ANY($1::uuid[])',[practiceIds])).rows[0].count,'0');
 }catch(error){failure=error;}finally{
  try{if(runtime&&!runtimeEnded){await runtime.end();runtimeEnded=true;}}catch(error){failure??=error;}
  try{if(roleCreated){await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE ${role}`);}assert.equal((await admin.query('SELECT count(*) FROM pg_roles WHERE rolname=$1',[role])).rows[0].count,'0');}catch(error){failure??=error;}
  await admin.end();await rm(storage,{recursive:true,force:true});
 }
 if(failure)throw failure;
 return{ownedPracticesRemoved:true,ownedRoleRemoved:true,privateStorageRemoved:true};
}
async function start(){
 await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);roleCreated=true;await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
 const runtimeUrl=new URL(database!);runtimeUrl.username=role;runtimeUrl.password=password;
 process.env.DATABASE_URL=runtimeUrl.href;process.env.DATABASE_SSL_MODE='disable';process.env.CAREIQ_PRIVATE_STORAGE_DIR=storage;process.env.CAREIQ_AUDIT_DATABASE_URL='';process.env.CAREIQ_SCANNER_COMMAND='';process.env.NODE_ENV='test';
 const service=await import('../src/services/workflow.service.js'),paperwork=await import('../src/services/patient-paperwork.service.js');({pool:runtime}=await import('../src/db/client.js'));
 await (await import('../src/db/release-check.js')).verifyDatabaseRelease(runtime);
 const identity=(await runtime.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(identity.current_user,role);assert.equal(identity.rolsuper,false);assert.equal(identity.rolbypassrls,false);
 assert.equal((await runtime.query("SELECT count(*) FROM pg_class c JOIN pg_roles r ON c.relowner=r.oid WHERE r.rolname=current_user AND c.relkind IN('r','p')")).rows[0].count,'0');assert.equal((await runtime.query('SELECT count(*) FROM patients')).rows[0].count,'0');
 let foreignLibraryId='';
 for(let index=0;index<2;index++){
  const t={practiceId:practiceIds[index]!,locationId:randomUUID(),userId:'user_Staff'+randomUUID().replaceAll('-',''),membershipId:'membership_'+randomUUID(),orgId:'org_'+randomUUID()};
  await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic browser fixture','location','active')",[t.practiceId,t.orgId]);
  await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic browser fixture','UTC')",[t.locationId,t.practiceId]);
  await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[t.practiceId,t.userId,t.membershipId]);
  await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)',[t.practiceId,t.userId,t.locationId]);
  const run=(action:string,target:string,input:unknown,expectedRevision?:number)=>service.execute(t,action,target,input,{requestId:fixtureRequestId(),idempotencyKey:randomUUID(),expectedRevision});
  const patientId=String((await run('patients.create','',{firstName:'Synthetic',lastName:'Browser',dateOfBirth:'1980-01-01'})).id);
  if(index===0){
   const scheduledAt=new Date(Date.now()+3600000),endsAt=new Date(scheduledAt.getTime()+1800000),appointmentId=randomUUID();
   await admin.query('INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[appointmentId,t.practiceId,t.locationId,patientId,scheduledAt.toISOString(),endsAt.toISOString()]);
   staff={tenant:t,appointmentId,patientId,date:scheduledAt.toISOString().slice(0,10)};
  }
  const documentTypeId=String((await run('document-types.create','',{code:'browser_form',name:'Synthetic browser form'})).id);
  if(index===0)await run('paperwork.portal.bind',patientId,{clerkUserId:subject,relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic fixture attestation',paperworkEmailEnabled:false});
  for(const signed of index===0?[false,true]:[false]){
   const title=signed?'Synthetic signed browser consent':'Synthetic unsigned browser intake';
   const template=await run('templates.create','',{documentTypeId,title,schemaVersion:2,content:'Synthetic published text for browser integration. Review the exact PDF before signing.',fieldSchema:[{key:'full_name',label:'Your full name',type:'text',required:true},{key:'include_note',label:'Add a note',type:'checkbox',required:false},{key:'note',label:'Private note',type:'textarea',required:true},...(signed?[{key:'treatment_signature',label:'Treatment signature',type:'typed_signature',required:true,signerRole:'patient'},{key:'privacy_signature',label:'Privacy signature',type:'typed_signature',required:true,signerRole:'patient'}]:[])],formSchema:{mode:'guided',defaultLocale:'en',completionPolicy:signed?'form_then_sign':'form_only',sections:[],rules:[{id:'note_rule',targetFieldKey:'note',sourceFieldKey:'include_note',operator:'checked'}],bindings:[{fieldKey:'full_name',destination:'patient.preferredName',reviewRequired:true}],signing:signed?{roles:[{key:'patient',label:'Patient',required:true}],consentText:'I agree to use an electronic signature for this synthetic integration test.',consentTextVersion:'browser-consent-v1'}:{roles:[]},delivery:{emailCopy:false}}});
   await run('templates.publication',String(template.id),{expectedDraftRevision:1},1);
   const version=String((await admin.query('SELECT published_version_id FROM document_templates WHERE id=$1',[template.id])).rows[0].published_version_id);
   const request=await run('paperwork.requests.create','',{patientId,templateVersionId:version,recipient:{name:'Synthetic browser patient',channel:'local_review'}});
   const flow={requestId:String(request.id),token:String(request.localReviewPath).split('=')[1]!,title,templateVersionId:version,patientId};await run('templates.update',String(template.id),{title:'Renamed logical template'},2);
   if(index===0)flows[signed?'signed':'unsigned']=flow;
   else{const session=await service.exchangePatientSession({token:flow.token},fixtureRequestId());await paperwork.patientFormAnswers(session.sessionToken,{answers:{full_name:'Synthetic foreign scope',include_note:false}},randomUUID(),1,fixtureRequestId());const complete=await paperwork.patientFormFreeze(session.sessionToken,{},randomUUID(),2,fixtureRequestId());foreignLibraryId=String(complete.libraryItemId);}
  }
 }
 const {createApiApp}=await import('../src/app.js');
 const patients=await import('../src/services/patient.service.js'),appointments=await import('../src/services/appointment.service.js'),practices=await import('../src/services/practice.service.js');
 const insurance=await import('../src/services/insurance.service.js');const {WorkflowError}=await import('../src/workflow/policy.js');
 assert.ok(staff);
 const staffPermissions=['org:patients:read','org:appointments:read','org:documents:read','org:documents:review','org:work:manage','org:activity:read'];
 const getAuth=(req:import('express').Request):RequestAuthentication=>req.get('Authorization')===`Bearer ${staffBearer}`?{isAuthenticated:true,userId:staff!.tenant.userId,orgId:staff!.tenant.orgId,orgRole:'org:custom',sessionId:staffSession,has:({permission})=>staffPermissions.includes(permission)}:req.get('Authorization')===`Bearer ${bearer}`?{isAuthenticated:true,userId:subject,sessionId}:{isAuthenticated:false};
 const practiceAccess={authorizeLocation:async(auth:RequestAuthentication,locationId:string)=>{
  if(!auth.isAuthenticated||auth.userId!==staff!.tenant.userId||auth.orgId!==staff!.tenant.orgId||locationId!==staff!.tenant.locationId)throw new WorkflowError('FORBIDDEN',403);
  return{tenant:staff!.tenant,capabilities:{patients:{read:true,create:false},appointments:{read:true,create:false}},permissions:staffPermissions};
 }} as unknown as PracticeAccess;

 // Only the identity-provider seam is synthetic. All API/service responses,
 // permission checks, PDF bytes, audit facts and library reads remain real.
 let app:ReturnType<typeof createApiApp>|undefined;
 server=createServer((req,res)=>{res.once('finish',()=>{const value=res.getHeader('X-Request-Id');if(typeof value==='string')requestIds.add(value);});if(!app){res.statusCode=503;res.end();return;}app(req,res);});await new Promise<void>(ok=>server!.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 app=createApiApp({authenticate:(_req,_res,next)=>next(),getAuth,practiceAccess,workflow:service,insurance,health:()=>runtime!.query('SELECT 1'),findPracticeByClerkOrgId:practices.findPracticeByClerkOrgId,listPatients:patients.listPatients,listAppointments:appointments.listAppointments,createPatient:patients.createPatient,createAppointment:appointments.createAppointment},{origins:[origin],trustedProxies:false,interviews:{enabled:false,store:async()=>{throw new Error('PUBLIC_INTERVIEW_DISABLED');},log:()=>{}}});
 app.use('/brand',express.static(resolve(import.meta.dirname,'../../web/public/brand'),{index:false,dotfiles:'deny',fallthrough:false,maxAge:0}));
 const js=await readFile(join(assets!,'app.js')),css=await readFile(join(assets!,'styles.css'));
 app.get('/app.js',(_req,res)=>res.type('js').set('Cache-Control','no-store').send(js));app.get('/styles.css',(_req,res)=>res.type('css').set('Cache-Control','no-store').send(css));
 app.get(['/','/patient-paperwork','/staff'],(_req,res)=>res.type('html').set('Cache-Control','no-store').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><p style="font:12px system-ui">Isolated synthetic identity · Real loopback API and restricted test database</p><div id="root"></div><script src="/app.js"></script></body></html>'));
 send({type:'ready',origin,subject,bearer,flows,foreignLibraryId,staff:{subject:staff.tenant.userId,bearer:staffBearer,orgId:staff.tenant.orgId,locationId:staff.tenant.locationId,practiceName:'Synthetic browser practice',appointmentId:staff.appointmentId,patientId:staff.patientId,date:staff.date}});
}
async function verify(flowName:'unsigned'|'signed',expectedName:string){
 const f=flows[flowName];assert.ok(f);const signed=flowName==='signed';
 const submissions=(await admin.query('SELECT * FROM form_submissions WHERE request_id=$1',[f.requestId])).rows;assert.equal(submissions.length,1);const submission=submissions[0];assert.deepEqual(submission.answers,{full_name:expectedName,include_note:false});
 const source=(await admin.query('SELECT v.*,o.storage_key,o.sha256 FROM document_versions v JOIN file_objects o ON o.id=v.file_object_id WHERE v.id=$1',[submission.document_version_id])).rows[0];assert.deepEqual(source.structured_answers,submission.answers);
 const libraries=(await admin.query('SELECT * FROM paperwork_library_items WHERE request_id=$1',[f.requestId])).rows;assert.equal(libraries.length,1);const library=libraries[0];assert.equal(library.signed,signed);assert.equal(library.release_state,'released');
 const output=(await admin.query('SELECT v.*,o.storage_key,o.sha256 FROM document_versions v JOIN file_objects o ON o.id=v.file_object_id WHERE v.id=$1',[library.document_version_id])).rows[0];
 const {readPrivate,sha256}=await import('../src/workflow/storage.js');const bytes=await readPrivate(output.storage_key),sourceBytes=await readPrivate(source.storage_key);
 assert.equal(sha256(bytes),output.sha256);assert.equal(output.sha256,output.content_hash);assert.equal(library.content_hash,output.sha256);assert.equal(sha256(sourceBytes),source.content_hash);
 assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getTitle(),f.title);assert.ok(pdf.getPageCount()>0);
 assert.equal((await admin.query('SELECT state FROM document_requests WHERE id=$1',[f.requestId])).rows[0].state,'completed');assert.equal((await admin.query('SELECT preferred_name FROM patients WHERE id=$1',[f.patientId])).rows[0].preferred_name,null);
 const candidates=(await admin.query('SELECT state FROM form_change_candidates WHERE request_id=$1',[f.requestId])).rows;assert.equal(candidates.length,1);assert.equal(candidates[0].state,'pending');assert.equal((await admin.query('SELECT count(*) FROM paperwork_notifications WHERE request_id=$1',[f.requestId])).rows[0].count,'0');
 const rejected=async(sql:string,id:string)=>assert.rejects(admin.query(sql,[id]),error=>(error as {code?:string}).code==='23514');
 await rejected("UPDATE template_versions SET content='tampered' WHERE id=$1",f.templateVersionId);await rejected("UPDATE form_submissions SET answers='{}' WHERE id=$1",submission.id);await rejected("UPDATE document_versions SET structured_answers='{}' WHERE id=$1",source.id);
 if(signed){
  assert.notEqual(source.id,output.id);assert.equal(output.source_version_id,source.id);assert.ok(pdf.getPageCount()>(await PDFDocument.load(sourceBytes)).getPageCount());
  const packet=(await admin.query('SELECT * FROM signature_packets WHERE request_id=$1',[f.requestId])).rows[0];assert.equal(packet.state,'completed');const fields=(await admin.query('SELECT entered_value,signed_at FROM signature_fields WHERE packet_id=$1',[packet.id])).rows;assert.equal(fields.length,2);fields.forEach(field=>{assert.equal(field.entered_value,expectedName);assert.ok(field.signed_at);});
  const event=(await admin.query("SELECT * FROM signature_events WHERE packet_id=$1 AND event_type='completed'",[packet.id])).rows[0];const decision=event.evidence_metadata.authorityDecision;assert.equal(decision.policyVersion,'careiq-adult-self-location-calendar-v1');assert.equal(decision.decision,'eligible');assert.equal(decision.independentIdentityVerification,false);assert.equal(decision.sourceSha256,source.content_hash);assert.ok(decision.auditEventId);assert.match(decision.decisionHash,/^[a-f0-9]{64}$/);await rejected("UPDATE signature_events SET evidence_metadata='{}' WHERE id=$1",event.id);
 }
 const sessions=(await admin.query('SELECT verification_method,assurance FROM patient_sessions WHERE request_id=$1',[f.requestId])).rows;assert.equal(sessions.length,1);assert.equal(sessions[0].verification_method,'patient_request_link');assert.equal(sessions[0].assurance,'link_possession');
 return{immutableFactsVerified:true,exactPdfHashVerified:true,libraryCopies:1,pendingChartReviews:1,signatureFields:signed?2:0,notificationIntents:0,independentIdentityVerified:false,sourceSha256:source.sha256,outputSha256:output.sha256,libraryId:String(library.id),frozenTitle:f.title};
}
async function verifyInsurance(caseId:string){
 assert.ok(staff);assert.match(caseId,/^[0-9a-f-]{36}$/i);const t=staff.tenant;
 const record=(await admin.query('SELECT * FROM insurance_cases WHERE id=$1 AND practice_id=$2 AND location_id=$3',[caseId,t.practiceId,t.locationId])).rows[0];assert.ok(record);assert.equal(record.patient_id,staff.patientId);assert.equal(record.appointment_id,staff.appointmentId);assert.equal(record.assignee_user_id,t.userId);assert.equal(Number(record.revision),4);
 const evidence=(await admin.query('SELECT * FROM insurance_evidence WHERE case_id=$1 ORDER BY created_at,id',[caseId])).rows;assert.equal(evidence.length,2);
 const original=evidence[0],correction=evidence[1];assert.equal(original.reference,'Synthetic browser source A');assert.equal(original.copay_cents,0);assert.equal(original.deductible_remaining_cents,null);assert.equal(original.coinsurance_percent,null);assert.equal(original.supersedes_evidence_id,null);
 assert.equal(correction.reference,'Synthetic browser source B');assert.equal(correction.copay_cents,2500);assert.equal(correction.deductible_remaining_cents,null);assert.equal(correction.coinsurance_percent,null);assert.equal(correction.supersedes_evidence_id,original.id);assert.equal(correction.reason_code,'correction');assert.equal(record.current_evidence_id,correction.id);
 const actions=['insurance.case.created','insurance.evidence.recorded','insurance.evidence.corrected','insurance.follow_up.revised'];
 const events=(await admin.query('SELECT * FROM audit.events WHERE practice_id=$1 AND location_id=$2 AND entity_id=$3 AND action=ANY($4::text[]) ORDER BY recorded_at,id',[t.practiceId,t.locationId,caseId,actions])).rows;assert.equal(events.length,4);assert.deepEqual(new Set(events.map(event=>event.action)),new Set(actions));events.forEach(event=>{assert.equal(event.actor_id,t.userId);assert.equal(event.outcome,'succeeded');assert.match(event.request_id,/^[0-9a-f-]{36}$/i);});
 const eventIds=events.map(event=>event.id);const relationships=(await admin.query('SELECT event_id,resource_type,resource_id,patient_id FROM audit.event_resources WHERE event_id=ANY($1::uuid[])',[eventIds])).rows;
 for(const event of events)for(const [type,id] of [['insurance_case',caseId],['patient',staff.patientId],['appointment',staff.appointmentId]])assert.ok(relationships.some(relation=>relation.event_id===event.id&&relation.resource_type===type&&relation.resource_id===id&&relation.patient_id===staff!.patientId));
 const rowEvidence=(await admin.query("SELECT * FROM audit.database_records WHERE application_event_id=ANY($1::uuid[]) AND table_name IN ('insurance_cases','insurance_evidence')",[eventIds])).rows;for(const event of events)assert.ok(rowEvidence.some(row=>row.application_event_id===event.id));
 for(const observed of evidence){const fact=rowEvidence.find(row=>row.table_name==='insurance_evidence'&&row.row_key.id===observed.id);assert.ok(fact);assert.equal(fact.application_event_id,observed.audit_event_id);assert.equal(fact.authenticated_login,role);}
 const protectedMetadata=JSON.stringify([events.map(event=>({metadata:event.metadata,authorization:event.authorization_context})),rowEvidence.map(row=>({before:row.before_evidence,after:row.after_evidence}))]);for(const value of ['SYNTHETIC-BROWSER-MEMBER',original.reference,correction.reference])assert.equal(protectedMetadata.includes(value),false);
 await assert.rejects(admin.query("UPDATE insurance_evidence SET reference='tampered' WHERE id=$1",[original.id]),error=>(error as {code?:string}).code==='23514');assert.equal((await admin.query('SELECT reference FROM insurance_evidence WHERE id=$1',[original.id])).rows[0].reference,original.reference);
 assert.ok((await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND location_id=$2 AND action='manager.dashboard.read' AND actor_id=$3",[t.practiceId,t.locationId,t.userId])).rowCount);
 return{insuranceFactsVerified:true,immutableEvidenceVerified:true,zeroAndUnknownPreserved:true,evidenceCount:2,auditBusinessEvents:4,databaseEvidenceLinked:true,staffActorVerified:true};
}
let queue=Promise.resolve();
process.on('message',(message:{type?:string;id?:number;flow?:'unsigned'|'signed';expectedName?:string;caseId?:string})=>{queue=queue.then(async()=>{try{if(message.type==='verify'){assert.equal(typeof message.expectedName,'string');send({type:'result',id:message.id,result:await verify(message.flow!,message.expectedName!)});}else if(message.type==='verifyInsurance'){assert.equal(typeof message.caseId,'string');send({type:'result',id:message.id,result:await verifyInsurance(message.caseId!)});}else if(message.type==='shutdown'){send({type:'closed',cleanup:await cleanup()});process.disconnect?.();}}catch(error){send({type:'failure',id:message.id,code:error instanceof assert.AssertionError?'FIXTURE_ASSERTION_FAILED':'FIXTURE_OPERATION_FAILED'});}});});
process.once('disconnect',()=>{void cleanup().catch(()=>{process.exitCode=1;});});process.once('SIGTERM',()=>{void cleanup().finally(()=>process.exit());});
try{await start();}catch(error){const code=(error as {code?:string}).code;send({type:'failure',code:'FIXTURE_SETUP_FAILED'+(code&&/^[A-Z0-9_]{1,64}$/.test(code)?'_'+code:'')});try{await cleanup();}catch{send({type:'failure',code:'FIXTURE_CLEANUP_FAILED'});}process.exitCode=1;process.disconnect?.();}
