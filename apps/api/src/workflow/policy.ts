import { createHash } from 'node:crypto';
export class WorkflowError extends Error {
    constructor(public code: string, public status = 400, public details?: Record<string, unknown>) { super(code); }
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function id(value: unknown, name = 'id'): string {
    if (typeof value !== 'string' || !uuidPattern.test(value))
        throw new WorkflowError('INVALID_ID', 400, { field: name });
    return value.toLowerCase();
}
export function text(value: unknown, name: string, max = 200, optional = false): string | null {
    if (optional && (value === undefined || value === null || value === ''))
        return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        throw new WorkflowError('INVALID_FIELD', 422, { field: name });
    return value.trim();
}
export function body(value: unknown, allowed: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new WorkflowError('INVALID_BODY');
    const result = value as Record<string, unknown>;
    if (Object.keys(result).some(key => !allowed.includes(key)))
        throw new WorkflowError('UNKNOWN_FIELD');
    return result;
}
export function instant(value: unknown, name: string): Date {
    const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
    if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59 || !Number.isFinite(Date.parse(value as string)))
        throw new WorkflowError('INVALID_TIMESTAMP', 422, { field: name });
    isoDate(match[1]);
    return new Date(value as string);
}
export function revision(value: unknown): number {
    const match = typeof value === 'string' ? /^"([1-9]\d*)"$/.exec(value) : null;
    if (!match)
        throw new WorkflowError('PRECONDITION_REQUIRED', 428);
    const n = Number(match[1]);
    if (!Number.isSafeInteger(n))
        throw new WorkflowError('INVALID_PRECONDITION');
    return n;
}
export function checkRevision(row: {
    revision?: unknown;
}, expected: number | undefined) {
    if (!expected)
        throw new WorkflowError('PRECONDITION_REQUIRED', 428);
    if (Number(row.revision) !== expected)
        throw new WorkflowError('REVISION_CONFLICT', 412, { currentRevision: Number(row.revision) });
}
export function requestKey(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new WorkflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    return value.toLowerCase();
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)]));
    return value;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function camel(value: unknown): any {
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map(camel);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), camel(val)]));
    return value;
}
export function concurrency<T extends Record<string, any>>(row: T) {
    const revision = Number(row.revision ?? 1);
    return { ...camel(row), revision, concurrency: { revision, ifMatch: `"${revision}"` } };
}
export const transitions: Record<string, string[]> = {
    scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'], confirmed: ['checked_in', 'cancelled', 'no_show'], checked_in: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [], no_show: [],
};
export function assertTransition(current: string, next: unknown) {
    if (typeof next !== 'string' || !transitions[current]?.includes(next))
        throw new WorkflowError('INVALID_STATUS_TRANSITION', 409);
}
export type ProgressRequirement = {
    required: boolean;
    lifecycleState: string;
    progressState: string;
};
export function readiness(requirements: ProgressRequirement[]) {
    const required = requirements.filter(r => r.required && r.lifecycleState !== 'retired');
    const satisfiedCount = required.filter(r => r.progressState === 'satisfied').length;
    const waivedCount = required.filter(r => r.lifecycleState === 'waived').length;
    const needsReviewCount = required.filter(r => r.progressState === 'needs_review').length;
    return { status: !required.length ? 'not_required' : satisfiedCount + waivedCount === required.length ? 'ready' : 'not_ready', requiredCount: required.length, satisfiedCount, waivedCount, needsReviewCount, missingCount: required.length - satisfiedCount - waivedCount - needsReviewCount };
}
export function isoDate(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
        throw new WorkflowError('INVALID_DATE', 422);
    return value;
}
export function validateFields(value: unknown) {
    if (!Array.isArray(value) || value.length > 100)
        throw new WorkflowError('INVALID_FIELD_SCHEMA', 422);
    const keys = new Set<string>();
    return value.map(raw => {
        const f = body(raw, ['key', 'label', 'type', 'required', 'page', 'x', 'y', 'width', 'height', 'options']);
        const key = text(f.key, 'key', 64)!;
        if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key))
            throw new WorkflowError('INVALID_FIELD_SCHEMA', 422);
        keys.add(key);
        if (!['text', 'date', 'checkbox', 'typed_signature', 'textarea', 'select'].includes(String(f.type)))
            throw new WorkflowError('INVALID_FIELD_SCHEMA', 422);
        if (f.options !== undefined && (!Array.isArray(f.options) || f.options.length > 50 || f.options.some(o => typeof o !== 'string' || o.length > 120)))
            throw new WorkflowError('INVALID_FIELD_SCHEMA', 422);
        for (const coordinate of ['x', 'y', 'width', 'height'])
            if (f[coordinate] !== undefined && (typeof f[coordinate] !== 'number' || Number(f[coordinate]) < 0 || Number(f[coordinate]) > 1))
                throw new WorkflowError('INVALID_FIELD_SCHEMA', 422);
        return { ...f, key, label: text(f.label ?? key, 'label', 120), required: f.required === true };
    });
}
