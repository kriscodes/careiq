import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerWorkflowRoutes, workflowCapabilities, type WorkflowDependencies } from '../src/routes/workflow.js';
import type { PracticeAccess } from '../src/routes/practice-access.js';
import type { RequestAuthentication } from '../src/middleware/tenant-context.js';

const locationId=randomUUID(),patientId=randomUUID();
test('portal administration API denies document-only/admin/stale access before reading or mutating account bindings',async context=>{
    // Negative-route audit fallback must never contact any configured review database.
    const old={url:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_MODE};process.env.DATABASE_URL='postgresql://synthetic:synthetic@127.0.0.1:1/careiq_test';process.env.DATABASE_SSL_MODE='disable';
    let permitted=false,ages:unknown=[0,-1],reads=0,commands=0;
    const auth=()=>({isAuthenticated:true,userId:'user_Staff123',sessionId:'sess_Staff123',orgId:'org_Synthetic',orgRole:'org:admin',has:()=>permitted,sessionClaims:{fva:ages}} as RequestAuthentication);
    const tenant={practiceId:randomUUID(),locationId,userId:'user_Staff123',membershipId:'membership_Synthetic',orgId:'org_Synthetic'};
    const permissions=['org:documents:read','org:workflow:configure'];
    const access={authorizeLocation:async()=>({tenant,capabilities:{},permissions})} as unknown as PracticeAccess;
    const deps={execute:async()=>{commands++;return{id:randomUUID(),state:'active'};}} as unknown as WorkflowDependencies;
    const app=express();app.use(express.json());registerWorkflowRoutes(app,deps,access,auth,async(t,id)=>{reads++;assert.equal(t.locationId,locationId);assert.equal(id,patientId);return{items:[],adultSelfEligible:true,pagination:{limit:50,hasMore:false,nextCursor:null}};});
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(accept=>server.once('listening',accept));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/locations/${locationId}/workflow/paperwork/patients/${patientId}/portal-grants`;
    try{
        await context.test('ordinary document/configuration permissions and an admin role do not reveal account details',async()=>{
            assert.equal(workflowCapabilities(auth(),{},permissions).paperworkManage,false);
            const response=await fetch(url);assert.equal(response.status,403);assert.equal((await response.json()).error.code,'FORBIDDEN');assert.equal(reads,0);
            const mutation=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({clerkUserId:'user_Patient123'})});assert.equal(mutation.status,403);assert.equal(commands,0);
        });
        await context.test('even the dedicated permission requires document/configuration permissions and a recent verified factor',async()=>{
            permitted=true;assert.equal(workflowCapabilities(auth(),{},['org:documents:read']).paperworkManage,false);assert.equal(workflowCapabilities(auth(),{},['org:workflow:configure']).paperworkManage,false);
            ages=[6,-1];const response=await fetch(url);assert.equal(response.status,403);assert.equal((await response.json()).error.code,'RECENT_AUTHENTICATION_REQUIRED');assert.equal(reads,0);
            const mutation=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:'{}'});assert.equal(mutation.status,403);assert.equal(commands,0);
        });
        await context.test('a fresh verified principal with all permissions can read the exact patient scope',async()=>{
            ages=[0,-1];assert.equal(workflowCapabilities(auth(),{},permissions).paperworkManage,true);
            const response=await fetch(url);assert.equal(response.status,200);assert.deepEqual((await response.json()).data.items,[]);assert.equal(reads,1);
        });
    }finally{await new Promise<void>(accept=>server.close(()=>accept()));const {pool}=await import('../src/db/client.js');await pool.end();for(const [key,value]of Object.entries({DATABASE_URL:old.url,DATABASE_SSL_MODE:old.ssl})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
