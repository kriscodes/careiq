import { insuranceRange, type InsuranceRange } from './insurance-policy.js';
import { text, WorkflowError } from './policy.js';

export type ManagerActivityCategory = 'all' | 'appointments' | 'insurance' | 'followups';
export type ManagerActivityFilters = InsuranceRange & { actorId?: string; category: ManagerActivityCategory };
export function managerActivityFilters(raw: Record<string, unknown>): ManagerActivityFilters {
    if (Object.keys(raw).some(key => !['from', 'to', 'limit', 'cursor', 'actorId', 'category'].includes(key))) throw new WorkflowError('INVALID_QUERY');
    const { actorId, category = 'all', ...range } = raw;
    if (typeof category !== 'string' || !['all', 'appointments', 'insurance', 'followups'].includes(category)) throw new WorkflowError('INVALID_ACTIVITY_CATEGORY', 422);
    const actor = actorId === undefined ? undefined : text(actorId, 'actorId', 256)!;
    return { ...insuranceRange(range), category: category as ManagerActivityCategory, ...(actor ? { actorId: actor } : {}) };
}
