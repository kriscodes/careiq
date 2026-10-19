import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type Request } from 'express';
import { registerStaffNotificationRoutes, type StaffNotificationDependencies } from '../src/routes/staff-notifications.js';
import { WorkflowError } from '../src/workflow/policy.js';

test('staff notification routes keep recipient identity in authenticated scope and gate reads, receipt changes and manager policy',async()=>{
  const locationId=randomUUID(),practiceId=randomUUID(),notificationId=randomUUID(),observed:any[]=[];
  const auth=(req:Request)=>({isAuthenticated:req.get('X-Actor')!=='anonymous',userId:req.get('X-Actor')??'reader',orgId:'org_synthetic',sessionId:'session_synthetic'});
  const access={authorizeLocation:async(principal:ReturnType<typeof auth>,location:string)=>{if(!principal.isAuthenticated)throw new WorkflowError('UNAUTHENTICATED',401);if(location!==locationId)throw new WorkflowError('LOCATION_ACCESS_DENIED',403);return {tenant:{practiceId,locationId,userId:principal.userId,orgId:'org_synthetic',membershipId:'membership_synthetic'},permissions:principal.userId==='manager'?['org:appointments:read','org:workflow:configure']:principal.userId==='reader'?['org:appointments:read']:[],capabilities:{}};}};
  const deps:StaffNotificationDependencies={
    staffNotifications:async(t,a,q)=>{observed.push({t,a,q});if(q.filter==='explode')throw new Error('Synthetic protected provider result');return {items:[],unreadCount:0,attentionCount:0,asOf:new Date().toISOString(),snapshotToken:randomUUID(),pagination:{hasMore:false,nextCursor:null}};},
    staffNotification:async(t,a,id)=>{observed.push({t,a,id});return {id};},
    updateStaffNotification:async(t,a,id,action,input,c)=>{observed.push({t,a,id,action,input,c});return {id,revision:2};},
    readAllStaffNotifications:async(t,a,input,c)=>{observed.push({t,a,input,c});return {updatedCount:2,unreadCount:1};},
    staffNotificationPreferences:async()=>({revision:1}),saveStaffNotificationPreferences:async()=>({revision:2}),
    staffNotificationPolicy:async(t,_r,includeRecipients)=>{observed.push({t,includeRecipients});return {revision:1,eligibleRecipients:[]};},saveStaffNotificationPolicy:async()=>({revision:2}),recordStaffNotificationFailure:async()=>{},
  } as any;
  const app=express();app.use(express.json());registerStaffNotificationRoutes(app,access as any,auth,deps);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1/locations/${locationId}/workflow`;
  const request=(path:string,actor='reader',method='GET',payload?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method,headers:{'X-Actor':actor,'Content-Type':'application/json',...headers},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  try{
    let r=await request('/notifications');assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(observed.at(-1).t.userId,'reader');
    r=await request('/notifications','anonymous');assert.equal(r.status,401);
    r=await request('/notifications','no-permission');assert.equal(r.status,403);
    r=await request('/notifications?recipientUserId=manager');assert.equal(r.status,400);
    r=await request(`/notifications/${notificationId}/read`,'reader','POST',{read:true},{'Idempotency-Key':randomUUID()});assert.equal(r.status,428);
    r=await request(`/notifications/${notificationId}/read`,'reader','POST',{read:true},{'Idempotency-Key':randomUUID(),'If-Match':'"1"'});assert.equal(r.status,200);assert.equal(observed.at(-1).c.expectedRevision,1);assert.equal(observed.at(-1).t.userId,'reader');
    r=await request('/notifications/read-all','reader','POST',{snapshotToken:randomUUID()},{'Idempotency-Key':randomUUID()});assert.equal(r.status,200);assert.equal(observed.at(-1).c.expectedRevision,undefined);
    r=await request('/notification-policy');assert.equal(r.status,403);
    r=await request('/notification-policy','manager');assert.equal(r.status,200);assert.equal(observed.at(-1).includeRecipients,true);
    r=await request('/notifications?filter=explode');assert.equal(r.status,500);assert.equal((await r.text()).includes('Synthetic protected'),false);
    const wrong=await fetch(base.replace(locationId,randomUUID())+'/notifications',{headers:{'X-Actor':'reader'}});assert.equal(wrong.status,403);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
