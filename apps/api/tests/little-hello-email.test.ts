import test from 'node:test';
import assert from 'node:assert/strict';
import { littleHelloCatalog } from '../src/notifications/little-hello-copy.js';
import { littleHelloPurposes, renderLittleHelloEmail, renderStaffWorkEmail, type LittleHelloEmailInput } from '../src/notifications/little-hello-email.js';
import { createDeliveryProvider } from '../src/notifications/delivery-provider.js';
import { renderPatientMessage, patientMessageTemplates } from '../src/notifications/patient-delivery-policy.js';

const origin = 'https://careiq.example.test';
const examples: Record<string,string | number> = {first_name:'Alex',practice_name:'Evergreen Medical',inviter_name:'Maya Chen',teammate_name:'Alex Morgan',location_names:'Downtown',new_masked_email:'a•••@example.test',event_time:'Oct 21, 2026 at 9:41 AM PDT',device:'Chrome on macOS',approximate_location:'Los Angeles, California',provider_name:'Google',code:'482916',count:2,expires_at:'Oct 25, 2026 at 5 PM PDT'};
function fixture(purpose: LittleHelloEmailInput['purpose'], locale: 'en' | 'es' = 'en'): LittleHelloEmailInput {
  const template = littleHelloCatalog.find(t => t.id === purpose)!;
  const keys = new Set([...JSON.stringify(template).matchAll(/\{\{([a-z_]+)\}\}/g)].map(m => m[1]!));
  const values = Object.fromEntries(Object.entries(examples).filter(([key]) => keys.has(key)));
  if (template.code) values.code = examples.code!;
  const patient = purpose.startsWith('patient_');
  const role = !patient && !template.audience.includes('patient' as never) ? {kind:(purpose === 'owner_welcome' || purpose === 'owner_join_review' ? 'owner' : 'member') as 'owner' | 'member'} : undefined;
  let path = '/';
  if (purpose === 'patient_secure_request' || purpose === 'patient_secure_reminder') path = '/patient-workflow#token=example-only';
  if (purpose === 'patient_paperwork_ready' || purpose === 'patient_portal_invitation') path = '/patient-paperwork?item=example-only';
  return {purpose,locale,origin,values,practiceRole:role,...(template.cta ? {actionUrl:origin+path} : {})};
}

