import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedTestDatabaseUrl} from './local-test-database.js';
const url=isolatedTestDatabaseUrl();
test('a one-time patient link cannot create two sessions during concurrent HTTP exchanges',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url,ssl:false}),role='careiq_grant_race_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');
 const practiceId=randomUUID(),locationId=randomUUID(),userId='user_GrantRaceStaff',membershipId='membership_'+randomUUID(),tenant={practiceId,locationId,userId,membershipId,orgId:'org_'+practiceId};
 const storage=await mkdtemp(join(tmpdir(),'careiq-grant-race-')),old={url:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_MODE,storage:process.env.CAREIQ_PRIVATE_STORAGE_DIR};let runtime:Pool|undefined;let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 try{
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
  await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic race practice','location','active')",[practiceId,tenant.orgId]);await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic race location','UTC')",[locationId,practiceId]);await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[practiceId,userId,membershipId]);await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)',[practiceId,userId,locationId]);
  const runtimeUrl=new URL(url!);runtimeUrl.username=role;runtimeUrl.password=password;process.env.DATABASE_URL=runtimeUrl.href;process.env.DATABASE_SSL_MODE='disable';process.env.CAREIQ_PRIVATE_STORAGE_DIR=storage;
  const service=await import('../src/services/workflow.service.js');({pool:runtime}=await import('../src/db/client.js'));const run=(action:string,target:string,input:unknown,revision?:number)=>service.execute(tenant,action,target,input,{requestId:randomUUID(),idempotencyKey:randomUUID(),expectedRevision:revision});
  const patient=(await run('patients.create','',{firstName:'Synthetic',lastName:'Race',dateOfBirth:'1980-01-01'})).id;
  const type=(await run('document-types.create','',{code:'race',name:'Synthetic form'})).id,template=(await run('templates.create','',{documentTypeId:type,title:'Synthetic race form',schemaVersion:2,content:'Synthetic form only.',fieldSchema:[{key:'name',label:'Name',type:'text'}],formSchema:{completionPolicy:'form_only'}})).id;await run('templates.publication',String(template),{expectedDraftRevision:1},1);
  const version=(await admin.query('SELECT published_version_id FROM document_templates WHERE id=$1',[template])).rows[0].published_version_id,request=await run('paperwork.requests.create','',{patientId:patient,templateVersionId:version,recipient:{name:'Synthetic',channel:'local_review'}}),token=String(request.localReviewPath).split('=')[1];
  const {registerPatientWorkflowRoutes}=await import('../src/routes/workflow.js');const app=express();registerPatientWorkflowRoutes(app,service,['https://careiq-test.invalid']);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const endpoint=`http://127.0.0.1:${address.port}/api/v1/patient-workflows/session-exchanges`;
  const blocker=await admin.connect();try{
   await blocker.query('BEGIN');await blocker.query('SELECT id FROM patient_access_grants WHERE request_id=$1 FOR UPDATE',[request.id]);
   const exchange=()=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://careiq-test.invalid'},body:JSON.stringify({token})});
   const first=exchange(),second=exchange();let reached=false;
   for(let attempt=0;attempt<100;attempt++){const waiting=(await admin.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE usename=$1 AND query LIKE 'INSERT INTO patient_sessions%' AND wait_event_type='Lock'",[role])).rows[0].count;if(waiting>0){reached=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(reached,true,'The exchange reached the held grant before release.');await new Promise(resolve=>setTimeout(resolve,40));await blocker.query('COMMIT');
   const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,410]);
   assert.equal((await admin.query('SELECT count(*)::integer AS count FROM patient_sessions WHERE request_id=$1',[request.id])).rows[0].count,1);
   const replay=await exchange();assert.equal(replay.status,410);
  }finally{await blocker.query('ROLLBACK');blocker.release();}
 }finally{if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}await runtime?.end();await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();await rm(storage,{recursive:true,force:true});for(const[key,value]of Object.entries(old)){const name=key==='url'?'DATABASE_URL':key==='ssl'?'DATABASE_SSL_MODE':'CAREIQ_PRIVATE_STORAGE_DIR';if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
