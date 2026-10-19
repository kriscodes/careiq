import { preferenceContext, preferenceGrant } from '../notifications/portal-preference-policy.js';
import { pool } from '../db/client.js';
import { body, fingerprint, requestKey, WorkflowError } from '../workflow/policy.js';

type Profile = { grantId?: string; revision: number; practiceName: string; locationName: string; endpoints: unknown[]; contextToken?: string };
export async function portalCommunicationPreferences(subject: string, sessionId: string, change?: { input: unknown; revision: number; key: string }) {
    const p = change ? body(change.input, ['contextToken', 'choices']) : null;
    const grant = p ? preferenceGrant(p.contextToken, subject, sessionId) : null;
    if (p && (!Array.isArray(p.choices) || p.choices.length > 60)) throw new WorkflowError('INVALID_COMMUNICATION_CHOICES', 422);
    const key = change ? requestKey(change.key) : null;
    if (key && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new WorkflowError('INVALID_IDEMPOTENCY_KEY', 422);
    const hash = change ? fingerprint({ subject, sessionId, grant, choices: p!.choices, revision: change.revision }) : null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.portal_subject',$1,true),set_config('app.portal_session',$2,true)", [subject, sessionId]);
        const rows = (await client.query('SELECT careiq_portal_communication_choices($1,$2,$3,$4,$5,$6,$7) AS result', [grant, p ? JSON.stringify(p.choices) : null, change?.revision ?? null, process.env.CAREIQ_RESEND_ACCOUNT ?? '', process.env.CAREIQ_TWILIO_ACCOUNT_SID ?? '', key, hash])).rows[0]?.result as Profile[];
        await client.query('COMMIT');
        return { profiles: (rows ?? []).map(({ grantId, ...profile }) => ({ ...profile, contextToken: preferenceContext(subject, sessionId, grantId!) })) };
    } catch (error) {
        await client.query('ROLLBACK');
        const sql = error as { code?: string; message?: string };
        if (sql.code === '42501') throw new WorkflowError('COMMUNICATION_PROFILE_UNAVAILABLE', 404);
        if (sql.code === '40001') throw new WorkflowError('REVISION_CONFLICT', 412);
        if (sql.code === '23514' && ['PROVIDER_OPTOUT_ACTIVE', 'PAPERWORK_PERMISSION_UNAVAILABLE', 'IDEMPOTENCY_KEY_REUSED'].includes(sql.message ?? '')) throw new WorkflowError(sql.message!, 409);
        if (['22023', '22P02'].includes(sql.code ?? '')) throw new WorkflowError('INVALID_COMMUNICATION_CHOICES', 422);
        throw error;
    } finally { client.release(); }
}