test('all 27 approved purposes and existing staff updates render in English and Spanish', () => {
  assert.equal(littleHelloPurposes().length,28);
  for (const purpose of littleHelloPurposes()) for (const locale of ['en','es'] as const) {
    const message=renderLittleHelloEmail(fixture(purpose,locale));
    assert.equal(message.templateId,purpose);assert.equal(message.locale,locale);
    assert.ok(message.subject.length>0);assert.ok(message.text.length>100);
    assert.match(message.html,/color-scheme:light only/);assert.match(message.html,/bgcolor="#ffffff"/);
    assert.match(message.html,new RegExp(`<html lang="${locale}"`));
    assert.doesNotMatch(message.html,/\{\{|data:|light-dark\(|prefers-color-scheme|<script|<form|<iframe/i);
    assert.doesNotMatch(message.text,/undefined|\{\{/);
  }
});
test('verification is shared identity copy with optional trusted first-name greeting', () => {
  const generic=renderLittleHelloEmail({purpose:'verify_email',origin,values:{code:'482916'}});
  assert.match(generic.text,/Hello,/);assert.doesNotMatch(generic.text,/practice is|set up your practice|undefined|Hi ,/i);
  const named=renderLittleHelloEmail({purpose:'verify_email',origin,values:{code:'482916',first_name:'Alex'}});
  assert.match(named.text,/Hi Alex,/);
  assert.throws(()=>renderLittleHelloEmail({purpose:'verify_email',origin,values:{code:'482916'},practiceRole:{kind:'owner'}}));
});
test('only exact six-digit verification codes are accepted and recovery notices never accept saved codes', () => {
  for (const code of ['','12345','1234567','abcdef','123 45','123456\r\n']) assert.throws(()=>renderLittleHelloEmail({purpose:'password_reset_code',origin,values:{code}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('recovery_code_used'),values:{code:'482916'}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('password_changed'),values:{password:'secret'}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('recovery_code_used'),values:{recovery_code:'saved-private-code'}}));
});
test('untrusted markup is escaped and control characters cannot enter headers or body fields', () => {
  const message=renderLittleHelloEmail({...fixture('owner_welcome'),values:{practice_name:'<img src=x onerror=alert(1)>'}});
  assert.match(message.html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(message.html,/<img src=x/);
  assert.throws(()=>renderLittleHelloEmail({...fixture('owner_welcome'),values:{practice_name:'Name\r\nBcc: attacker@example.test'}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('owner_welcome'),purpose:'unknown' as any}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('owner_welcome'),locale:'fr' as any}));
});
test('actions stay on the configured HTTPS application origin and patient routes', () => {
  for (const actionUrl of ['javascript:alert(1)','http://careiq.example.test/','https://evil.example.test/','//evil.example.test/','https://user:pass@careiq.example.test/','https://careiq.example.test/\nother']) assert.throws(()=>renderLittleHelloEmail({...fixture('password_changed'),actionUrl}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('patient_secure_request'),actionUrl:origin+'/account'}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('password_changed'),origin:origin+'/path'}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('password_changed'),invitationOrigins:['https://accounts.example.test']}));
  const invitation=renderLittleHelloEmail({...fixture('team_invitation'),actionUrl:'https://accounts.example.test/invite?token=example-only',invitationOrigins:['https://accounts.example.test']});
  assert.match(invitation.html,/https:\/\/accounts.example.test\/invite/);
});
test('practice role details preserve practice and actual expiry while identity mail cannot take role variants', () => {
  const message=renderLittleHelloEmail({...fixture('team_invitation'),practiceRole:{kind:'administrator'}});
  assert.match(message.text,/Practice: Evergreen Medical/);assert.match(message.text,/Invitation expires: Oct 25/);assert.match(message.text,/Invited role: Administrator/);
  const custom=renderLittleHelloEmail({...fixture('team_invitation'),practiceRole:{kind:'configured_staff',configuredLabel:'Care coordinator'}});
  assert.match(custom.text,/Invited role: Care coordinator/);
  assert.throws(()=>renderLittleHelloEmail({...fixture('team_invitation'),practiceRole:{kind:'owner'}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('team_invitation'),practiceRole:{kind:'representative' as any}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('team_invitation'),practiceRole:{kind:'configured_staff'}}));
  const missingExpiry=fixture('team_invitation');delete missingExpiry.values!.expires_at;
  assert.doesNotMatch(renderLittleHelloEmail(missingExpiry).text,/Invitation expires/);
});
test('patient messages reject every identity, clinical and role field; staff accepts only a bounded count', () => {
  for (const key of ['first_name','practice_name','patient_name','diagnosis','answers','attachment','code']) assert.throws(()=>renderLittleHelloEmail({...fixture('patient_secure_request'),values:{[key]:'private'}}));
  assert.throws(()=>renderLittleHelloEmail({...fixture('patient_secure_request'),practiceRole:{kind:'member'}}));
  for (const count of [0,-1,1001,1.5,NaN]) assert.throws(()=>renderStaffWorkEmail('en',count,origin));
  const en=renderStaffWorkEmail('en',1,origin);assert.match(en.text,/a new work update/);assert.doesNotMatch(en.text,/patient name|diagnosis|attachment/i);
  const es=renderStaffWorkEmail('es',2,origin);assert.match(es.text,/Tiene 2 novedades/);
});
test('email images use explicit public HTTPS assets with readable fallbacks and no inline data', () => {
  const plain=renderLittleHelloEmail(fixture('verify_email'));assert.match(plain.html,/>CareIQ<\/span>/);assert.doesNotMatch(plain.html,/<img/);
  const branded=renderLittleHelloEmail({...fixture('verify_email'),assetBaseUrl:origin+'/brand/little-hello/'});
  assert.match(branded.html,/src="https:\/\/careiq.example.test\/brand\/little-hello\/careiq-wordmark.png"/);
  assert.match(branded.html,/alt="CareIQ"/);assert.match(branded.html,/little-hello-companion.png/);assert.doesNotMatch(branded.html,/data:/);
  for(const assetBaseUrl of ['data:image/png,x','http://careiq.example.test/','https://user:pass@careiq.example.test/','https://careiq.example.test/assets']) assert.throws(()=>renderLittleHelloEmail({...fixture('verify_email'),assetBaseUrl}));
});
test('existing patient delivery uses HTML and text; SMS stays plain with its original footer', () => {
  const secure=origin+'/patient-workflow#token=example-only';
  const email=renderPatientMessage('reminder','email',secure,'',{origin});assert.match(email.html!,/A little reminder/);assert.match(email.text,/still open/);assert.match(email.html!,/token=example-only/);
  const sms=renderPatientMessage('reminder','sms',secure,'Reply STOP to opt out.');assert.equal('html' in sms,false);assert.equal(sms.text,'Your secure paperwork request is still open. Please complete it when you can.\n\n'+secure+'\nReply STOP to opt out.');
  assert.throws(()=>renderPatientMessage('reminder','email',secure));
  assert.equal(patientMessageTemplates.find(t=>t.channel==='email')!.version,'little-hello-v1');
});
test('Resend receives HTML beside text without changing its durable idempotency key or adding attachments', async () => {
  const sent: any[]=[];const fetcher=(async(_url:RequestInfo|URL,init?:RequestInit)=>{sent.push({headers:init!.headers,payload:JSON.parse(String(init!.body))});return new Response(JSON.stringify({id:'12345678-abcd-1234-abcd-123456789abc'}));}) as typeof fetch;
  const provider=createDeliveryProvider({CAREIQ_DELIVERY_ENABLED:'true',CAREIQ_RESEND_API_KEY:'synthetic-key',CAREIQ_RESEND_FROM:'CareIQ <hello@example.test>',CAREIQ_RESEND_ACCOUNT:'fixture',CAREIQ_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('synthetic-webhook-key').toString('base64')},fetcher);
  const mail=renderStaffWorkEmail('en',2,origin);const message={channel:'email' as const,destination:'person@example.test',subject:mail.subject,text:mail.text,html:mail.html,externalKey:'staff-alert:example-only'};
  await provider.send(message);await provider.send(message);
  assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].headers['Idempotency-Key'],message.externalKey);assert.equal(sent[0].payload.html,mail.html);assert.equal(sent[0].payload.text,mail.text);assert.equal('attachments' in sent[0].payload,false);
});
