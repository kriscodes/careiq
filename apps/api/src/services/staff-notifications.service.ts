import { randomUUID, createHash } from 'node:crypto';
import type { TenantContext } from '../middleware/tenant-context.js';
import { command, scoped, type CommandContext, type QueryClient } from '../workflow/transaction.js';
import { body, camel, checkRevision, concurrency, fingerprint, id, instant, WorkflowError } from '../workflow/policy.js';
import { currentMembership, verifiedEmails } from './clerk-directory.js';
import type { CurrentMembership } from './practice-policy.js';
import { recordWorkflowAudit, recordWorkflowFailure } from './workflow-audit.js';
import { createDeliveryProvider, type DeliveryProvider, type ProviderResult } from '../notifications/delivery-provider.js';
import { businessMinutesElapsed, canReadStaffWork, defaultPreferences, defaultStaffPolicy, eventAudience, isQuiet, localParts, notificationFilter, parsePreferences, parseStaffPolicy, snapshotCursor, subjectState } from '../notifications/staff-notification-policy.js';

type Row = Record<string, any> & {event_kind:string;due_generation:unknown;owner_generation:unknown};
type Access = {permissions:string[]};
const scope=(t:TenantContext)=>[t.practiceId,t.locationId];
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const permissionHash=(t:TenantContext,a:Access)=>fingerprint({userId:t.userId,practiceId:t.practiceId,locationId:t.locationId,membershipId:t.membershipId,permissions:[...a.permissions].sort()});
const ensureRead=(a:Access)=>{if(!canReadStaffWork(a.permissions))throw new WorkflowError('FORBIDDEN',403);};
export async function recordStaffNotificationFailure(t:TenantContext|null,code:string,status:number,requestId:string){await recordWorkflowFailure(t,{action:'staff_notifications.request.failed',entityType:'http_request',requestId,reasonCode:code,outcome:status===403?'denied':status>=500?'failed':'rejected',...(t?{}:{actorType:'anonymous' as const}),metadata:{code}});}
const preferenceDto=(row:Row|undefined)=> row ? {...concurrency(row),quietStart:row.quiet_start.slice(0,5),quietEnd:row.quiet_end.slice(0,5),digestTime:row.digest_time.slice(0,5)} : {...defaultPreferences,concurrency:{revision:1,ifMatch:'"1"'}};
const policyDto=(row:Row|undefined)=>row?concurrency(row):{...defaultStaffPolicy,concurrency:{revision:1,ifMatch:'"1"'}};
const visible="n.archived_at IS NULL AND (n.snoozed_until IS NULL OR n.snoozed_until<=now())";
const selection=`SELECT n.*,e.event_kind,e.previous_owner_id,e.current_owner_id,e.actor_user_id,e.occurred_at,e.due_generation,e.owner_generation,w.patient_id,w.appointment_id,w.kind,w.state AS work_state,w.assignee_user_id,w.due_at,w.revision AS work_revision,w.notification_due_generation,w.notification_owner_generation
 FROM staff_notifications n JOIN staff_notification_events e ON e.id=n.event_id AND e.practice_id=n.practice_id AND e.location_id=n.location_id JOIN work_items w ON w.id=n.work_item_id AND w.practice_id=n.practice_id AND w.location_id=n.location_id`;
