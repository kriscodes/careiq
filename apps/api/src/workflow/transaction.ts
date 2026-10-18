import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { TenantContext } from '../middleware/tenant-context.js';
import { recordWorkflowAudit, type WorkflowAuditResource } from '../services/workflow-audit.js';
import { fingerprint, requestKey, WorkflowError } from './policy.js';
export type QueryClient = Pick<PoolClient, 'query'>;
export type CommandContext = {
    requestId: string;
    idempotencyKey?: string;
    expectedRevision?: number;
};
export async function scoped<T>(tenant: TenantContext, callback: (client: PoolClient) => Promise<T>, requestId: string = randomUUID(), consistentRead = false): Promise<T> {
    if (!tenant.locationId)
        throw new WorkflowError('LOCATION_CONTEXT_REQUIRED', 409);
    const client = await pool.connect();
    try {
        await client.query(consistentRead ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
        await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.actor_user_id',$2,true),set_config('app.location_id',$3,true),set_config('app.request_id',$4,true)", [tenant.practiceId, tenant.userId, tenant.locationId, requestId]);
        const practice = await client.query("SELECT id FROM practices WHERE id=$1 AND status='active' AND authorization_mode='location' FOR SHARE", [tenant.practiceId]);
        const member = await client.query("SELECT user_id FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 AND membership_id=$3 AND status='active' FOR SHARE", [tenant.practiceId, tenant.userId, tenant.membershipId ?? '']);
        const location = await client.query("SELECT id FROM locations WHERE practice_id=$1 AND id=$2 AND status='active' FOR SHARE", [tenant.practiceId, tenant.locationId]);
        const assigned = await client.query("SELECT location_id FROM location_assignments WHERE practice_id=$1 AND user_id=$2 AND location_id=$3 AND active FOR SHARE", [tenant.practiceId, tenant.userId, tenant.locationId]);
        if (!practice.rowCount || !member.rowCount || !location.rowCount || !assigned.rowCount)
            throw new WorkflowError('LOCATION_ACCESS_DENIED', 403);
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
export async function row(client: QueryClient, table: string, tenant: TenantContext, entityId: string, lock = true, practiceOnly = false) {
    // Table names are selected only from module constants, never HTTP input.
    const result = await client.query(`SELECT * FROM ${table} WHERE id=$1 AND practice_id=$2 ${practiceOnly ? '' : 'AND location_id=$3'} ${lock ? 'FOR UPDATE' : ''}`, practiceOnly ? [entityId, tenant.practiceId] : [entityId, tenant.practiceId, tenant.locationId]);
    if (!result.rows[0])
        throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
    return result.rows[0];
}
export async function command<T extends Record<string, unknown>>(tenant: TenantContext, operation: string, targetId: string, input: unknown, context: CommandContext, execute: (client: PoolClient) => Promise<T>): Promise<T> {
    const key = requestKey(context.idempotencyKey);
    const reasonCode = input && typeof input === 'object' && typeof (input as Record<string, unknown>).reasonCode === 'string' ? String((input as Record<string, unknown>).reasonCode).slice(0, 80) : undefined;
    const requestHash = fingerprint({ practiceId: tenant.practiceId, locationId: tenant.locationId, actor: tenant.userId, operation, targetId, input, expectedRevision: context.expectedRevision });
    return scoped(tenant, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${tenant.practiceId}:${tenant.locationId}:${tenant.userId}:${key}`]);
        const previous = await client.query('SELECT request_hash,response FROM workflow_request_keys WHERE practice_id=$1 AND location_id=$2 AND actor_user_id=$3 AND request_key=$4', [tenant.practiceId, tenant.locationId, tenant.userId, key]);
        if (previous.rows[0]) {
            if (previous.rows[0].request_hash !== requestHash)
                throw new WorkflowError('IDEMPOTENCY_KEY_REUSED', 409);
            await recordWorkflowAudit(client, tenant, { action: operation + '.replay', entityType: 'command', entityId: targetId || undefined, requestId: context.requestId, metadata: { operation } });
            return previous.rows[0].response as T;
        }
        await recordWorkflowAudit(client, tenant, { action: operation + '.accepted', entityType: operation.split('.')[0]!, entityId: targetId || undefined, reasonCode, outcome: 'accepted', requestId: context.requestId, metadata: { operation } });
        const result = await execute(client);
        const prefix = operation.split('.')[0]!;
        const domain: Record<string, [
            string,
            string
        ]> = { patients: ['patients', 'patient'], appointments: ['appointments', 'appointment'], requirements: ['visit_requirements', 'requirement'], documents: operation === 'documents.review' ? ['document_reviews', 'document_review'] : ['documents', 'document'], uploads: ['upload_sessions', 'upload_session'], requests: ['document_requests', 'request'], 'work-items': ['work_items', 'work_item'] };
        if (operation === 'templates.preparation')
            domain.templates = ['prepared_documents', 'prepared_document'];
        const resources: WorkflowAuditResource[] = [];
        if (domain[prefix] && typeof result.id === 'string') {
            const [table, resourceType] = domain[prefix];
            const record = (await client.query(`SELECT * FROM ${table} WHERE id=$1 AND practice_id=$2 AND location_id=$3`, [result.id, tenant.practiceId, tenant.locationId])).rows[0];
            if (record) {
                const patientId = table === 'patients' ? record.id : record.patient_id;
                resources.push({ resourceType, resourceId: record.id, patientId, relationship: 'primary' });
                if (patientId && resourceType !== 'patient')
                    resources.push({ resourceType: 'patient', resourceId: patientId, patientId });
                if (record.appointment_id)
                    resources.push({ resourceType: 'appointment', resourceId: record.appointment_id, patientId });
                const documentId = result.documentId ?? record.document_id;
                if (typeof documentId === 'string')
                    resources.push({ resourceType: 'document', resourceId: documentId, patientId });
                if (typeof result.documentVersionId === 'string')
                    resources.push({ resourceType: 'document_version', resourceId: result.documentVersionId, patientId });
            }
        }
        await recordWorkflowAudit(client, tenant, { action: operation, entityType: operation.split('.')[0]!, entityId: typeof result.id === 'string' ? result.id : targetId || undefined, reasonCode, requestId: context.requestId, resources, metadata: { resultState: result.state ?? null } });
        await client.query('INSERT INTO workflow_request_keys(practice_id,location_id,actor_user_id,request_key,request_hash,operation,target_id,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tenant.practiceId, tenant.locationId, tenant.userId, key, requestHash, operation, targetId, JSON.stringify(Object.fromEntries(Object.entries(result).filter(([name]) => !['localReviewPath', 'upload'].includes(name))))]);
        return result;
    }, context.requestId);
}
