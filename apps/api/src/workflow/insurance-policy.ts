import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '../middleware/tenant-context.js';
import { body, fingerprint, id, instant, isoDate, text, WorkflowError } from './policy.js';
export function seekInstant(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) throw new WorkflowError('INVALID_PAGINATION');
    instant(value.replace(/(\.\d{3})\d{3}Z$/, '$1Z'), 'cursor');
    return value;
}
export type InsuranceRange = { from: string; to: string; limit: number; cursor?: string };
export function insuranceRange(raw: Record<string, unknown>): InsuranceRange {
    if (Object.keys(raw).some(key => !['from', 'to', 'limit', 'cursor'].includes(key))) throw new WorkflowError('INVALID_QUERY');
    const from = isoDate(raw.from), to = isoDate(raw.to);
    const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (days < 0 || days > 30) throw new WorkflowError('INVALID_DATE_RANGE', 422);
    const limit = raw.limit === undefined ? 50 : Number(raw.limit);
    if ((raw.limit !== undefined && typeof raw.limit !== 'string') || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new WorkflowError('INVALID_PAGINATION');
    const cursor = cursorToken(raw.cursor);
    return { from, to, limit, ...(cursor ? { cursor } : {}) };
}
export function assignee(value: unknown): string | null { return text(value, 'assigneeUserId', 256, true); }
export function due(value: unknown): string | null { return value === null || value === undefined ? null : instant(value, 'dueAt').toISOString(); }
export function caseInput(raw: unknown) {
    const input = body(raw, ['appointmentId', 'payerName', 'memberId', 'assigneeUserId', 'dueAt']);
    return { appointmentId: id(input.appointmentId, 'appointmentId'), payerName: text(input.payerName, 'payerName', 120)!, memberId: text(input.memberId, 'memberId', 120, true), assigneeUserId: assignee(input.assigneeUserId), dueAt: due(input.dueAt) };
}
const reasonCodes = ['assignment', 'follow_up', 'correction'] as const;
export function followUpInput(raw: unknown) {
    const input = body(raw, ['assigneeUserId', 'dueAt', 'reasonCode']);
    if (!('assigneeUserId' in input) || !('dueAt' in input) || !reasonCodes.includes(input.reasonCode as typeof reasonCodes[number])) throw new WorkflowError('INVALID_FOLLOW_UP', 422);
    return { assigneeUserId: assignee(input.assigneeUserId), dueAt: due(input.dueAt), reasonCode: String(input.reasonCode) };
}
function benefit(value: unknown, field: string, max: number): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new WorkflowError('INVALID_BENEFIT', 422, { field });
    return value;
}
export function evidenceInput(raw: unknown, now = new Date()) {
    const input = body(raw, ['source', 'observedAt', 'reference', 'outcome', 'copayCents', 'deductibleRemainingCents', 'coinsurancePercent', 'reasonCode', 'supersedesEvidenceId']);
    if (!['payer_portal', 'phone', 'document'].includes(String(input.source)) || !['active', 'inactive', 'needs_follow_up'].includes(String(input.outcome)) || !['manual_verification', 'correction'].includes(String(input.reasonCode))) throw new WorkflowError('INVALID_EVIDENCE', 422);
    const observedAt = instant(input.observedAt, 'observedAt');
    if (observedAt.getTime() > now.getTime() + 60000) throw new WorkflowError('FUTURE_OBSERVATION', 422);
    const supersedesEvidenceId = input.supersedesEvidenceId === undefined || input.supersedesEvidenceId === null ? null : id(input.supersedesEvidenceId, 'supersedesEvidenceId');
    if ((input.reasonCode === 'correction') !== Boolean(supersedesEvidenceId)) throw new WorkflowError('CORRECTION_REFERENCE_REQUIRED', 422);
    if (input.outcome !== 'active' && ['copayCents', 'deductibleRemainingCents', 'coinsurancePercent'].some(field => input[field] !== undefined && input[field] !== null)) throw new WorkflowError('BENEFITS_REQUIRE_ACTIVE_COVERAGE', 422);
    return { source: String(input.source), observedAt: observedAt.toISOString(), reference: text(input.reference, 'reference', 200)!, outcome: String(input.outcome), copayCents: benefit(input.copayCents, 'copayCents', 100_000_000), deductibleRemainingCents: benefit(input.deductibleRemainingCents, 'deductibleRemainingCents', 100_000_000), coinsurancePercent: benefit(input.coinsurancePercent, 'coinsurancePercent', 100), reasonCode: String(input.reasonCode), supersedesEvidenceId };
}

export function coverageInput(raw: unknown) {
    const input = body(raw, ['payerName', 'memberId', 'reasonCode']);
    if (input.reasonCode !== 'correction') throw new WorkflowError('CORRECTION_REASON_REQUIRED', 422);
    return { payerName: text(input.payerName, 'payerName', 120)!, memberId: input.memberId === undefined ? undefined : text(input.memberId, 'memberId', 120, true), reasonCode: 'correction' };
}

const processCursorSecret = randomBytes(32).toString('hex');
const cursorSecret = () => process.env.CAREIQ_WORKFLOW_CURSOR_SECRET || processCursorSecret;
export function cursorToken(value: unknown): string | undefined {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new WorkflowError('INVALID_CURSOR');
    return value;
}
function cursorBinding(tenant: TenantContext, query: Record<string, unknown>) {
    return fingerprint({ practiceId: tenant.practiceId, locationId: tenant.locationId, actor: tenant.userId, membership: tenant.membershipId ?? null, ...query });
}
export function insuranceCursorFor(position: { time: string; id: string }, tenant: TenantContext, query: Record<string, unknown>) {
    const payload = Buffer.from(JSON.stringify({ v: 1, binding: cursorBinding(tenant, query), time: seekInstant(position.time), id: id(position.id), expires: Date.now() + 24 * 3600000 })).toString('base64url');
    return payload + '.' + createHmac('sha256', cursorSecret()).update(payload).digest('base64url');
}
export function insuranceCursorFrom(token: string | undefined, tenant: TenantContext, query: Record<string, unknown>): { time: string; id: string } | undefined {
    if (!token) return;
    try {
        cursorToken(token); const [payload, signature] = token.split('.');
        const expected = createHmac('sha256', cursorSecret()).update(payload!).digest(), received = Buffer.from(signature!, 'base64url');
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
        const value = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
        if (value.v !== 1 || value.binding !== cursorBinding(tenant, query) || !Number.isFinite(value.expires) || value.expires < Date.now()) throw new Error();
        return { time: seekInstant(value.time), id: id(value.id) };
    } catch { throw new WorkflowError('INVALID_CURSOR'); }
}