// Several alerts can refer to the same work item; audit resource relations are unique per event.
const workResources=(rows:Row[])=>[...new Map(rows.map(r=>[r.work_item_id,{resourceType:'work_item',resourceId:r.work_item_id,patientId:r.patient_id}])).values()];
function itemDto(r:Row){
  const state=subjectState(r,{state:r.work_state,assignee_user_id:r.assignee_user_id,notification_due_generation:r.notification_due_generation,notification_owner_generation:r.notification_owner_generation});
  return {id:r.id,eventKind:r.event_kind,createdAt:r.created_at.toISOString(),occurredAt:r.occurred_at.toISOString(),readAt:r.read_at?.toISOString()??null,archivedAt:r.archived_at?.toISOString()??null,snoozedUntil:r.snoozed_until?.toISOString()??null,revision:Number(r.revision),concurrency:{revision:Number(r.revision),ifMatch:`"${r.revision}"`},workItem:{id:r.work_item_id,patientId:r.patient_id,appointmentId:r.appointment_id,kind:r.kind,state:r.work_state,assigneeUserId:r.assignee_user_id,dueAt:r.due_at?.toISOString()??null,revision:Number(r.work_revision)},subjectState:state,allowedActions:['read','unread','archive','snooze','open_work']};
}
function filterSql(filter:string){return filter==='unread'?'AND n.read_at IS NULL':filter==='assignment'?"AND e.event_kind IN('assignment','ownership_changed','unassigned')":filter==='overdue'?"AND e.event_kind IN('overdue','escalated')":'';}
async function counts(client:QueryClient,t:TenantContext){const r=(await client.query(`SELECT count(*) FILTER(WHERE n.read_at IS NULL)::int AS unread_count,count(*) FILTER(WHERE w.state IN('open','in_progress') AND w.due_at<now())::int AS attention_count FROM staff_notifications n JOIN work_items w ON w.id=n.work_item_id AND w.practice_id=n.practice_id AND w.location_id=n.location_id WHERE n.practice_id=$1 AND n.location_id=$2 AND n.recipient_user_id=$3 AND ${visible}`, [...scope(t),t.userId])).rows[0];return {unreadCount:r.unread_count,attentionCount:r.attention_count};}
async function snapshotRow(client:QueryClient,t:TenantContext,a:Access,snapshotId:string,filter?:string){
  const r=(await client.query('SELECT * FROM staff_notification_snapshots WHERE id=$1 AND practice_id=$2 AND location_id=$3 AND recipient_user_id=$4 AND expires_at>now()',[snapshotId,...scope(t),t.userId])).rows[0];
  if(!r||r.membership_id!==t.membershipId||r.permission_hash!==permissionHash(t,a)||(filter!==undefined&&r.filter!==filter))throw new WorkflowError('NOTIFICATION_SNAPSHOT_EXPIRED',409);
  return r;
}
async function queueStaffEmail(client:QueryClient,t:TenantContext,notificationId:string){await client.query("INSERT INTO outbox_events(practice_id,location_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,$2,'staff.email.pending',$3,1,$4::jsonb)",[...scope(t),notificationId,JSON.stringify({recipientUserId:t.userId})]);}
export async function staffNotifications(t:TenantContext,a:Access,query:Record<string,unknown>,requestId:string){
  ensureRead(a);const filter=notificationFilter(query.filter),cursor=snapshotCursor(query.cursor),limit=query.limit===undefined?50:Number(query.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||query.limit!==undefined&&typeof query.limit!=='string')throw new WorkflowError('INVALID_PAGINATION',400);
  // The authenticated inbox materializes its own committed alerts even without an external-email worker. It never sends email.
  await produceOverdue(t,new Date());
  await materializeSelf(t);
  return scoped(t,async client=>{
    let snapshot:Row;
    if(cursor)snapshot=await snapshotRow(client,t,a,cursor.snapshotId,filter);
    else {
      await client.query('DELETE FROM staff_notification_snapshots WHERE practice_id=$1 AND location_id=$2 AND recipient_user_id=$3 AND expires_at<=now()',[...scope(t),t.userId]);
      const rows=await client.query(`${selection} WHERE n.practice_id=$1 AND n.location_id=$2 AND n.recipient_user_id=$3 AND ${visible} ${filterSql(filter)} ORDER BY n.created_at DESC,n.id DESC LIMIT 10001`,[...scope(t),t.userId]);
      if(rows.rows.length>10000)throw new WorkflowError('NOTIFICATION_SCOPE_TOO_LARGE',422);
      snapshot=(await client.query('INSERT INTO staff_notification_snapshots(practice_id,location_id,recipient_user_id,membership_id,permission_hash,filter,member_ids) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[...scope(t),t.userId,t.membershipId,permissionHash(t,a),filter,rows.rows.map(r=>r.id)])).rows[0];
    }
    const offset=cursor?.offset??0,ids=snapshot.member_ids.slice(offset,offset+limit),next=offset+limit;
    const rows=await client.query(`${selection} WHERE n.id=ANY($1::uuid[]) AND n.practice_id=$2 AND n.location_id=$3 AND n.recipient_user_id=$4 AND ${visible} ${filterSql(filter)} ORDER BY n.created_at DESC,n.id DESC`,[ids,...scope(t),t.userId]);
    await recordWorkflowAudit(client,t,{action:'staff_notifications.inbox.read',entityType:'staff_notification',requestId,resources:workResources(rows.rows),metadata:{count:rows.rowCount}});
    return {items:rows.rows.map(itemDto),...await counts(client,t),asOf:new Date().toISOString(),snapshotToken:snapshot.id,pagination:{hasMore:next<snapshot.member_ids.length,nextCursor:next<snapshot.member_ids.length?`${snapshot.id}.${next}`:null}};
  },requestId,true);
}
async function materializeSelf(t:TenantContext){
  await scoped(t,async client=>{
    const policy=policyDto((await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2',scope(t))).rows[0]);
    const events=(await client.query(`SELECT e.* FROM staff_notification_events e WHERE e.practice_id=$1 AND e.location_id=$2 AND e.processed_at IS NULL AND (e.current_owner_id=$3 OR e.previous_owner_id=$3 OR (e.current_owner_id IS NULL AND $3=ANY($4::text[])) OR (e.event_kind='escalated' AND $3=ANY($5::text[]))) AND NOT EXISTS(SELECT 1 FROM staff_notifications n WHERE n.event_id=e.id AND n.recipient_user_id=$3) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1000`,[...scope(t),t.userId,policy.queueUserIds,policy.escalationUserIds])).rows;
    for(const event of events){
      if(!eventAudience(event,policy).includes(t.userId)||(!policy.assignmentsEnabled&&!['overdue','escalated'].includes(event.event_kind))||(['overdue','escalated'].includes(event.event_kind)&&!policy.overdueEnabled)||(event.event_kind==='escalated'&&!policy.escalationEnabled))continue;
      const work=(await client.query('SELECT * FROM work_items WHERE id=$1 AND practice_id=$2 AND location_id=$3',[event.work_item_id,...scope(t)])).rows[0];if(!work)continue;
      if(['overdue','escalated'].includes(event.event_kind)&&subjectState(event,work)!=='current')continue;
      const prefs=(await client.query('SELECT email_mode FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[...scope(t),t.userId])).rows[0];
      const email=prefs?.email_mode&&prefs.email_mode!=='off'?'pending':'off';
      const inserted=await client.query('INSERT INTO staff_notifications(practice_id,location_id,event_id,work_item_id,recipient_user_id,email_state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',[...scope(t),event.id,work.id,t.userId,email]);if(email==='pending'&&inserted.rows[0])await queueStaffEmail(client,t,inserted.rows[0].id);
    }
  });
}
export async function staffNotification(t:TenantContext,a:Access,notificationId:string,requestId:string){ensureRead(a);return scoped(t,async client=>{const r=(await client.query(`${selection} WHERE n.id=$1 AND n.practice_id=$2 AND n.location_id=$3 AND n.recipient_user_id=$4`,[id(notificationId),...scope(t),t.userId])).rows[0];if(!r)throw new WorkflowError('RESOURCE_NOT_FOUND',404);await recordWorkflowAudit(client,t,{action:'staff_notifications.detail.read',entityType:'staff_notification',entityId:r.id,requestId,resources:[{resourceType:'work_item',resourceId:r.work_item_id,patientId:r.patient_id}]});return itemDto(r);},requestId);}
export async function updateStaffNotification(t:TenantContext,a:Access,notificationId:string,action:'read'|'archive'|'snooze',input:unknown,context:CommandContext){
  ensureRead(a);const p=body(input,action==='read'?['read']:action==='snooze'?['until']:[]);if(action==='read'&&typeof p.read!=='boolean')throw new WorkflowError('INVALID_READ_STATE',422);
  const until=action==='snooze'?instant(p.until,'until'):null;if(until&&(until.getTime()<Date.now()+60000||until.getTime()>Date.now()+30*86400000))throw new WorkflowError('INVALID_SNOOZE',422);
  return command(t,`staff-notifications.${action}`,id(notificationId),p,context,async client=>{
    const r=(await client.query(`${selection} WHERE n.id=$1 AND n.practice_id=$2 AND n.location_id=$3 AND n.recipient_user_id=$4 FOR UPDATE OF n`,[notificationId,...scope(t),t.userId])).rows[0];if(!r)throw new WorkflowError('RESOURCE_NOT_FOUND',404);checkRevision(r,context.expectedRevision);
    const field=action==='read'?'read_at':action==='archive'?'archived_at':'snoozed_until',value=action==='read'?(p.read?new Date():null):action==='archive'?new Date():until;
    const result=(await client.query(`UPDATE staff_notifications SET ${field}=$1,revision=revision+1 WHERE id=$2 RETURNING id,read_at,archived_at,snoozed_until,revision`,[value,r.id])).rows[0];return concurrency(result);
  });
}
export async function readAllStaffNotifications(t:TenantContext,a:Access,input:unknown,context:CommandContext){
  ensureRead(a);const p=body(input,['snapshotToken']),token=id(p.snapshotToken);
  return command(t,'staff-notifications.read-all','',p,context,async client=>{
    const snapshot=await snapshotRow(client,t,a,token);
    const result=await client.query(`UPDATE staff_notifications n SET read_at=now(),revision=revision+1 WHERE n.id=ANY($1::uuid[]) AND n.practice_id=$2 AND n.location_id=$3 AND n.recipient_user_id=$4 AND n.read_at IS NULL AND EXISTS(SELECT 1 FROM work_items w WHERE w.id=n.work_item_id AND w.practice_id=n.practice_id AND w.location_id=n.location_id) RETURNING n.id`,[snapshot.member_ids,...scope(t),t.userId]);
    return {updatedCount:result.rowCount??0,...await counts(client,t)};
  });
}
export async function staffNotificationPreferences(t:TenantContext,requestId:string){return scoped(t,async client=>preferenceDto((await client.query('SELECT * FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[...scope(t),t.userId])).rows[0]),requestId);}
export async function saveStaffNotificationPreferences(t:TenantContext,input:unknown,context:CommandContext){
  const changes=parsePreferences(input);return command(t,'staff-notifications.preferences','',input,context,async client=>{
    await client.query('INSERT INTO staff_notification_preferences(practice_id,location_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[...scope(t),t.userId]);
    const r=(await client.query('SELECT * FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3 FOR UPDATE',[...scope(t),t.userId])).rows[0];checkRevision(r,context.expectedRevision);
    const merged={...preferenceDto(r),...changes};if(merged.emailMode!=='off'&&!merged.confirmedTimeZone)throw new WorkflowError('STAFF_TIME_ZONE_UNCONFIRMED',422);
    const fields=Object.entries(changes).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v] as const),values=fields.map(([,v])=>v);
    const row=(await client.query(`UPDATE staff_notification_preferences SET ${fields.map(([k],i)=>`${k}=$${i+1},`).join('')}revision=revision+1,updated_at=now() WHERE practice_id=$${values.length+1} AND location_id=$${values.length+2} AND user_id=$${values.length+3} RETURNING *`,[...values,...scope(t),t.userId])).rows[0];return preferenceDto(row);
  });
}
export async function staffNotificationPolicy(t:TenantContext,requestId:string,includeRecipients=false){
  const result=await scoped(t,async client=>({policy:policyDto((await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2',scope(t))).rows[0]),candidates:includeRecipients?(await client.query("SELECT m.user_id,m.membership_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.status='active' AND a.active ORDER BY m.user_id LIMIT 500",scope(t))).rows:[]}),requestId);
  if(!includeRecipients)return result.policy;
  const eligibleRecipients: {userId:string;displayName:string}[]=[];
  for(const candidate of result.candidates){const member=await currentMembership(t.orgId,candidate.user_id);if(member&&member.id===candidate.membership_id&&canReadStaffWork(member.permissions))eligibleRecipients.push({userId:candidate.user_id,displayName:member.displayName??candidate.user_id});}
  return {...result.policy,eligibleRecipients,allowedActions:['save']};
}
export async function saveStaffNotificationPolicy(t:TenantContext,input:unknown,context:CommandContext){
  const changes=parseStaffPolicy(input);return command(t,'staff-notifications.policy','',input,context,async client=>{
    await client.query('INSERT INTO staff_notification_policies(practice_id,location_id) VALUES($1,$2) ON CONFLICT DO NOTHING',scope(t));const r=(await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2 FOR UPDATE',scope(t))).rows[0];checkRevision(r,context.expectedRevision);
    const users=[...new Set([...(changes.queueUserIds as string[]??r.queue_user_ids),...(changes.escalationUserIds as string[]??r.escalation_user_ids)])];
    if(users.length){const valid=await client.query("SELECT m.user_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.user_id=ANY($3::text[]) AND m.status='active' AND a.active FOR SHARE",[...scope(t),users]);if(valid.rowCount!==users.length)throw new WorkflowError('INVALID_NOTIFICATION_RECIPIENT',422);}
    const merged={...policyDto(r),...changes};if(merged.overdueEnabled&&!merged.queueUserIds.length)throw new WorkflowError('NOTIFICATION_QUEUE_REQUIRED',422);if(merged.escalationEnabled&&!merged.escalationUserIds.length)throw new WorkflowError('NOTIFICATION_ESCALATION_AUDIENCE_REQUIRED',422);
    const fields=Object.entries(changes).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v] as const),values=fields.map(([,v])=>v);
    return policyDto((await client.query(`UPDATE staff_notification_policies SET ${fields.map(([k],i)=>`${k}=$${i+1},`).join('')}revision=revision+1,updated_at=now() WHERE practice_id=$${values.length+1} AND location_id=$${values.length+2} RETURNING *`,[...values,...scope(t)])).rows[0]);
  });
}

export type StaffSweepOptions={membership?:typeof currentMembership;verifiedEmails?:typeof verifiedEmails;provider?:DeliveryProvider;now?:Date};
async function eligibleRecipient(worker:TenantContext,userId:string,resolve:typeof currentMembership):Promise<TenantContext|null>{
  const member=await resolve(worker.orgId,userId);if(!member||!canReadStaffWork(member.permissions))return null;
  return scoped(worker,async client=>{const r=(await client.query("SELECT m.membership_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.user_id=$3 AND m.status='active' AND a.active",[...scope(worker),userId])).rows[0];return r?.membership_id===member.id?{...worker,userId,membershipId:member.id}:null;});
}
async function produceOverdue(t:TenantContext,now:Date){
  return scoped(t,async client=>{
    const policy=policyDto((await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2',scope(t))).rows[0]);if(!policy.overdueEnabled)return;
    const zone=(await client.query('SELECT time_zone FROM locations WHERE practice_id=$1 AND id=$2',scope(t))).rows[0].time_zone;
    const works=await client.query("SELECT w.* FROM work_items w WHERE w.practice_id=$1 AND w.location_id=$2 AND w.state IN('open','in_progress') AND w.due_at<=$3::timestamptz-($4::int*interval '1 minute') AND (NOT EXISTS(SELECT 1 FROM staff_notification_events e WHERE e.work_item_id=w.id AND e.event_kind='overdue' AND e.due_generation=w.notification_due_generation AND e.owner_generation=w.notification_owner_generation) OR ($5::boolean AND NOT EXISTS(SELECT 1 FROM staff_notification_events e WHERE e.work_item_id=w.id AND e.event_kind='escalated' AND e.due_generation=w.notification_due_generation AND e.owner_generation=w.notification_owner_generation))) ORDER BY EXISTS(SELECT 1 FROM staff_notification_events e WHERE e.work_item_id=w.id AND e.event_kind='overdue' AND e.due_generation=w.notification_due_generation AND e.owner_generation=w.notification_owner_generation),w.due_at,w.id LIMIT 500 FOR UPDATE OF w SKIP LOCKED",[...scope(t),now,policy.overdueAfterMinutes,policy.escalationEnabled]);
    for(const w of works.rows){
      const kinds=['overdue'];if(policy.escalationEnabled&&businessMinutesElapsed(new Date(w.due_at.getTime()+policy.overdueAfterMinutes*60000),now,zone,policy.holidays,policy.escalationBusinessMinutes))kinds.push('escalated');
      for(const kind of kinds)await client.query('INSERT INTO staff_notification_events(practice_id,location_id,work_item_id,event_kind,source_revision,due_generation,owner_generation,current_owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[...scope(t),w.id,kind,w.revision,w.notification_due_generation,w.notification_owner_generation,w.assignee_user_id]);
    }
  });
}
async function fanoutEvent(t:TenantContext,event:Row,resolve:typeof currentMembership){
  const policy=await staffNotificationPolicy(t,randomUUID());
  if((!policy.assignmentsEnabled&&!['overdue','escalated'].includes(event.event_kind))||(['overdue','escalated'].includes(event.event_kind)&&!policy.overdueEnabled)||(event.event_kind==='escalated'&&!policy.escalationEnabled))return scoped(t,async client=>{await client.query('UPDATE staff_notification_events SET processed_at=now() WHERE id=$1',[event.id]);return 0;});
  let added=0;
  for(const userId of eventAudience(event,policy)){
    const recipient=await eligibleRecipient(t,userId,resolve);if(!recipient)continue;
    added+=await scoped(recipient,async client=>{
      const w=(await client.query('SELECT * FROM work_items WHERE id=$1 AND practice_id=$2 AND location_id=$3 FOR SHARE',[event.work_item_id,...scope(t)])).rows[0];if(!w)return 0;
      if(['overdue','escalated'].includes(event.event_kind)&&subjectState(event,w)!=='current')return 0;
      // An obsolete new-owner alert is skipped, but eligible previous owners retain the ownership history.
      if(['assignment','ownership_changed'].includes(event.event_kind)&&event.current_owner_id===userId&&w.assignee_user_id!==userId)return 0;
      const prefs=await client.query('SELECT email_mode FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[...scope(t),userId]);
      const email=prefs.rows[0]?.email_mode&&prefs.rows[0].email_mode!=='off'?'pending':'off';
      const inserted=await client.query('INSERT INTO staff_notifications(practice_id,location_id,event_id,work_item_id,recipient_user_id,email_state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',[...scope(t),event.id,event.work_item_id,userId,email]);
      if(inserted.rows[0])await recordWorkflowAudit(client,recipient,{action:'staff_notifications.fanout',entityType:'staff_notification',entityId:inserted.rows[0].id,actorType:'background_job',executorId:t.userId,initiatingActorType:event.actor_user_id?'user':'background_job',initiatingActorId:event.actor_user_id??undefined,resources:[{resourceType:'work_item',resourceId:w.id,patientId:w.patient_id}],metadata:{channel:'in_app'}});
      if(email==='pending'&&inserted.rows[0])await queueStaffEmail(client,recipient,inserted.rows[0].id);return inserted.rowCount??0;
    });
  }
  await scoped(t,async client=>{await client.query('UPDATE staff_notification_events SET processed_at=now() WHERE id=$1 AND practice_id=$2 AND location_id=$3',[event.id,...scope(t)]);});return added;
}
function genericStaffMessage(locale:string,count:number,origin:string){return locale==='es'?{subject:count>1?'Novedades de trabajo en CareIQ':'Nueva novedad de trabajo',text:`Tiene ${count>1?`${count} novedades de trabajo`:'una nueva novedad de trabajo'}. Inicie sesión en CareIQ para revisar su trabajo. ${origin}`}:{subject:count>1?'Your CareIQ work updates':'A new work update',text:`You have ${count>1?`${count} new work updates`:'a new work update'}. Sign in to CareIQ to review your work. ${origin}`};}
function appOrigin(){const raw=process.env.CAREIQ_STAFF_APP_URL;if(!raw)return null;try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)return null;return u.origin+'/';}catch{return null;}}
async function emailCurrent(client:QueryClient,t:TenantContext,ids:string[],now:Date){
  const rows=(await client.query(`${selection} WHERE n.id=ANY($1::uuid[]) AND n.practice_id=$2 AND n.location_id=$3 AND n.recipient_user_id=$4 FOR UPDATE OF n FOR SHARE OF w`,[ids,...scope(t),t.userId])).rows;
  const policy=policyDto((await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2',scope(t))).rows[0]);
  return rows.filter(r=>(['overdue','escalated'].includes(r.event_kind)?policy.overdueEnabled&&(r.event_kind!=='escalated'||policy.escalationEnabled):policy.assignmentsEnabled)&&!r.read_at&&!r.archived_at&&(!r.snoozed_until||r.snoozed_until<=now)&&subjectState(r,{state:r.work_state,assignee_user_id:r.assignee_user_id,notification_due_generation:r.notification_due_generation,notification_owner_generation:r.notification_owner_generation})==='current');
}
async function dispatchRecipientEmail(t:TenantContext,options:StaffSweepOptions,provider:DeliveryProvider,now:Date,executorId:string){
  const origin=appOrigin();if(!origin||!provider.enabled||!provider.ready('email'))return;
  const membership=await (options.membership??currentMembership)(t.orgId,t.userId);if(!membership||membership.id!==t.membershipId||!canReadStaffWork(membership.permissions))return;
  const emails=await (options.verifiedEmails??verifiedEmails)(t.userId);if(!emails.length)return;const destination=emails[0]!,destinationHash=hash(destination.toLowerCase());
  const batches=await scoped(t,async client=>(await client.query("SELECT * FROM staff_notification_email_batches WHERE practice_id=$1 AND location_id=$2 AND recipient_user_id=$3 AND (state IN('unknown','retry','accepted') AND (next_at IS NULL OR next_at<=$4) OR state='submitting' AND updated_at<$4::timestamptz-interval '2 minutes') ORDER BY created_at LIMIT 20",[...scope(t),t.userId,now])).rows);
  for(const existing of batches){
    if(existing.state!=='retry'){
      // A crashed or ambiguous submission is lookup-only, regardless of changed preferences/source.
      const result=await provider.reconcile(existing.external_key,existing.provider_message_id??undefined);
      await finalizeEmailBatch(t,existing.id,result,existing.member_ids,now);continue;
    }
    const retry=await scoped(t,async client=>{
      const b=(await client.query("SELECT * FROM staff_notification_email_batches WHERE id=$1 AND state='retry' AND (next_at IS NULL OR next_at<=$2) FOR UPDATE",[existing.id,now])).rows[0];if(!b)return null;
      const prefs=preferenceDto((await client.query('SELECT * FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[...scope(t),t.userId])).rows[0]);
      const current=await emailCurrent(client,t,b.member_ids,now);
      if(b.destination_hash!==destinationHash||Number(b.preference_revision)!==prefs.revision||prefs.emailMode==='off'||current.length!==b.member_ids.length||b.attempt_count>=5){await suppressBatch(client,b,'STAFF_DELIVERY_OBSOLETE');return null;}
      if(!prefs.confirmedTimeZone||isQuiet(now,prefs.confirmedTimeZone,prefs.quietStart,prefs.quietEnd))return null;
      await client.query("UPDATE staff_notification_email_batches SET state='submitting',attempt_count=attempt_count+1,updated_at=$2 WHERE id=$1",[b.id,now]);return {...b,locale:prefs.locale};
    });
    if(retry){const msg=genericStaffMessage(retry.locale,retry.member_ids.length,origin);await finalizeEmailBatch(t,retry.id,await provider.send({channel:'email',destination,...msg,externalKey:retry.external_key}),retry.member_ids,now);}
  }
  const prepared=await scoped(t,async client=>{
    // Scope/recipient serialization prevents two workers preparing the same digest or immediate row.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`staff-email:${t.practiceId}:${t.locationId}:${t.userId}`]);
    const prefs=preferenceDto((await client.query('SELECT * FROM staff_notification_preferences WHERE practice_id=$1 AND location_id=$2 AND user_id=$3',[...scope(t),t.userId])).rows[0]);
    if(prefs.emailMode==='off'){const suppressed=await client.query("UPDATE staff_notifications SET email_state='suppressed',email_failure_code='STAFF_EMAIL_DISABLED' WHERE practice_id=$1 AND location_id=$2 AND recipient_user_id=$3 AND email_state='pending' RETURNING id",[...scope(t),t.userId]);await client.query("UPDATE outbox_events SET published_at=now() WHERE event_type='staff.email.pending' AND aggregate_id=ANY($1::uuid[])",[suppressed.rows.map(r=>r.id)]);return null;}
    if(!prefs.confirmedTimeZone||isQuiet(now,prefs.confirmedTimeZone,prefs.quietStart,prefs.quietEnd))return null;
    const policy=policyDto((await client.query('SELECT * FROM staff_notification_policies WHERE practice_id=$1 AND location_id=$2',scope(t))).rows[0]);
    const local=localParts(now,prefs.confirmedTimeZone),digestMinute=Number(prefs.digestTime.slice(0,2))*60+Number(prefs.digestTime.slice(3,5));
    if(prefs.emailMode==='digest'&&local.minutes<digestMinute)return null;
    if(prefs.emailMode==='digest'){
      const prior=await client.query('SELECT created_at FROM staff_notification_email_batches WHERE practice_id=$1 AND location_id=$2 AND recipient_user_id=$3 AND external_key LIKE $4 LIMIT 1',[...scope(t),t.userId,`staff-digest:${hash(`${t.practiceId}:${t.locationId}:${t.userId}`).slice(0,32)}:${local.date}:%`]);if(prior.rowCount)return null;
    }
    const rows=(await client.query(`${selection} WHERE n.practice_id=$1 AND n.location_id=$2 AND n.recipient_user_id=$3 AND n.email_state='pending' ORDER BY n.created_at,n.id LIMIT $4 FOR UPDATE OF n SKIP LOCKED FOR SHARE OF w`,[...scope(t),t.userId,prefs.emailMode==='digest'?1000:1])).rows;
    const valid:Row[]=[];
    for(const r of rows){const overdue=['overdue','escalated'].includes(r.event_kind),source=subjectState(r,{state:r.work_state,assignee_user_id:r.assignee_user_id,notification_due_generation:r.notification_due_generation,notification_owner_generation:r.notification_owner_generation});if(source!=='current'||r.read_at||r.archived_at||(overdue?!prefs.overdueEmail||!policy.overdueEnabled||(r.event_kind==='escalated'&&!policy.escalationEnabled):!prefs.assignmentEmail||!policy.assignmentsEnabled)){await client.query("UPDATE staff_notifications SET email_state='suppressed',email_failure_code='STAFF_DELIVERY_OBSOLETE' WHERE id=$1",[r.id]);await client.query("UPDATE outbox_events SET published_at=now() WHERE event_type='staff.email.pending' AND aggregate_id=$1 AND practice_id=$2 AND location_id=$3",[r.id,...scope(t)]);continue;}if(r.snoozed_until&&r.snoozed_until>now)continue;valid.push(r);}
    if(!valid.length)return null;const batchId=randomUUID(),externalKey=prefs.emailMode==='digest'?`staff-digest:${hash(`${t.practiceId}:${t.locationId}:${t.userId}`).slice(0,32)}:${local.date}:${batchId}`:`staff-alert:${valid[0]!.id}`;
    for(let offset=0;offset<valid.length;offset+=500)await recordWorkflowAudit(client,t,{action:'staff_notifications.email.submitting',entityType:'staff_notification_email',entityId:batchId,actorType:'background_job',executorId,resources:workResources(valid.slice(offset,offset+500)),metadata:{channel:'email',count:valid.length}});
    const batch=(await client.query("INSERT INTO staff_notification_email_batches(id,practice_id,location_id,recipient_user_id,member_ids,external_key,destination_hash,preference_revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitting') RETURNING *",[batchId,...scope(t),t.userId,valid.map(r=>r.id),externalKey,destinationHash,prefs.revision])).rows[0];
    await client.query("UPDATE staff_notifications SET email_state='submitting',email_attempt_count=email_attempt_count+1 WHERE id=ANY($1::uuid[])",[batch.member_ids]);return {...batch,locale:prefs.locale};
  });
  if(prepared){const message=genericStaffMessage(prepared.locale,prepared.member_ids.length,origin);const result=await provider.send({channel:'email',destination,...message,externalKey:prepared.external_key});await finalizeEmailBatch(t,prepared.id,result,prepared.member_ids,now);}
}
async function suppressBatch(client:QueryClient,batch:Row,code:string){await client.query("UPDATE staff_notification_email_batches SET state='suppressed',failure_code=$2,updated_at=now() WHERE id=$1",[batch.id,code]);await client.query("UPDATE staff_notifications SET email_state='suppressed',email_failure_code=$2 WHERE id=ANY($1::uuid[])",[batch.member_ids,code]);await client.query("UPDATE outbox_events SET published_at=now() WHERE event_type='staff.email.pending' AND aggregate_id=ANY($1::uuid[])",[batch.member_ids]);}
async function finalizeEmailBatch(t:TenantContext,batchId:string,result:ProviderResult,ids:string[],now:Date){
  await scoped(t,async client=>{
    const batch=(await client.query('SELECT * FROM staff_notification_email_batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];if(!batch||!['submitting','unknown','retry','accepted'].includes(batch.state))return;
    const state=batch.state==='accepted'&&['unknown','retry'].includes(result.state)?'accepted':result.state==='retry'&&batch.attempt_count>=5?'failed':result.state;
    const next=state==='retry'?new Date(now.getTime()+Math.max(60,Math.min(result.retryAfterSeconds??300,86400))*1000):['unknown','accepted'].includes(state)?new Date(now.getTime()+300000):null;
    await client.query("UPDATE staff_notification_email_batches SET state=$2,provider_message_id=coalesce($3,provider_message_id),failure_code=$4,next_at=$5,updated_at=$6,accepted_at=CASE WHEN $2 IN('accepted','delivered') THEN coalesce(accepted_at,$6) ELSE accepted_at END,delivered_at=CASE WHEN $2='delivered' THEN coalesce(delivered_at,$6) ELSE delivered_at END,failed_at=CASE WHEN $2='failed' THEN coalesce(failed_at,$6) ELSE failed_at END WHERE id=$1",[batchId,state,result.providerMessageId??null,result.code??null,next,now]);
    await client.query('UPDATE staff_notifications SET email_state=$2,email_provider_message_id=coalesce($3,email_provider_message_id),email_failure_code=$4,email_next_at=$5 WHERE id=ANY($1::uuid[])',[ids,state,result.providerMessageId??null,result.code??null,next]);
    await client.query("UPDATE outbox_events SET published_at=CASE WHEN $2::timestamptz IS NULL THEN now() ELSE NULL END,available_at=coalesce($2::timestamptz,available_at),updated_at=now() WHERE event_type='staff.email.pending' AND aggregate_id=ANY($1::uuid[])",[ids,next]);
  });
}
/** Called only for an operator-configured explicit scope; recipient context is reauthorized before inbox fan-out or generic external delivery. */
export async function runStaffNotificationSweep(t:TenantContext,options:StaffSweepOptions={}){
  const resolve=options.membership??currentMembership,worker=await resolve(t.orgId,t.userId),now=options.now??new Date();
  if(!worker||worker.id!==t.membershipId||!canReadStaffWork(worker.permissions))throw new WorkflowError('WORKER_AUTHORIZATION_UNAVAILABLE',403);
  // Losing membership/location/read permission returns current work to the configured queue. Assignment never substitutes for access.
  const owners=await scoped(t,async client=>(await client.query("SELECT DISTINCT assignee_user_id FROM work_items WHERE practice_id=$1 AND location_id=$2 AND state IN('open','in_progress') AND assignee_user_id IS NOT NULL LIMIT 500",scope(t))).rows);
  for(const owner of owners)if(!await eligibleRecipient(t,owner.assignee_user_id,resolve))await scoped(t,async client=>{await client.query("SELECT set_config('app.staff_notification_system_event','true',true)");await client.query("UPDATE work_items SET assignee_user_id=NULL,revision=revision+1,updated_at=now() WHERE practice_id=$1 AND location_id=$2 AND assignee_user_id=$3 AND state IN('open','in_progress')",[...scope(t),owner.assignee_user_id]);});
  await produceOverdue(t,now);
  const events=await scoped(t,async client=>(await client.query('SELECT * FROM staff_notification_events WHERE practice_id=$1 AND location_id=$2 AND processed_at IS NULL ORDER BY occurred_at,id LIMIT 200',scope(t))).rows);
  let added=0;for(const event of events)added+=await fanoutEvent(t,event,resolve);
  const provider=options.provider??createDeliveryProvider();
  if(provider.enabled&&provider.ready('email')){
    const candidates=await scoped(t,async client=>(await client.query("SELECT payload->>'recipientUserId' AS user_id FROM outbox_events WHERE practice_id=$1 AND location_id=$2 AND event_type='staff.email.pending' AND published_at IS NULL AND available_at<=$3 GROUP BY payload->>'recipientUserId' ORDER BY min(available_at) LIMIT 50",[...scope(t),now])).rows);
    for(const candidate of candidates){
      const recipient=await eligibleRecipient(t,candidate.user_id,resolve);
      await scoped(t,async client=>{await client.query("UPDATE outbox_events SET available_at=$4::timestamptz+interval '1 minute',published_at=CASE WHEN $5::boolean THEN published_at ELSE now() END,last_failure_code=CASE WHEN $5::boolean THEN last_failure_code ELSE 'STAFF_RECIPIENT_INELIGIBLE' END WHERE practice_id=$1 AND location_id=$2 AND event_type='staff.email.pending' AND payload->>'recipientUserId'=$3 AND published_at IS NULL AND available_at<=$4",[...scope(t),candidate.user_id,now,Boolean(recipient)]);});
      if(recipient)await dispatchRecipientEmail(recipient,options,provider,now,t.userId);
    }
  }
  return {eventsProcessed:events.length,notificationsCreated:added};
}
