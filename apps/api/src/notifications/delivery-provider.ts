import { createHmac, timingSafeEqual } from 'node:crypto';

export type DeliveryChannel = 'email' | 'sms';
export type DeliveryMessage = { channel: DeliveryChannel; destination: string; subject?: string; text: string; externalKey: string };
export type ProviderResult = { state: 'accepted' | 'delivered' | 'retry' | 'failed' | 'unknown'; providerMessageId?: string; code?: string; retryAfterSeconds?: number };
export type DeliveryProvider = { enabled: boolean; ready(channel: DeliveryChannel): boolean; account(channel: DeliveryChannel): string; provider(channel: DeliveryChannel): string; send(message: DeliveryMessage): Promise<ProviderResult>; reconcile(externalKey: string, providerMessageId?: string, channel?: DeliveryChannel): Promise<ProviderResult> };
type Environment = Record<string, string | undefined>;
function https(value: string | undefined) { try { const u = new URL(value ?? ''); return u.protocol === 'https:' && !u.username && !u.password && !u.hash ? u.toString() : ''; } catch { return ''; } }
const same = (actual: string, expected: string) => { const a = Buffer.from(actual), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); };
export function createDeliveryProvider(env: Environment = process.env, fetcher: typeof fetch = fetch): DeliveryProvider {
    const enabled = env.CAREIQ_DELIVERY_ENABLED === 'true';
    const emailReady = !!(env.CAREIQ_RESEND_API_KEY && env.CAREIQ_RESEND_FROM && env.CAREIQ_RESEND_ACCOUNT && env.CAREIQ_RESEND_WEBHOOK_SECRET?.startsWith('whsec_') && Buffer.from(env.CAREIQ_RESEND_WEBHOOK_SECRET.slice(6),'base64').length>=16);
    const smsReady = !!(/^AC[0-9a-fA-F]{32}$/.test(env.CAREIQ_TWILIO_ACCOUNT_SID ?? '') && env.CAREIQ_TWILIO_AUTH_TOKEN && /^\+[1-9]\d{7,14}$/.test(env.CAREIQ_TWILIO_FROM ?? '') && https(env.CAREIQ_TWILIO_CALLBACK_URL) && env.CAREIQ_SMS_FOOTER);
    const ready = (channel: DeliveryChannel) => enabled && (channel === 'email' ? emailReady : smsReady);
    const account = (channel: DeliveryChannel) => channel === 'email' ? env.CAREIQ_RESEND_ACCOUNT ?? '' : env.CAREIQ_TWILIO_ACCOUNT_SID ?? '';
    const provider = (channel: DeliveryChannel) => channel === 'email' ? 'resend' : 'twilio';
    async function call(channel: DeliveryChannel, url: string, init: RequestInit, creating: boolean): Promise<ProviderResult> {
        try {
            const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
            // A timeout/5xx can occur after acceptance. Never turn it into a blind retry.
            if (response.status === 429 && creating) return { state: 'retry', code: 'PROVIDER_RATE_LIMITED', retryAfterSeconds: Math.min(3600, Math.max(30, Number(response.headers.get('retry-after')) || 60)) };
            if (!response.ok) {
                if(channel==='sms'&&creating&&response.status===400){let safeCode:number|undefined;try{const raw=await response.text();if(raw.length<=65536){const parsed=JSON.parse(raw);safeCode=Number(parsed.code);}}catch{}if(safeCode===21610)return{state:'failed',code:'SMS_OPT_OUT'};if(safeCode===21211)return{state:'failed',code:'INVALID_DESTINATION'};}
                return { state: response.status >= 500 || !creating ? 'unknown' : 'failed', code: response.status === 401 || response.status === 403 ? 'PROVIDER_AUTHENTICATION_FAILED' : response.status === 409 ? 'PROVIDER_CONFLICT' : 'PROVIDER_REJECTED' };
            }
            const raw = await response.text();
            if (raw.length > 65536) return { state: 'unknown', code: 'PROVIDER_RESPONSE_INVALID' };
            const data = JSON.parse(raw) as Record<string, unknown>;
            const providerMessageId = channel === 'email' ? data.id : data.sid;
            if (typeof providerMessageId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(providerMessageId)) return { state: 'unknown', code: 'PROVIDER_RESPONSE_INVALID' };
            const status = String(channel === 'email' ? data.last_event ?? 'sent' : data.status);
            const state = status === 'delivered' ? 'delivered' : ['bounced', 'complained', 'failed', 'undelivered', 'suppressed'].includes(status) ? 'failed' : 'accepted';
            return { state, providerMessageId, ...(state === 'failed' ? { code: status === 'complained' ? 'PROVIDER_COMPLAINT' : status === 'bounced' ? 'PROVIDER_BOUNCE' : 'PROVIDER_DELIVERY_FAILED' } : {}) };
        } catch { return { state: 'unknown', code: 'PROVIDER_RESULT_UNKNOWN' }; }
    }
    return { enabled, ready, account, provider,
        async send(message) {
            if (!ready(message.channel)) return { state: 'failed', code: 'DELIVERY_PROVIDER_UNAVAILABLE' };
            if (!/^[A-Za-z0-9:_-]{8,200}$/.test(message.externalKey)) return { state: 'failed', code: 'INVALID_PROVIDER_KEY' };
            if (message.channel === 'email') return call('email', 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.CAREIQ_RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.externalKey }, body: JSON.stringify({ from: env.CAREIQ_RESEND_FROM, to: [message.destination], subject: message.subject, text: message.text, ...(/^patient-delivery:[0-9a-f-]{36}$/.test(message.externalKey)?{tags:[{name:"careiq_intent",value:message.externalKey.slice(17)},{name:"careiq_audience",value:"patient"}]}:{tags:[{name:"careiq_audience",value:"staff"}]}) }) }, true);
            const callback = new URL(env.CAREIQ_TWILIO_CALLBACK_URL!); callback.searchParams.set('intent', message.externalKey.replace(/^patient-delivery:/, ''));
            return call('sms', `https://api.twilio.com/2010-04-01/Accounts/${account('sms')}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${account('sms')}:${env.CAREIQ_TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: message.destination, From: env.CAREIQ_TWILIO_FROM!, Body: message.text, StatusCallback: callback.toString(), ValidityPeriod: '900' }).toString() }, true);
        },
        async reconcile(_externalKey, providerMessageId, channel = 'email') {
            if (!ready(channel) || !providerMessageId || !/^[A-Za-z0-9-]{8,100}$/.test(providerMessageId)) return { state: 'unknown', code: 'PROVIDER_REFERENCE_REQUIRED' };
            return channel === 'email' ? call('email', `https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, { headers: { Authorization: `Bearer ${env.CAREIQ_RESEND_API_KEY}` } }, false) : call('sms', `https://api.twilio.com/2010-04-01/Accounts/${account('sms')}/Messages/${encodeURIComponent(providerMessageId)}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${account('sms')}:${env.CAREIQ_TWILIO_AUTH_TOKEN}`).toString('base64')}` } }, false);
        }
    };
}
/** Resend uses Svix's exact raw-body signing contract and a five minute replay bound. */
export function verifyResendSignature(raw: Buffer, headers: Record<string, string | undefined>, secrets: string[], nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    const eventId = headers['svix-id'] ?? '', timestamp = headers['svix-timestamp'] ?? '', signatures = headers['svix-signature'] ?? '';
    if (!eventId || !/^\d{10,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
    return secrets.slice(0, 2).some(secret => {
        if (!secret.startsWith('whsec_') || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret.slice(6)) || Buffer.from(secret.slice(6), 'base64').length<16) return false;
        const digest = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${eventId}.${timestamp}.`).update(raw).digest('base64');
        return signatures.split(' ').some(signature => signature.startsWith('v1,') && same(signature.slice(3), digest));
    });
}
/** Twilio signs its configured public URL plus every received form field. It has no native timestamp. */
export function verifyTwilioSignature(raw: Buffer, signature: string, publicUrl: string, authTokens: string[]): Record<string, string> | null {
    if (!https(publicUrl) || raw.length > 65536) return null;
    const params = new URLSearchParams(raw.toString('utf8')), fields: Record<string, string> = Object.create(null);
    for (const [key, value] of params) { if (key in fields) return null; fields[key] = value; }
    const data = publicUrl + Object.keys(fields).sort().map(key => key + fields[key]).join('');
    return authTokens.slice(0, 2).filter(Boolean).some(token => same(signature, createHmac('sha1', token).update(data).digest('base64'))) ? fields : null;
}
