import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { id, WorkflowError } from '../workflow/policy.js';

const processSecret = randomBytes(32);
const secret = () => process.env.CAREIQ_WORKFLOW_CURSOR_SECRET || processSecret;
export function preferenceContext(subject: string, sessionId: string, grantId: string, now = Date.now()) {
    const value = Buffer.from(JSON.stringify({ grantId, expires: now + 10 * 60000 })).toString('base64url');
    return value + '.' + createHmac('sha256', secret()).update(`portal-choices:${subject}:${sessionId}:${value}`).digest('base64url');
}
export function preferenceGrant(token: unknown, subject: string, sessionId: string, now = Date.now()) {
    try {
        if (typeof token !== 'string' || token.length > 1200) throw new Error();
        const [value, signature, extra] = token.split('.');
        if (!value || !signature || extra) throw new Error();
        const expected = createHmac('sha256', secret()).update(`portal-choices:${subject}:${sessionId}:${value}`).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
        const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(data.expires) || data.expires <= now || data.expires > now + 10 * 60000) throw new Error();
        return id(data.grantId);
    } catch { throw new WorkflowError('COMMUNICATION_CONTEXT_EXPIRED', 409); }
}
