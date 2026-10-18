import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {registerPatientPaperworkPortalRoutes} from '../src/routes/patient-paperwork.js';

test('patient paperwork routes use verified account identity, no-store exact copies and scoped failure audits',async()=>{
    const app=express(),calls:unknown[][]=[],failures:unknown[]=[];let authenticated=true;
    const itemId=randomUUID(),versionId=randomUUID(),bytes=Buffer.from('%PDF-synthetic-exact-copy');
    registerPatientPaperworkPortalRoutes(app,()=>({isAuthenticated:authenticated,userId:authenticated?'user_Patient123':null,sessionId:authenticated?'sess_Patient123':null}),async(...args)=>{
        calls.push(args);
        if(args[2]) {
            if(args[2]!==itemId)throw Object.assign(new Error('Denied'),{code:'42501'});
            return{bytes,contentType:'application/pdf',filename:'Synthetic paperwork.pdf'};
        }
        return{items:[{id:itemId,documentVersionId:versionId,title:'Synthetic paperwork',signed:true,versionNumber:2,releaseState:'released'}],hasMore:true,nextCursor:'opaque-signed-cursor'};
    },async(event)=>{failures.push(event);return randomUUID();});
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
    const base=`http://127.0.0.1:${address.port}/api/v1/patient-paperwork`;
    try {
        let response=await fetch(base+'?cursor=previous-cursor');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
        let payload=await response.json() as any;assert.equal(payload.data.items[0].documentVersionId,versionId);assert.equal(payload.data.nextCursor,'opaque-signed-cursor');assert.deepEqual(calls[0],['user_Patient123','sess_Patient123',undefined,'previous-cursor']);
        response=await fetch(base+'/'+itemId+'/content');assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.match(response.headers.get('Content-Disposition')??'',/^inline; filename\*=UTF-8''/);
        authenticated=false;const before=calls.length;response=await fetch(base);assert.equal(response.status,401);assert.equal(calls.length,before);assert.equal((failures.at(-1) as any).outcome,'denied');
        authenticated=true;response=await fetch(base+'/'+randomUUID()+'/content');assert.equal(response.status,404);payload=await response.json();assert.equal(payload.error.code,'PAPERWORK_COPY_NOT_FOUND');assert.equal((failures.at(-1) as any).outcome,'denied');
        response=await fetch(base+'?cursor=a&cursor=b');assert.equal(response.status,400);assert.equal((failures.at(-1) as any).reasonCode,'INVALID_PAPERWORK_CURSOR');
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
