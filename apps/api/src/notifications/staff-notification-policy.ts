import { body, id, isoDate, text, WorkflowError } from '../workflow/policy.js';

export const eventKinds = ['assignment', 'ownership_changed', 'unassigned', 'overdue', 'escalated'] as const;
export type StaffEventKind = typeof eventKinds[number];
export const defaultPreferences = { revision: 1, locale: 'en', confirmedTimeZone: null as string | null, emailMode: 'off', assignmentEmail: true, overdueEmail: true, quietStart: '18:00', quietEnd: '08:00', digestTime: '08:30' };
export const defaultStaffPolicy = { revision: 1, assignmentsEnabled: true, overdueEnabled: false, overdueAfterMinutes: 0, escalationEnabled: false, escalationBusinessMinutes: 480, queueUserIds: [] as string[], escalationUserIds: [] as string[], holidays: [] as string[] };

export function canReadStaffWork(permissions: readonly string[]) { return permissions.includes('org:appointments:read'); }
export function timeZone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 80) throw new WorkflowError('INVALID_TIME_ZONE', 422);
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); } catch { throw new WorkflowError('INVALID_TIME_ZONE', 422); }
  return value;
}
const clock = (value: unknown) => {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new WorkflowError('INVALID_QUIET_HOURS', 422);
  return value;
};
export function parsePreferences(input: unknown) {
  const p = body(input, ['locale','confirmedTimeZone','emailMode','assignmentEmail','overdueEmail','quietStart','quietEnd','digestTime']);
  const result: Record<string, unknown> = {};
  for (const field of Object.keys(p)) {
    if (field === 'locale') { if (!['en','es'].includes(String(p[field]))) throw new WorkflowError('INVALID_LOCALE',422); }
    if (field === 'emailMode') { if (!['off','immediate','digest'].includes(String(p[field]))) throw new WorkflowError('INVALID_EMAIL_MODE',422); }
    if (['assignmentEmail','overdueEmail'].includes(field) && typeof p[field] !== 'boolean') throw new WorkflowError('INVALID_PREFERENCE',422);
    result[field] = field === 'confirmedTimeZone' ? timeZone(p[field]) : ['quietStart','quietEnd','digestTime'].includes(field) ? clock(p[field]) : p[field];
  }
  return result;
}
export function parseStaffPolicy(input: unknown) {
  const p=body(input,['assignmentsEnabled','overdueEnabled','overdueAfterMinutes','escalationEnabled','escalationBusinessMinutes','queueUserIds','escalationUserIds','holidays']);
  const result: Record<string, unknown> = {};
  for (const field of Object.keys(p)) {
    const value=p[field];
    if (['assignmentsEnabled','overdueEnabled','escalationEnabled'].includes(field)) { if(typeof value!=='boolean')throw new WorkflowError('INVALID_NOTIFICATION_POLICY',422);result[field]=value; }
    else if (field.endsWith('Minutes')) { const min=field==='escalationBusinessMinutes'?60:0;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>10080)throw new WorkflowError('INVALID_NOTIFICATION_POLICY',422);result[field]=value; }
    else if(field==='holidays'){if(!Array.isArray(value)||value.length>100)throw new WorkflowError('INVALID_NOTIFICATION_POLICY',422);result[field]=[...new Set(value.map(isoDate))];}
    else { if(!Array.isArray(value)||value.length>50)throw new WorkflowError('INVALID_NOTIFICATION_POLICY',422);result[field]=[...new Set(value.map(v=>text(v,'userId',128)!))]; }
  }
  return result;
}
export function notificationFilter(value: unknown) {
  if(value===undefined)return 'all';
  if(typeof value!=='string'||!['all','unread','assignment','overdue'].includes(value))throw new WorkflowError('INVALID_NOTIFICATION_FILTER',400);
  return value;
}
export function snapshotCursor(value: unknown): {snapshotId:string;offset:number}|undefined {
  if(value===undefined)return undefined;
  const match=typeof value==='string' ? /^([0-9a-f-]+)\.([0-9]+)$/.exec(value) : null;
  if(!match)throw new WorkflowError('INVALID_NOTIFICATION_CURSOR',400);
  const offset=Number(match[2]);if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new WorkflowError('INVALID_NOTIFICATION_CURSOR',400);
  return {snapshotId:id(match[1]),offset};
}
export function eventAudience(event: {event_kind:string;previous_owner_id?:string|null;current_owner_id?:string|null;actor_user_id?:string|null}, policy: {queueUserIds:string[];escalationUserIds:string[]}) {
  const recipients=event.event_kind==='escalated' ? policy.escalationUserIds : event.event_kind==='unassigned' ? [event.previous_owner_id,...policy.queueUserIds] : event.event_kind==='ownership_changed' ? [event.previous_owner_id,event.current_owner_id] : event.current_owner_id ? [event.current_owner_id] : policy.queueUserIds;
  return [...new Set(recipients.filter((v):v is string=>Boolean(v)&&v!==event.actor_user_id))];
}
export function subjectState(event: {event_kind:string;current_owner_id?:string|null;due_generation:unknown;owner_generation:unknown}, work: {state:string;assignee_user_id?:string|null;notification_due_generation:unknown;notification_owner_generation:unknown}) {
  if(!['open','in_progress'].includes(work.state))return 'resolved';
  if(event.current_owner_id!==work.assignee_user_id || (['overdue','escalated'].includes(event.event_kind) && (String(event.due_generation)!==String(work.notification_due_generation)||String(event.owner_generation)!==String(work.notification_owner_generation))))return 'reassigned';
  return 'current';
}
export function localParts(at:Date,zone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,weekday:get('weekday'),minutes:Number(get('hour'))*60+Number(get('minute'))};
}
const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
export function isQuiet(at:Date,zone:string,start:string,end:string) {
  const current=localParts(at,zone).minutes,a=minutes(start),b=minutes(end);
  return a===b ? false : a<b ? current>=a&&current<b : current>=a||current<b;
}
/** Count actual minute boundaries in the explicit location Mon–Fri 09:00–17:00 calendar. DST and holidays are evaluated in the location zone. */
export function businessMinutesElapsed(from:Date,to:Date,zone:string,holidays:readonly string[],threshold:number) {
  if(to<=from)return false;
  // A very old overdue item is scanned from its due date. Bound work without silently claiming an escalation.
  let count=0;const end=to.getTime(), holidaySet=new Set(holidays);
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let current=Math.ceil(from.getTime()/60000)*60000,steps=0;current+60000<=end&&steps<366*24*60;current+=60000,steps++){
    const p=Object.fromEntries(formatter.formatToParts(current).map(x=>[x.type,x.value]));
    if(!['Sat','Sun'].includes(p.weekday)&&!holidaySet.has(`${p.year}-${p.month}-${p.day}`)&&Number(p.hour)>=9&&Number(p.hour)<17)if(++count>=threshold)return true;
  }
  return false;
}
