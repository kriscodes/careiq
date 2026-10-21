import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import type { DeliveryProvider } from '../src/notifications/delivery-provider.js';
const url=isolatedTestDatabaseUrl();

test('staff inbox binds current authorization, exact read-all membership and finite assignment/overdue fanout under restricted runtime',{skip:!url},async context=>{
  const admin=new Pool({connectionString:url,ssl:false}),role='careiq_staff_test_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
  const practiceId=randomUUID(),locationId=randomUUID(),patientId=randomUUID(),orgId='org_'+practiceId,owner='staff_'+randomUUID(),recipient='staff_'+randomUUID(),other='staff_'+randomUUID();
  const members=new Map([owner,recipient,other].map(userId=>[userId,{id:'membership_'+userId,userId,role:'org:member',permissions:['org:appointments:read','org:workflow:configure']}]));
  const worker={practiceId,locationId,userId:owner,membershipId:members.get(owner)!.id,orgId},tenant={...worker,userId:recipient,membershipId:members.get(recipient)!.id},otherTenant={...worker,userId:other,membershipId:members.get(other)!.id};
  const access={permissions:['org:appointments:read','org:workflow:configure']},ctx=(expectedRevision?:number)=>({requestId:randomUUID(),idempotencyKey:randomUUID(),expectedRevision});
  const old={url:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_MODE,staffUrl:process.env.CAREIQ_STAFF_APP_URL};let runtime:Pool|undefined;
  try{
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
    await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic staff practice','location','active')",[practiceId,orgId]);
    await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic notification location','America/Los_Angeles')",[locationId,practiceId]);
    for(const [userId,m]of members){await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[practiceId,userId,m.id]);await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)',[practiceId,userId,locationId]);}
    await admin.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic','Staff test')",[patientId,practiceId,locationId]);
    const runtimeUrl=new URL(url!);runtimeUrl.username=role;runtimeUrl.password=password;process.env.DATABASE_URL=runtimeUrl.href;process.env.DATABASE_SSL_MODE='disable';process.env.CAREIQ_STAFF_APP_URL='https://careiq.example';
    const service=await import('../src/services/staff-notifications.service.js');({pool:runtime}=await import('../src/db/client.js'));
    const {scoped}=await import('../src/workflow/transaction.js');
    const createWork=async(assignee=recipient,dueAt:Date|null=null)=>scoped(worker,async c=>(await c.query("INSERT INTO work_items(practice_id,location_id,patient_id,kind,assignee_user_id,due_at) VALUES($1,$2,$3,'delivery_follow_up',$4,$5) RETURNING *",[practiceId,locationId,patientId,assignee,dueAt])).rows[0]);
    const membership=async(_org:string,user:string)=>members.get(user)??null;
    const disabled:DeliveryProvider={enabled:false,ready:()=>false,account:()=>'',provider:()=>'',send:async()=>{throw new Error('unexpected external send');},reconcile:async()=>{throw new Error('unexpected external lookup');}};
    const options={membership,provider:disabled};
    let original:any;
    await context.test('opening inbox materializes assignments with email disabled, deduplicates and isolates recipients',async()=>{
      original=await createWork();const inbox=await service.staffNotifications(tenant,access,{},randomUUID());assert.equal(inbox.items.length,1);assert.equal(inbox.unreadCount,1);assert.equal(inbox.items[0]!.workItem.id,original.id);
      assert.equal((await service.staffNotifications(tenant,access,{},randomUUID())).items.length,1);
      assert.equal((await service.staffNotifications(otherTenant,access,{},randomUUID())).unreadCount,0);
      await assert.rejects(service.staffNotification(otherTenant,access,inbox.items[0]!.id,randomUUID()),(e:any)=>e.code==='RESOURCE_NOT_FOUND');
      await assert.rejects(service.staffNotifications(tenant,{permissions:[]},{},randomUUID()),(e:any)=>e.code==='FORBIDDEN');
    });
    await context.test('read-all affects exact snapshot IDs even when an older-timestamp alert commits later and replay is stable',async()=>{
      const before=await service.staffNotifications(tenant,access,{},randomUUID());const late=await createWork();
      await admin.query("UPDATE staff_notification_events SET occurred_at=now()-interval '1 day' WHERE work_item_id=$1",[late.id]);
      const readContext=ctx();const result=await service.readAllStaffNotifications(tenant,access,{snapshotToken:before.snapshotToken},readContext);assert.equal(result.updatedCount,1);
      const after=await service.staffNotifications(tenant,access,{},randomUUID());assert.equal(after.unreadCount,1);assert.equal(after.items.find((i:any)=>i.workItem.id===late.id)!.readAt,null);
      assert.deepEqual(await service.readAllStaffNotifications(tenant,access,{snapshotToken:before.snapshotToken},readContext),result);
      await assert.rejects(service.readAllStaffNotifications(otherTenant,access,{snapshotToken:before.snapshotToken},ctx()),(e:any)=>e.code==='NOTIFICATION_SNAPSHOT_EXPIRED');
      await assert.rejects(service.readAllStaffNotifications(tenant,{permissions:['org:appointments:read']},{snapshotToken:before.snapshotToken},ctx()),(e:any)=>e.code==='NOTIFICATION_SNAPSHOT_EXPIRED');
      assert.equal((await admin.query('SELECT state FROM work_items WHERE id=$1',[original.id])).rows[0].state,'open');
    });
    await context.test('ownership generation advances once, no-op does not alert and self-assignment is quiet',async()=>{
      await scoped(worker,async c=>{await c.query('UPDATE work_items SET assignee_user_id=$2,revision=revision+1 WHERE id=$1',[original.id,other]);});
      const changed=(await admin.query('SELECT * FROM work_items WHERE id=$1',[original.id])).rows[0];assert.equal(Number(changed.notification_owner_generation),2);assert.equal(Number(changed.notification_due_generation),1);
      await service.runStaffNotificationSweep(worker,options);
      const readRequestId=randomUUID(),previous=await service.staffNotifications(tenant,access,{},readRequestId),next=await service.staffNotifications(otherTenant,access,{},randomUUID());assert.ok(previous.items.some((i:any)=>i.eventKind==='ownership_changed'));assert.equal(next.items.filter((i:any)=>i.eventKind==='ownership_changed').length,1);
      assert.equal(previous.items.filter((i:any)=>i.workItem.id===original.id).length,2);
      assert.equal(Number((await admin.query("SELECT count(*) FROM audit.event_resources r JOIN audit.events e ON e.id=r.event_id WHERE e.request_id=$1 AND e.action='staff_notifications.inbox.read' AND r.resource_type='work_item' AND r.resource_id=$2",[readRequestId,original.id])).rows[0].count),1);
      await scoped(worker,async c=>{await c.query('UPDATE work_items SET assignee_user_id=$2,revision=revision+1 WHERE id=$1',[original.id,other]);});await service.runStaffNotificationSweep(worker,options);
      assert.equal((await service.staffNotifications(otherTenant,access,{},randomUUID())).items.filter((i:any)=>i.eventKind==='ownership_changed').length,1);
      await createWork(owner);await service.runStaffNotificationSweep(worker,options);assert.equal((await service.staffNotifications(worker,access,{},randomUUID())).items.length,0);
    });
    await context.test('overdue scans deduplicate due/owner generation and rescheduling invalidates current attention',async()=>{
      await service.saveStaffNotificationPolicy(worker,{overdueEnabled:true,queueUserIds:[owner],escalationEnabled:true,escalationUserIds:[owner],escalationBusinessMinutes:480},ctx(1));
      const now=new Date('2026-10-19T23:30:00Z'),due=new Date('2026-10-16T23:00:00Z'),work=await createWork(recipient,due);
      await service.runStaffNotificationSweep(worker,{...options,now});await service.runStaffNotificationSweep(worker,{...options,now});
      assert.equal(Number((await admin.query("SELECT count(*) FROM staff_notification_events WHERE work_item_id=$1 AND event_kind='overdue'",[work.id])).rows[0].count),1);
      assert.equal(Number((await admin.query("SELECT count(*) FROM staff_notification_events WHERE work_item_id=$1 AND event_kind='escalated'",[work.id])).rows[0].count),1);
      await scoped(worker,async c=>{await c.query("UPDATE work_items SET due_at='2035-01-01T12:00:00Z',revision=revision+1 WHERE id=$1",[work.id]);});
      const detail=(await service.staffNotifications(tenant,access,{filter:'overdue'},randomUUID())).items.find((i:any)=>i.workItem.id===work.id)!;assert.equal(detail.subjectState,'reassigned');
      members.get(recipient)!.permissions=[];await service.runStaffNotificationSweep(worker,{...options,now});
      assert.equal((await admin.query('SELECT assignee_user_id FROM work_items WHERE id=$1',[work.id])).rows[0].assignee_user_id,null);members.get(recipient)!.permissions=['org:appointments:read','org:workflow:configure'];
    });
    await context.test('unknown staff email keeps the original key and only reconciles; pending messages never expose patient fields',async()=>{
      await service.saveStaffNotificationPreferences(tenant,{emailMode:'immediate',confirmedTimeZone:'America/Los_Angeles',quietStart:'18:00',quietEnd:'08:00'},ctx(1));
      await createWork();let sends=0,lookups=0;let externalKey='';
      const provider:DeliveryProvider={...disabled,enabled:true,ready:()=>true,send:async message=>{sends++;externalKey=message.externalKey;assert.equal(message.destination,'synthetic@example.invalid');assert.equal(message.text.includes(patientId),false);assert.equal(message.text.includes('Synthetic'),false);return {state:'unknown',code:'PROVIDER_RESULT_UNKNOWN'};},reconcile:async key=>{lookups++;assert.equal(key,externalKey);return {state:'accepted',providerMessageId:'synthetic_provider_id'};}};
      // Outbox availability uses the database clock; tomorrow at 19:00 UTC is after creation and outside Los Angeles quiet hours.
      const now=(await admin.query("SELECT date_trunc('day',clock_timestamp(),'UTC')+interval '43 hours' AS dispatch_at")).rows[0].dispatch_at as Date;await service.runStaffNotificationSweep(worker,{membership,provider,verifiedEmails:async()=>['synthetic@example.invalid'],now});
      assert.equal(sends,1);await service.runStaffNotificationSweep(worker,{membership,provider,verifiedEmails:async()=>['synthetic@example.invalid'],now:new Date(now.getTime()+360000)});assert.equal(sends,1);assert.equal(lookups,1);
    });
    await context.test('local location revocation removes recipient access immediately',async()=>{
      await admin.query('UPDATE location_assignments SET active=false WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[practiceId,locationId,recipient]);
      await assert.rejects(service.staffNotifications(tenant,access,{},randomUUID()),(e:any)=>e.code==='LOCATION_ACCESS_DENIED');
    });
  }finally{
    await runtime?.end();process.env.DATABASE_URL=old.url;process.env.DATABASE_SSL_MODE=old.ssl;if(old.staffUrl===undefined)delete process.env.CAREIQ_STAFF_APP_URL;else process.env.CAREIQ_STAFF_APP_URL=old.staffUrl;
    await admin.query(`DROP OWNED BY ${role}`).catch(()=>{});await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});await admin.end();
  }
});
