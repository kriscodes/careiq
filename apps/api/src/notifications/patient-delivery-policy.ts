import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { WorkflowError } from '../workflow/policy.js';
import type { DeliveryChannel, ProviderResult } from './delivery-provider.js';
import { renderLittleHelloEmail } from './little-hello-email.js';
import { littleHelloCatalog } from './little-hello-copy.js';
export type DeliveryPurpose = 'initial' | 'reminder' | 'reissue' | 'paperwork_ready' | 'paperwork_resend';
export const communicationPurpose = (purpose: DeliveryPurpose) => purpose === 'reminder' ? 'reminder' : purpose.startsWith('paperwork_') ? 'paperwork' : 'request';
export function normalizeDestination(channel: DeliveryChannel, value: unknown): string {
    if (typeof value !== 'string') throw new WorkflowError('INVALID_DESTINATION', 422);
    const address = value.trim();
    if (channel === 'email' && address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return address.toLowerCase();
    if (channel === 'sms' && /^\+[1-9]\d{7,14}$/.test(address)) return address;
    throw new WorkflowError('INVALID_DESTINATION', 422);
}
export function maskedDestination(channel: DeliveryChannel, value: string): string {
    if (channel === 'sms') return '••• ••• ' + value.slice(-4);
    const [local, domain] = value.split('@'); return local!.slice(0, 1) + '•••@' + domain;
}
function key(name: string, env: NodeJS.ProcessEnv = process.env) { const value = env[name]; if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new WorkflowError('DELIVERY_SECURITY_NOT_CONFIGURED', 503); return Buffer.from(value, 'hex'); }
export function destinationFingerprint(channel: DeliveryChannel, value: string, env: NodeJS.ProcessEnv = process.env) { return createHmac('sha256', key('CAREIQ_DELIVERY_FINGERPRINT_KEY', env)).update(channel + ':' + normalizeDestination(channel, value)).digest('hex'); }
export function sealRequestLink(link: string, intentId: string, env: NodeJS.ProcessEnv = process.env) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key('CAREIQ_DELIVERY_PAYLOAD_KEY', env), iv); cipher.setAAD(Buffer.from(intentId)); const ciphertext = Buffer.concat([cipher.update(link, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64url')).join('.'); }
export function openRequestLink(sealed: string, intentId: string, env: NodeJS.ProcessEnv = process.env) { const [iv, tag, ciphertext] = sealed.split('.').map(part => Buffer.from(part, 'base64url')); if (!iv || !tag || !ciphertext) throw new WorkflowError('DELIVERY_PAYLOAD_UNAVAILABLE', 503); const decipher = createDecipheriv('aes-256-gcm', key('CAREIQ_DELIVERY_PAYLOAD_KEY', env), iv); decipher.setAAD(Buffer.from(intentId)); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'); }
export function confirmedTimeZone(value: unknown): string | null { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.length > 100) throw new WorkflowError('INVALID_TIME_ZONE', 422); try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { throw new WorkflowError('INVALID_TIME_ZONE', 422); } }
export function withinDeliveryWindow(at: Date, timeZone: string, start = 9, end = 18) { const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at)); return hour >= start && hour < end; }
/** Search real instants across DST gaps/folds; a durable logical occurrence is inserted once. */
export function nextDeliveryWindow(at: Date, timeZone: string, start = 9, end = 18): Date { for (let minutes = 0; minutes <= 48 * 60; minutes++) { const candidate = new Date(at.getTime() + minutes * 60000); if (withinDeliveryWindow(candidate, timeZone, start, end)) return candidate; } throw new WorkflowError('DELIVERY_WINDOW_UNAVAILABLE', 409); }
const emailPurpose = (purpose: DeliveryPurpose) => purpose.startsWith('paperwork_') ? 'patient_paperwork_ready' : purpose === 'reminder' ? 'patient_secure_reminder' : 'patient_secure_request';
export const patientMessageTemplates = (['initial', 'reminder', 'paperwork_ready'] as const).flatMap(purpose => (['email', 'sms'] as const).map(channel => {
    const branded = littleHelloCatalog.find(t => t.id === emailPurpose(purpose))!;
    return { purpose, channel, locale: 'en', version: channel === 'email' ? 'little-hello-v1' : 'en-v1', subject: branded.subject, body: channel === 'email' ? branded.body.join(' ') : purpose === 'paperwork_ready' ? 'Sign in to view or download your completed copy.' : purpose === 'reminder' ? 'Your secure paperwork request is still open. Please complete it when you can.' : 'Please open your secure request to complete your paperwork.' };
}));
export function renderPatientMessage(purpose: DeliveryPurpose, channel: DeliveryChannel, url: string, footer = '', email?: { origin: string; assetBaseUrl?: string }) {
    if (!['initial','reminder','reissue','paperwork_ready','paperwork_resend'].includes(purpose) || !['email','sms'].includes(channel)) throw new WorkflowError('INVALID_DELIVERY_PURPOSE',422);
    if (channel === 'email') {
        if (!email) throw new WorkflowError('DELIVERY_ORIGIN_NOT_CONFIGURED',503);
        const message = renderLittleHelloEmail({purpose:emailPurpose(purpose),origin:email.origin,actionUrl:url,assetBaseUrl:email.assetBaseUrl});
        return {subject:message.subject,text:message.text,html:message.html};
    }
    const template = patientMessageTemplates.find(t => t.purpose === (purpose.startsWith('paperwork_') ? 'paperwork_ready' : purpose === 'reminder' ? 'reminder' : 'initial') && t.channel === 'sms')!;
    return {subject:template.subject,text:template.body+'\n\n'+url+'\n'+footer};
}
export function publicPatientUrl(path: string, env: NodeJS.ProcessEnv = process.env) { let base: URL; try { base = new URL(env.CAREIQ_DELIVERY_PUBLIC_ORIGIN ?? ''); } catch { throw new WorkflowError('DELIVERY_ORIGIN_NOT_CONFIGURED', 503); } if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !path.startsWith('/') || path.startsWith('//')) throw new WorkflowError('DELIVERY_ORIGIN_NOT_CONFIGURED', 503); return new URL(path, base).toString(); }
export function deliverySecurityReady(env: NodeJS.ProcessEnv = process.env) { try { key('CAREIQ_DELIVERY_FINGERPRINT_KEY', env); key('CAREIQ_DELIVERY_PAYLOAD_KEY', env); publicPatientUrl('/patient-workflow', env); return true; } catch { return false; } }

/** Provider facts can arrive out of order; an unavailable lookup cannot undo acceptance. */
export function projectDeliveryState(current:string,failureCode:string|null,incoming:ProviderResult['state']):string {
    if((current==='delivered'||current==='failed')&&incoming==='accepted')return current;
    if((current==='accepted'||current==='delivered')&&(incoming==='unknown'||incoming==='retry'))return current;
    if(current==='failed'&&['PROVIDER_BOUNCE','PROVIDER_COMPLAINT','SMS_OPT_OUT'].includes(failureCode??'')&&incoming==='delivered')return current;
    return incoming==='retry'?'retry_waiting':incoming;
}
