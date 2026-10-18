import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Request} from 'express';
import {isolatedTestDatabaseUrl} from './local-test-database.js';
import {WorkflowError} from '../src/workflow/policy.js';
const url=isolatedTestDatabaseUrl(),origin='https://careiq-security-test.invalid';
type Actor={userId:string;sessionId:string;practiceId?:string;orgId?:string;membershipId?:string;locations?:string[];permissions:string[]};
type Scope={practiceId:string;locationId:string;userId:string;orgId:string;membershipId:string;patientId:string;templateId:string;templateVersionId:string;requirementId:string;privateValue:string;documentVersionId:string;libraryItemId:string;candidateId:string;portalSubject:string;actorKey:string;clientIp:string};
test('adversarial HTTP and restricted database reads isolate twelve practices and twenty-four locations',{skip:!url},async context=>{
 const admin=new Pool({connectionString:url,ssl:false}),role='careiq_security_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex'),storage=await mkdtemp(join(tmpdir(),'careiq-security-'));
 const old={url:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_MODE,storage:process.env.CAREIQ_PRIVATE_STORAGE_DIR};let runtime:Pool|undefined;let server:import('node:http').Server|undefined;
 const actors=new Map<string,Actor>(),scopes:Scope[]=[];let httpRequests=0;
 try{
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
  const runtimeUrl=new URL(url!);runtimeUrl.username=role;runtimeUrl.password=password;process.env.DATABASE_URL=runtimeUrl.href;process.env.DATABASE_SSL_MODE='disable';process.env.CAREIQ_PRIVATE_STORAGE_DIR=storage;
  const service=await import('../src/services/workflow.service.js'),paperwork=await import('../src/services/patient-paperwork.service.js'),{formChanges}=await import('../src/services/form-changes.service.js'),{createApiApp}=await import('../src/app.js');({pool:runtime}=await import('../src/db/client.js'));
  const all=['org:patients:read','org:patients:create','org:patients:update','org:appointments:read','org:appointments:create','org:appointments:update','org:documents:read','org:documents:upload','org:documents:review','org:documents:archive','org:workflow:configure','org:requests:send','org:paperwork:manage'];
  const auth=(req:Request)=>{const actor=actors.get(req.get('X-Security-Actor')??'');return actor?{isAuthenticated:true,userId:actor.userId,sessionId:actor.sessionId,orgId:actor.orgId??null,has:({permission}:{permission:string})=>actor.permissions.includes(permission),sessionClaims:{fva:[0,-1]}}:{isAuthenticated:false,userId:null,sessionId:null};};
  const access={authorizeLocation:async(principal:ReturnType<typeof auth>,locationId:string)=>{if(!principal.isAuthenticated||!principal.userId)throw new WorkflowError('UNAUTHENTICATED',401);const actor=[...actors.values()].find(value=>value.sessionId===principal.sessionId);if(!actor?.practiceId||!actor.locations?.includes(locationId))throw new WorkflowError('LOCATION_ACCESS_DENIED',403);return{tenant:{practiceId:actor.practiceId,locationId,userId:actor.userId,orgId:actor.orgId!,membershipId:actor.membershipId!},capabilities:{},permissions:actor.permissions};}};
  const app=createApiApp({authenticate:(_req,_res,next)=>next(),getAuth:auth,health:async()=>true,findPracticeByClerkOrgId:async()=>null,practiceAccess:access as any,workflow:service,listPatients:async()=>[],listAppointments:async()=>[],createPatient:async()=>({}),createAppointment:async()=>({})},{origins:[origin],trustedProxies:['loopback'],interviews:{enabled:false,store:async()=>{}}});
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
  const request=(method:string,path:string,actor:string,body?:unknown,headers:Record<string,string>={})=>{httpRequests++;return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,'X-Security-Actor':actor,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});};
  const run=(t:any,action:string,target:string,input:unknown,revision?:number)=>service.execute(t,action,target,input,{requestId:randomUUID(),idempotencyKey:randomUUID(),expectedRevision:revision});
  for(let practice=0;practice<12;practice++){
   const practiceId=randomUUID(),orgId='org_'+practiceId,userId='user_SecurityStaff'+practice+'X'+randomBytes(3).toString('hex'),membershipId='membership_'+randomUUID(),locations=[randomUUID(),randomUUID()],actorKey='staff-'+practice;
   await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,$3,'location','active')",[practiceId,orgId,'Synthetic security practice '+practice]);await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic location A','UTC'),($2,$3,'Synthetic location B','UTC')",[...locations,practiceId]);await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[practiceId,userId,membershipId]);await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2),($1,$2,$4,true,$2)',[practiceId,userId,...locations]);
   actors.set(actorKey,{practiceId,orgId,userId,membershipId,locations,sessionId:'sess_SecurityStaff'+practice,permissions:all});actors.set('reader-'+practice,{practiceId,orgId,userId,membershipId,locations,sessionId:'sess_SecurityReader'+practice,permissions:['org:patients:read','org:documents:read']});
   const t={practiceId,locationId:locations[0],userId,membershipId,orgId},type=(await run(t,'document-types.create','',{code:'security',name:'Synthetic security paperwork'})).id;
   const template=await run(t,'templates.create','',{documentTypeId:type,title:'Synthetic practice '+practice+' intake',schemaVersion:2,content:'Synthetic form used only for isolation testing.',fieldSchema:[{key:'preferred',label:'Preferred name',type:'text',required:true}],formSchema:{completionPolicy:'form_only',bindings:[{fieldKey:'preferred',destination:'patient.preferredName',reviewRequired:true}]}});await run(t,'templates.publication',template.id,{expectedDraftRevision:1},1);const templateVersionId=(await admin.query('SELECT published_version_id FROM document_templates WHERE id=$1',[template.id])).rows[0].published_version_id;
   for(let location=0;location<2;location++){
    const index=scopes.length,locationId=locations[location],tenant={...t,locationId},patient=await run(tenant,'patients.create','',{firstName:'Synthetic',lastName:'SecurityPatient'+index,dateOfBirth:'1980-01-01'}),appointmentId=randomUUID(),requirementId=randomUUID(),privateValue='CONFIDENTIAL_PRACTICE_'+practice+'_LOCATION_'+location;
    await admin.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at,ends_at,status) VALUES($1,$2,$3,$4,'2027-01-04T10:00Z','2027-01-04T10:30Z','scheduled')",[appointmentId,practiceId,locationId,patient.id]);await admin.query("INSERT INTO visit_requirements(id,practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot) VALUES($1,$2,$3,$4,$5,$6,'Synthetic intake')",[requirementId,practiceId,locationId,patient.id,appointmentId,type]);
    const issued=await run(tenant,'paperwork.requests.create','',{patientId:patient.id,templateVersionId,requirementId,recipient:{name:'Synthetic Security Patient',channel:'local_review'}}),exchange=await service.exchangePatientSession({token:String(issued.localReviewPath).split('=')[1]},randomUUID());await paperwork.patientFormAnswers(exchange.sessionToken,{answers:{preferred:privateValue}},randomUUID(),1,randomUUID());const frozen=await paperwork.patientFormFreeze(exchange.sessionToken,{},randomUUID(),2,randomUUID());
    const portalSubject='user_SecurityPatient'+index+'X'+randomBytes(3).toString('hex');await run(tenant,'paperwork.portal.bind',patient.id,{clerkUserId:portalSubject,relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic in-person verification'});actors.set('patient-'+index,{userId:portalSubject,sessionId:'sess_SecurityPatient'+index,permissions:[]});
    const candidates=await formChanges(tenant,patient.id,randomUUID());scopes.push({...tenant,patientId:patient.id,templateId:template.id,templateVersionId,requirementId,privateValue,documentVersionId:String(frozen.documentVersionId),libraryItemId:String(frozen.libraryItemId),candidateId:candidates.items[0].id,portalSubject,actorKey,clientIp:'192.0.2.'+(index+1)});
   }
  }
  await context.test('every staff context can read its exact files but cross-location and cross-practice IDs disclose no records or bytes',async()=>{
   for(let index=0;index<scopes.length;index++){
    const own=scopes[index],foreign=scopes[(index+1)%scopes.length],prefix=`/api/v1/locations/${own.locationId}/workflow`;
    let response=await request('GET',prefix+'/documents/'+(await admin.query('SELECT document_id FROM document_versions WHERE id=$1',[own.documentVersionId])).rows[0].document_id,own.actorKey);assert.equal(response.status,200);
    response=await request('GET',prefix+'/document-versions/'+own.documentVersionId+'/content',own.actorKey);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(response.headers.get('Content-Type')??'',/application\/pdf/);
    for(const path of ['/patients/'+foreign.patientId,'/document-versions/'+foreign.documentVersionId+'/content','/paperwork/patients/'+foreign.patientId,'/patients/'+foreign.patientId+'/form-changes','/paperwork/patients/'+foreign.patientId+'/portal-grants']){
     const denied=await request('GET',prefix+path,own.actorKey);assert.equal(denied.status,404,path);const payload=await denied.text();assert.equal(payload.includes(foreign.privateValue),false);assert.equal(payload.includes('storageKey'),false);assert.equal(payload.includes('tokenHash'),false);assert.equal(denied.headers.get('Cache-Control'),'no-store');
    }
    const mutation=await request('POST',prefix+'/form-changes/'+foreign.candidateId+'/decisions',own.actorKey,{decision:'accepted',reasonCode:'forged_scope',expectedPatientRevision:1},{'Idempotency-Key':randomUUID(),'If-Match':'"1"'});assert.equal(mutation.status,404);
    const wrongLocation=await request('GET',`/api/v1/locations/${scopes[(index+2)%scopes.length].locationId}/workflow/patients/${own.patientId}`,own.actorKey);assert.equal(wrongLocation.status,403);
   }
  });
  await context.test('every location rejects foreign authoring, publication, requests, bindings, revocation and library mutations',async()=>{
   for(let index=0;index<scopes.length;index++){
    const own=scopes[index],foreign=scopes[(index+1)%scopes.length],otherPractice=scopes[(index+2)%scopes.length],prefix=`/api/v1/locations/${own.locationId}/workflow`,grant=(await admin.query('SELECT id FROM patient_portal_grants WHERE patient_id=$1',[foreign.patientId])).rows[0].id;
    const attempts=[
     ['POST','/paperwork/requests',{patientId:foreign.patientId,templateVersionId:own.templateVersionId,recipient:{name:'Synthetic',channel:'local_review'}}],
     ['POST','/paperwork/patients/'+foreign.patientId+'/portal-grants',{clerkUserId:'user_ForgedPatient',relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic rejected scope'}],
     ['POST','/paperwork/portal-grants/'+grant+'/revocation',{reasonCode:'forged_scope'}],
     ['PATCH','/paperwork/library-items/'+foreign.libraryItemId+'/release',{releaseState:'restricted',reasonCode:'forged_scope'}],
     ['POST','/template-versions/'+otherPractice.templateVersionId+'/preview',{}],
     ['POST','/template-versions/'+otherPractice.templateVersionId+'/validation',{}],
     ['PATCH','/template-versions/'+otherPractice.templateVersionId,{content:'forged content'}],
     ['POST','/templates/'+otherPractice.templateId+'/publication',{expectedDraftRevision:1}],
    ]as const;
    for(const[method,path,body]of attempts){const denied=await request(method,prefix+path,own.actorKey,body,{'Idempotency-Key':randomUUID(),'If-Match':'"1"'});assert.equal(denied.status,404,path);assert.equal((await denied.text()).includes(foreign.privateValue),false);}
   }
  });
  await context.test('authenticated library accounts cannot select another account or fetch another patient copy',async()=>{
   for(let index=0;index<scopes.length;index++){
    const own=scopes[index],foreign=scopes[(index+1)%scopes.length],actor='patient-'+index;
    const listed=await request('GET','/api/v1/patient-paperwork?userId='+foreign.portalSubject+'&patientId='+foreign.patientId,actor);assert.equal(listed.status,200);const payload=await listed.json()as any;assert.deepEqual(payload.data.items.map((item:any)=>item.id),[own.libraryItemId]);assert.equal(JSON.stringify(payload).includes('storageKey'),false);
    const denied=await request('GET','/api/v1/patient-paperwork/'+foreign.libraryItemId+'/content',actor);assert.equal(denied.status,404);assert.equal((await denied.json()as any).error.code,'PAPERWORK_COPY_NOT_FOUND');
    const ownCopy=await request('GET','/api/v1/patient-paperwork/'+own.libraryItemId+'/content',actor);assert.equal(ownCopy.status,200);assert.equal(ownCopy.headers.get('Referrer-Policy'),'no-referrer');
   }
   assert.equal((await request('GET','/api/v1/patient-paperwork','unknown')).status,401);
  });
  await context.test('read permissions cannot mutate or manage bindings and forged scope properties never reach a command',async()=>{
   const own=scopes[0],prefix=`/api/v1/locations/${own.locationId}/workflow`,headers={'Idempotency-Key':randomUUID(),'If-Match':'"1"'};
   for(const[method,path,body]of [['PATCH','/template-versions/'+own.templateVersionId,{content:'forged'}],['POST','/template-versions/'+own.templateVersionId+'/preview',{}],['POST','/paperwork/patients/'+own.patientId+'/portal-grants',{}],['POST','/form-changes/'+own.candidateId+'/decisions',{decision:'accepted',reasonCode:'forged',expectedPatientRevision:1}]]as const){const response=await request(method,prefix+path,'reader-0',body,headers);assert.equal(response.status,403,path);}
   const forged=await request('PATCH',prefix+'/patients/'+own.patientId,own.actorKey,{practiceId:scopes[2].practiceId,locationId:scopes[2].locationId,patientId:scopes[2].patientId},headers);assert.equal(forged.status,400);assert.equal((await forged.json()as any).error.code,'UNKNOWN_FIELD');
   assert.equal((await request('GET',prefix+'/patients/'+own.patientId,'unknown')).status,401);
  });
  let openRequestId='',openToken='',openItemId='',openSourceVersion='';
  await context.test('a form-only request token cannot allocate legacy uploads, mutate foreign forms or claim signing completion',async()=>{
   const own=scopes[0],tenant={practiceId:own.practiceId,locationId:own.locationId,userId:own.userId,orgId:own.orgId,membershipId:own.membershipId},issued=await run(tenant,'paperwork.requests.create','',{patientId:own.patientId,templateVersionId:own.templateVersionId,recipient:{name:'Synthetic',channel:'local_review'}});openRequestId=issued.id;
   // Bind a fresh active requirement because an earlier request already fulfilled the fixture requirement.
   const appointmentId=randomUUID(),requirementId=randomUUID(),type=(await admin.query('SELECT document_type_id FROM document_templates WHERE id=$1',[own.templateId])).rows[0].document_type_id;await admin.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at,ends_at,status) VALUES($1,$2,$3,$4,'2027-01-05T10:00Z','2027-01-05T10:30Z','scheduled')",[appointmentId,own.practiceId,own.locationId,own.patientId]);await admin.query("INSERT INTO visit_requirements(id,practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot) VALUES($1,$2,$3,$4,$5,$6,'Synthetic adversarial intake')",[requirementId,own.practiceId,own.locationId,own.patientId,appointmentId,type]);
   const bound=await run(tenant,'paperwork.requests.create','',{patientId:own.patientId,templateVersionId:own.templateVersionId,requirementId,recipient:{name:'Synthetic',channel:'local_review'}});openRequestId=bound.id;const exchange=await service.exchangePatientSession({token:String(bound.localReviewPath).split('=')[1]},randomUUID());openToken=exchange.sessionToken;openItemId=(await admin.query('SELECT id FROM document_request_items WHERE request_id=$1',[bound.id])).rows[0].id;
   const cookie='careiq_patient_session='+exchange.sessionToken,headers={Cookie:cookie,'X-Forwarded-For':own.clientIp,'Idempotency-Key':randomUUID()},before=Number((await admin.query('SELECT count(*) FROM upload_sessions WHERE request_id=$1',[bound.id])).rows[0].count);
   for(const[method,path,body]of [['POST','/uploads',{requirementId,file:{name:'payload.pdf',contentType:'application/pdf',sizeBytes:8,sha256:'a'.repeat(64)}}],['POST','/uploads/'+randomUUID()+'/completion',{}],['POST','/completion',{expectedRevision:1,sourceSha256:'a'.repeat(64),consent:{accepted:true,textVersion:'forged'},fields:[{key:'patient_signature',type:'typed_signature',value:'forged'}]}]]as const){const response=await request(method,'/api/v1/patient-workflows'+path,'none',body,{...headers,'Idempotency-Key':randomUUID()});assert.equal(response.status,409,path);}
   httpRequests++;const binary=await fetch(base+'/api/v1/patient-workflows/uploads/'+randomUUID()+'/content',{method:'PUT',headers:{Origin:origin,Cookie:cookie,'X-Forwarded-For':own.clientIp,'Content-Type':'application/pdf'},body:Buffer.from('%PDF-test')});assert.equal(binary.status,409);
   const forged=await request('PUT','/api/v1/patient-workflows/form/answers','none',{answers:{preferred:'own'},patientId:scopes[2].patientId},{...headers,'If-Match':'"1"'});assert.equal(forged.status,400);const hostileOrigin=await request('PUT','/api/v1/patient-workflows/form/answers','none',{answers:{preferred:'own'}},{...headers,Origin:'https://attacker.invalid','If-Match':'"1"'});assert.equal(hostileOrigin.status,403);
   assert.equal(Number((await admin.query('SELECT count(*) FROM upload_sessions WHERE request_id=$1',[bound.id])).rows[0].count),before);assert.equal((await admin.query('SELECT source_version_id FROM document_request_items WHERE id=$1',[openItemId])).rows[0].source_version_id,null);
   await paperwork.patientFormAnswers(openToken,{answers:{preferred:'Synthetic own confirmed'}},randomUUID(),1,randomUUID());const frozen=await paperwork.patientFormFreeze(openToken,{},randomUUID(),2,randomUUID());openSourceVersion=String(frozen.documentVersionId);
   const purposeSession=await service.exchangePatientSession({token:String(issued.localReviewPath).split('=')[1]},randomUUID());openToken=purposeSession.sessionToken;openItemId=(await admin.query('SELECT id FROM document_request_items WHERE request_id=$1',[issued.id])).rows[0].id;
  });
  await context.test('forced database scope and composite relations deny cross-tenant reads and forged clinical inserts under a non-owner role',async()=>{
   const client=await runtime!.connect();try{for(let index=0;index<scopes.length;index++){
    const own=scopes[index],foreign=scopes[(index+1)%scopes.length];await client.query('BEGIN');await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true),set_config('app.patient_token_hash','',true),set_config('app.patient_is_session','false',true)",[own.practiceId,own.locationId,own.userId]);
    for(const[table,id]of [['patients',foreign.patientId],['document_versions',foreign.documentVersionId],['paperwork_library_items',foreign.libraryItemId],['form_change_candidates',foreign.candidateId]]as const)assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,0,table);
    await client.query('SAVEPOINT invalid_relation');await assert.rejects(client.query("INSERT INTO prepared_documents(practice_id,location_id,patient_id,template_version_id,created_by_actor_id) VALUES($1,$2,$3,$4,$5)",[own.practiceId,own.locationId,foreign.patientId,own.templateVersionId,own.userId]),(error:any)=>['23503','23514'].includes(error.code));await client.query('ROLLBACK TO SAVEPOINT invalid_relation');
    await client.query('SAVEPOINT raw_audit');await assert.rejects(client.query('SELECT * FROM audit.events'),(error:any)=>error.code==='42501');await client.query('ROLLBACK TO SAVEPOINT raw_audit');await client.query('COMMIT');
   }}finally{await client.query('ROLLBACK');client.release();}
  });
  await context.test('the restricted fulfillment helper itself rejects a form-completion token before selecting a supplied version',async()=>{
   const client=await runtime!.connect();try{await client.query('BEGIN');const {sha256}=await import('../src/workflow/storage.js');await client.query("SELECT set_config('app.practice_id','',true),set_config('app.location_id','',true),set_config('app.actor_user_id','',true),set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session','true',true)",[sha256(Buffer.from(openToken))]);await assert.rejects(client.query('SELECT careiq_patient_fulfill_item($1,$2)',[openItemId,randomUUID()]),(error:any)=>error.code==='23514'&&error.message==='PATIENT_REQUEST_PURPOSE_UNSUPPORTED');}finally{await client.query('ROLLBACK');client.release();}
  });
  await context.test('membership revocation invalidates later HTTP reads even when the earlier authentication context still exists',async()=>{
   const own=scopes[0];await admin.query("UPDATE practice_member_access SET status='revoked' WHERE practice_id=$1 AND user_id=$2",[own.practiceId,own.userId]);const denied=await request('GET',`/api/v1/locations/${own.locationId}/workflow/document-versions/${own.documentVersionId}/content`,own.actorKey);assert.equal(denied.status,403);await admin.query("UPDATE practice_member_access SET status='active' WHERE practice_id=$1 AND user_id=$2",[own.practiceId,own.userId]);
   const secrets=[openToken,scopes[0].privateValue];const audit=(await admin.query('SELECT metadata FROM audit.events WHERE practice_id=$1',[own.practiceId])).rows;for(const secret of secrets)assert.equal(JSON.stringify(audit).includes(secret),false);
  });
  assert.equal(httpRequests,494);context.diagnostic('494 actual HTTP requests evaluated across 12 practices and 24 location contexts.');
 }finally{if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}await runtime?.end();await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();await rm(storage,{recursive:true,force:true});for(const[key,value]of Object.entries(old)){const name=key==='url'?'DATABASE_URL':key==='ssl'?'DATABASE_SSL_MODE':'CAREIQ_PRIVATE_STORAGE_DIR';if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
