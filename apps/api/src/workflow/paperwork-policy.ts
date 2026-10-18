import { createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { body, id, text, WorkflowError } from './policy.js';
import type { RequestAuthentication } from '../middleware/tenant-context.js';

export function portalPrincipal(auth: RequestAuthentication) {
    if (!auth.isAuthenticated || typeof auth.userId !== 'string' || !/^user_[A-Za-z0-9]+$/.test(auth.userId) || typeof auth.sessionId !== 'string' || !/^sess_[A-Za-z0-9]+$/.test(auth.sessionId)) throw new WorkflowError('UNAUTHENTICATED',401);
    return { subject: auth.userId, sessionId: auth.sessionId };
}
/** Dedicated permission and recent verified factor; administrator role alone is insufficient. */
export function requirePortalBindingAuthority(auth: RequestAuthentication) {
    portalPrincipal(auth);
    if (auth.has?.({permission:'org:paperwork:manage'}) !== true) throw new WorkflowError('FORBIDDEN',403);
    const claims=(auth as RequestAuthentication & {sessionClaims?:{fva?:unknown}}).sessionClaims;
    const ages=claims?.fva;
    if (!Array.isArray(ages) || typeof ages[0] !== 'number' || !Number.isFinite(ages[0]) || ages[0]<0 || ages[0]>5) throw new WorkflowError('RECENT_AUTHENTICATION_REQUIRED',403);
}
export function notificationEligibility(grant: {revokedAt?:unknown;expiresAt?:unknown;email?:unknown;emailVerifiedAt?:unknown;enabled?:unknown}|null, at=new Date()) {
    if (!grant || grant.revokedAt || !grant.expiresAt || !Number.isFinite(new Date(String(grant.expiresAt)).getTime()) || new Date(String(grant.expiresAt))<=at) return {state:'needs_attention',failureCode:'PORTAL_ACCESS_NOT_VERIFIED'};
    if (grant.enabled!==true || typeof grant.email!=='string' || !grant.emailVerifiedAt) return {state:'suppressed',failureCode:'EMAIL_PERMISSION_UNAVAILABLE'};
    return {state:'needs_attention',failureCode:'DELIVERY_PROVIDER_UNAVAILABLE'};
}
export function verifiedBindingInput(input: unknown) {
    const p=body(input,['clerkUserId','relationship','verificationMethod','verificationReference','expiresAt','verifiedEmail','emailDestinationVerified','paperworkEmailEnabled']);
    if (typeof p.clerkUserId!=='string' || !/^user_[A-Za-z0-9]+$/.test(p.clerkUserId)) throw new WorkflowError('INVALID_PORTAL_SUBJECT',422);
    if (p.relationship!=='self' || p.verificationMethod!=='staff_in_person') throw new WorkflowError('REPRESENTATIVE_AUTHORITY_UNAVAILABLE',422);
    if (p.paperworkEmailEnabled!==undefined && typeof p.paperworkEmailEnabled!=='boolean') throw new WorkflowError('INVALID_EMAIL_PREFERENCE',422);
    const email=text(p.verifiedEmail,'verifiedEmail',254,true);
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || p.emailDestinationVerified!==true) || p.paperworkEmailEnabled===true && !email) throw new WorkflowError('VERIFIED_EMAIL_REQUIRED',422);
    return {...p,clerkUserId:p.clerkUserId as string,expiresAt:p.expiresAt,verificationReference:text(p.verificationReference,'verificationReference',500)!,verifiedEmail:email,paperworkEmailEnabled:p.paperworkEmailEnabled===true};
}

const processCursorSecret=randomBytes(32).toString('hex');
const cursorSecret=()=>process.env.CAREIQ_WORKFLOW_CURSOR_SECRET||processCursorSecret;
export function paperworkCursorFor(position:{time:string;id:string},binding:string,now=Date.now()) {
    const payload=Buffer.from(JSON.stringify({v:1,b:binding,t:position.time,id:id(position.id),expires:now+24*3600000})).toString('base64url');
    return payload+'.'+createHmac('sha256',cursorSecret()).update('paperwork:'+payload).digest('base64url');
}
export function paperworkCursorFrom(value:string|undefined,binding:string,now=Date.now()):{time:string;id:string}|undefined {
    if(!value)return;
    try{if(value.length>2000)throw new Error();const [payload,signature,...extra]=value.split('.');if(!payload||!signature||extra.length)throw new Error();const expected=createHmac('sha256',cursorSecret()).update('paperwork:'+payload).digest(),received=Buffer.from(signature,'base64url');if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error();const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(parsed.v!==1||parsed.b!==binding||typeof parsed.expires!=='number'||!Number.isFinite(parsed.expires)||parsed.expires<now||typeof parsed.t!=='string'||parsed.t.length>80||!Number.isFinite(Date.parse(parsed.t)))throw new Error();return{time:parsed.t,id:id(parsed.id)};}catch{throw new WorkflowError('INVALID_PAPERWORK_CURSOR',400);}
}
