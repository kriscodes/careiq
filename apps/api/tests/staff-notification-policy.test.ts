import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { businessMinutesElapsed, canReadStaffWork, eventAudience, isQuiet, parsePreferences, parseStaffPolicy, snapshotCursor, subjectState } from '../src/notifications/staff-notification-policy.js';

test('ownership audience has one notice per eligible transition recipient and excludes the actor',()=>{
  const p={queueUserIds:['queue','owner'],escalationUserIds:['manager','manager']};
  assert.deepEqual(eventAudience({event_kind:'assignment',current_owner_id:'owner',actor_user_id:'owner'},p),[]);
  assert.deepEqual(eventAudience({event_kind:'ownership_changed',previous_owner_id:'owner',current_owner_id:'new',actor_user_id:'manager'},p),['owner','new']);
  assert.deepEqual(eventAudience({event_kind:'unassigned',previous_owner_id:'owner',current_owner_id:null,actor_user_id:'other'},p),['owner','queue']);
  assert.deepEqual(eventAudience({event_kind:'overdue',current_owner_id:null},p),['queue','owner']);
  assert.deepEqual(eventAudience({event_kind:'escalated',actor_user_id:'manager'},p),[]);
  assert.equal(canReadStaffWork(['org:work:manage']),false);
  assert.equal(canReadStaffWork(['org:appointments:read']),true);
});
test('source state resolves obsolete owner/due generations independently of personal read state',()=>{
  const event={event_kind:'overdue',current_owner_id:'owner',due_generation:4,owner_generation:2};
  const work={state:'open',assignee_user_id:'owner',notification_due_generation:4,notification_owner_generation:2};
  assert.equal(subjectState(event,work),'current');
  assert.equal(subjectState(event,{...work,notification_due_generation:5}),'reassigned');
  assert.equal(subjectState(event,{...work,assignee_user_id:'other'}),'reassigned');
  assert.equal(subjectState(event,{...work,state:'completed'}),'resolved');
});
test('quiet hours use the confirmed staff zone across DST and allow daytime delivery',()=>{
  assert.equal(isQuiet(new Date('2026-11-01T08:30:00Z'),'America/Los_Angeles','18:00','08:00'),true);
  assert.equal(isQuiet(new Date('2026-11-01T09:30:00Z'),'America/Los_Angeles','18:00','08:00'),true);
  assert.equal(isQuiet(new Date('2026-11-02T16:00:00Z'),'America/Los_Angeles','18:00','08:00'),false);
  assert.equal(isQuiet(new Date('2026-10-19T12:30:00Z'),'UTC','12:00','13:00'),true);
  assert.equal(isQuiet(new Date('2026-10-19T18:30:00Z'),'UTC','12:00','13:00'),false);
});
test('escalation counts business minutes after due, excludes holidays/weekends and respects the boundary',()=>{
  const due=new Date('2026-10-16T23:00:00Z'); // Friday 16:00 Pacific; 60 minutes Friday + 420 Monday.
  assert.equal(businessMinutesElapsed(due,new Date('2026-10-19T22:59:00Z'),'America/Los_Angeles',[],480),false);
  assert.equal(businessMinutesElapsed(due,new Date('2026-10-19T23:00:00Z'),'America/Los_Angeles',[],480),true);
  assert.equal(businessMinutesElapsed(due,new Date('2026-10-19T23:00:00Z'),'America/Los_Angeles',['2026-10-19'],480),false);
  assert.equal(businessMinutesElapsed(due,new Date('2026-10-20T23:00:00Z'),'America/Los_Angeles',['2026-10-19'],480),true);
});
test('preference/policy validation rejects access assertions and unsupported values',()=>{
  assert.throws(()=>parsePreferences({emailMode:'push'}));
  assert.throws(()=>parsePreferences({userId:'other'}));
  assert.throws(()=>parsePreferences({confirmedTimeZone:'Wrong/Zone'}));
  assert.throws(()=>parsePreferences({assignmentEmail:'true'}));
  assert.throws(()=>parsePreferences({quietStart:'26:00'}));
  assert.deepEqual(parsePreferences({emailMode:'digest',confirmedTimeZone:'America/Los_Angeles',quietStart:'18:00'}),{emailMode:'digest',confirmedTimeZone:'America/Los_Angeles',quietStart:'18:00'});
  assert.throws(()=>parseStaffPolicy({escalationBusinessMinutes:0}));
  assert.throws(()=>parseStaffPolicy({holidays:['2026-02-30']}));
  assert.deepEqual(parseStaffPolicy({queueUserIds:['a','a']}),{queueUserIds:['a']});
  assert.throws(()=>snapshotCursor(`${randomUUID()}.10001`));
  assert.throws(()=>snapshotCursor('junk'));
  const snapshotId=randomUUID();assert.deepEqual(snapshotCursor(`${snapshotId}.50`),{snapshotId,offset:50});
});
