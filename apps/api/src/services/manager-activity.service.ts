import type { TenantContext } from '../middleware/tenant-context.js';
import type { ManagerActivityFilters } from '../workflow/manager-activity-policy.js';
import { insuranceCursorFor, insuranceCursorFrom } from '../workflow/insurance-policy.js';
import { scoped } from '../workflow/transaction.js';
import { recordWorkflowAudit, type WorkflowAuditResource } from './workflow-audit.js';

const label = (actorId: string) => actorId.slice(-8);
/** Uses the protected database projection; raw audit tables are never granted to runtime. */
export async function managerActivity(tenant: TenantContext, filters: ManagerActivityFilters, requestId: string) {
    const { cursor: token, ...selected } = filters;
    const binding = { kind: 'manager_activity', ...selected };
    const cursor = insuranceCursorFrom(token, tenant, binding);
    return scoped(tenant, async client => {
        const context = (await client.query('SELECT time_zone,now() AS as_of FROM locations WHERE practice_id=$1 AND id=$2', [tenant.practiceId, tenant.locationId])).rows[0]!;
        const values = [filters.from, filters.to, filters.actorId ?? null, filters.category];
        const projection = 'FROM audit.manager_activity($1::date,$2::date)';
        const filtered = `${projection} a WHERE ($3::text IS NULL OR a.actor_id=$3) AND ($4::text='all' OR a.category=$4)`;
        const counts = (await client.query(`SELECT count(*) AS total,count(*) FILTER(WHERE a.category='appointments') AS appointments,count(*) FILTER(WHERE a.category='insurance') AS insurance,count(*) FILTER(WHERE a.category='followups') AS followups ${filtered}`, values)).rows[0]!;
        const actors = (await client.query(`SELECT DISTINCT actor_id ${projection} ORDER BY actor_id`, values.slice(0, 2))).rows.map(row => ({ id: row.actor_id as string, label: label(row.actor_id) }));
        const records = (await client.query(`SELECT a.*,to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS seek_time ${filtered} AND ($5::timestamptz IS NULL OR (a.occurred_at,a.id)<($5::timestamptz,$6::uuid)) ORDER BY a.occurred_at DESC,a.id DESC LIMIT $7`, [...values, cursor?.time ?? null, cursor?.id ?? null, filters.limit + 1])).rows;
        const hasMore = records.length > filters.limit, page = records.slice(0, filters.limit), last = page.at(-1);
        const disclosed = new Map<string, WorkflowAuditResource>();
        for (const row of page) {
            if (!row.entity_id) continue;
            const resourceType = row.action.startsWith('appointments.') ? 'appointment' : row.action.startsWith('insurance.') ? 'insurance_case' : row.action.startsWith('work-items.') ? 'work_item' : 'request';
            disclosed.set(resourceType + ':' + row.entity_id, { resourceType, resourceId: row.entity_id, relationship: 'subject' });
        }
        await recordWorkflowAudit(client, tenant, { action: 'manager.activity.read', resources: [...disclosed.values()], entityType: 'manager_activity', requestId, metadata: { count: page.length, resourceCount: Number(counts.total), purpose: 'action_dates:' + filters.from + '/' + filters.to } });
        return {
            from: filters.from, to: filters.to, timeZone: context.time_zone as string, asOf: context.as_of.toISOString(),
            summary: { total: Number(counts.total), appointments: Number(counts.appointments), insurance: Number(counts.insurance), followups: Number(counts.followups) }, actors,
            items: page.map(row => ({ id: row.id as string, occurredAt: row.occurred_at.toISOString(), action: row.action as string, category: row.category as string, entityType: (row.entity_type ?? 'activity') as string, entityId: row.entity_id as string | null, actorId: row.actor_id as string, actorType: row.actor_type as string, actorLabel: label(row.actor_id), outcome: 'succeeded' as const, result: row.result as string | null, source: row.source as string | null })),
            pagination: { hasMore, nextCursor: hasMore && last ? insuranceCursorFor({ time: last.seek_time, id: last.id }, tenant, binding) : null },
        };
    }, requestId, true);
}
