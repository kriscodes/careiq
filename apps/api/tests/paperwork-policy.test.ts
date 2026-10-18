import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {notificationEligibility,portalPrincipal,requirePortalBindingAuthority,verifiedBindingInput,paperworkCursorFor,paperworkCursorFrom} from '../src/workflow/paperwork-policy.js';
import {WorkflowError} from '../src/workflow/policy.js';

const code=(expected:string)=>(error:unknown)=>error instanceof WorkflowError&&error.code===expected;
const auth={isAuthenticated:true,userId:'user_Staff123',sessionId:'sess_Staff123',has:({permission}:{permission:string})=>permission==='org:paperwork:manage',sessionClaims:{fva:[0,-1]}};

test('paperwork principal requires an authenticated account and session, never an email address',()=>{
    assert.deepEqual(portalPrincipal(auth),{subject:'user_Staff123',sessionId:'sess_Staff123'});
    for(const value of [{...auth,isAuthenticated:false},{...auth,userId:'patient@example.test'},{...auth,sessionId:null}])assert.throws(()=>portalPrincipal(value),code('UNAUTHENTICATED'));
});
test('identity binding requires a dedicated permission and recent verified factor without an admin bypass',()=>{
    assert.doesNotThrow(()=>requirePortalBindingAuthority(auth));
    assert.throws(()=>requirePortalBindingAuthority({...auth,orgRole:'org:admin',has:()=>false}),code('FORBIDDEN'));
    for(const fva of [undefined,[-1,-1],[6,-1],['0',0],[Infinity,0]])assert.throws(()=>requirePortalBindingAuthority({...auth,sessionClaims:{fva}} as typeof auth),code('RECENT_AUTHENTICATION_REQUIRED'));
    assert.throws(()=>requirePortalBindingAuthority({...auth,sessionClaims:undefined} as unknown as typeof auth),code('RECENT_AUTHENTICATION_REQUIRED'));
});
test('binding validates the actual account subject and explicit verified email preference',()=>{
    const input={clerkUserId:'user_Patient123',relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic in-person record'};
    assert.equal(verifiedBindingInput(input).paperworkEmailEnabled,false);
    assert.throws(()=>verifiedBindingInput({...input,relationship:'guardian'}),code('REPRESENTATIVE_AUTHORITY_UNAVAILABLE'));
    assert.throws(()=>verifiedBindingInput({...input,clerkUserId:'patient@example.test'}),code('INVALID_PORTAL_SUBJECT'));
    assert.throws(()=>verifiedBindingInput({...input,verifiedEmail:'patient@example.test',paperworkEmailEnabled:true}),code('VERIFIED_EMAIL_REQUIRED'));
    assert.throws(()=>verifiedBindingInput({...input,paperworkEmailEnabled:true}),code('VERIFIED_EMAIL_REQUIRED'));
    assert.equal(verifiedBindingInput({...input,verifiedEmail:'patient@example.test',emailDestinationVerified:true,paperworkEmailEnabled:true}).paperworkEmailEnabled,true);
});
test('notification decisions distinguish absent authority, suppression and provider unavailability',()=>{
    const now=new Date('2026-10-17T12:00:00Z'),grant={expiresAt:'2026-10-18T12:00:00Z',email:'patient@example.test',emailVerifiedAt:now,enabled:true};
    assert.equal(notificationEligibility(null,now).failureCode,'PORTAL_ACCESS_NOT_VERIFIED');
    assert.equal(notificationEligibility({...grant,revokedAt:now},now).failureCode,'PORTAL_ACCESS_NOT_VERIFIED');
    assert.equal(notificationEligibility({...grant,expiresAt:now},now).failureCode,'PORTAL_ACCESS_NOT_VERIFIED');
    assert.equal(notificationEligibility({...grant,expiresAt:'invalid'},now).failureCode,'PORTAL_ACCESS_NOT_VERIFIED');
    assert.equal(notificationEligibility({...grant,enabled:false},now).state,'suppressed');
    assert.equal(notificationEligibility({...grant,emailVerifiedAt:null},now).failureCode,'EMAIL_PERMISSION_UNAVAILABLE');
    assert.deepEqual(notificationEligibility(grant,now),{state:'needs_attention',failureCode:'DELIVERY_PROVIDER_UNAVAILABLE'});
});
test('paperwork cursors preserve PostgreSQL microseconds and reject tampering, another account or expiry',()=>{
    const position={time:'2026-10-17 12:01:02.123456+00',id:randomUUID()},now=1234567890000;
    const cursor=paperworkCursorFor(position,'patient-A',now);
    assert.deepEqual(paperworkCursorFrom(cursor,'patient-A',now),position);
    assert.throws(()=>paperworkCursorFrom(cursor,'patient-B',now),code('INVALID_PAPERWORK_CURSOR'));
    assert.throws(()=>paperworkCursorFrom(cursor.slice(0,-1)+'!', 'patient-A',now),code('INVALID_PAPERWORK_CURSOR'));
    assert.throws(()=>paperworkCursorFrom(cursor,'patient-A',now+24*3600000+1),code('INVALID_PAPERWORK_CURSOR'));
    assert.throws(()=>paperworkCursorFrom(cursor+'.extra','patient-A',now),code('INVALID_PAPERWORK_CURSOR'));
    assert.equal(paperworkCursorFrom(undefined,'patient-A'),undefined);
});
