import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { TenantContext } from '../middleware/tenant-context.js';

type QueryClient = Pick<PoolClient, 'query'>;
export type WorkflowAuditResource = { resourceType: string; resourceId: string; relationship?: 'primary'|'affected'|'subject'|'evidence'; patientId?: string };
export type WorkflowAuditChange = { resourceType: string; resourceId: string; fieldPath: string; captureMode?: 'value'|'masked'|'changed_only'|'protected_reference'; before?: unknown; after?: unknown; protectedReference?: string };
export type WorkflowAuditEvent = {
  action: string; entityType: string; entityId?: string;
  outcome?: 'accepted'|'succeeded'|'denied'|'rejected'|'failed'|'unknown'; reasonCode?: string;
  requestId?: string; operationId?: string; workflowId?: string; causationEventId?: string;
  actorType?: 'user'|'patient_session'|'service'|'background_job'|'integration'|'administrator'|'migration'|'anonymous';
  initiatingActorType?: string; initiatingActorId?: string; executorId?: string; channel?: string;
  authorization?: Record<string,unknown>; metadata?: Record<string,unknown>;
  resources?: WorkflowAuditResource[]; changes?: WorkflowAuditChange[];
};

/** Appends intent and classified changes within the caller's business transaction. */
export async function recordWorkflowAudit(client: QueryClient, tenant: Pick<TenantContext,'practiceId'|'locationId'|'userId'|'membershipId'>, event: WorkflowAuditEvent): Promise<string> {
  const { resources = [], changes = [], ...payload } = event;
  if (!event.action || event.action.length > 96) throw new Error('INVALID_AUDIT_ACTION');
  // Scope is resolved by the writer from transaction settings; never from event JSON.
  const result = await client.query<{ id: string }>('SELECT audit.record_event($1::jsonb,$2::jsonb,$3::jsonb) AS id', [
    JSON.stringify({ ...payload, authorization: { policyVersion: 'location-v1', membershipId: tenant.membershipId ?? null, ...payload.authorization } }),
    JSON.stringify(resources), JSON.stringify(changes),
  ]);
  return result.rows[0]!.id;
}

/** Call after rollback. A new connection makes denied/failed evidence survive a failed command. */
export async function recordWorkflowFailure(tenant: Pick<TenantContext,'practiceId'|'locationId'|'userId'|'membershipId'> | null, event: WorkflowAuditEvent): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [tenant?.practiceId ?? '',tenant?.locationId ?? '',tenant?.userId ?? '']);
    // An unverified target is a claimed entity, never a trusted patient resource relation.
    const id = await recordWorkflowAudit(client,tenant ?? {practiceId:'',userId:''},{...event,actorType:tenant ? (event.actorType ?? 'user') : 'anonymous',outcome:event.outcome ?? 'failed',resources:[],changes:[]});
    await client.query('COMMIT'); return id;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export type WorkflowActivityOptions = { patientId?: string; appointmentId?: string; documentId?: string; limit?: number; beforeTime?: string; beforeId?: string; requestId?: string };
/** Only safe fields are returned by the protected projection. The runtime has no raw audit SELECT. */
export async function listWorkflowActivity(client: QueryClient, tenant: Pick<TenantContext,'practiceId'|'locationId'|'userId'|'membershipId'>, options: WorkflowActivityOptions = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit<1 || limit>100 || (!!options.beforeTime !== !!options.beforeId)) throw new Error('INVALID_ACTIVITY_PAGINATION');
  await recordWorkflowAudit(client,tenant,{ action:'activity.access_authorized', entityType:'activity', requestId:options.requestId, metadata:{count:limit} });
  const result = await client.query('SELECT *,occurred_at::text AS seek_time FROM audit.activity($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::timestamptz,$6::uuid)', [options.patientId ?? null,options.appointmentId ?? null,options.documentId ?? null,limit+1,options.beforeTime ?? null,options.beforeId ?? null]);
  const items = result.rows.slice(0,limit).map(row=>({id:row.id,occurredAt:row.occurred_at,action:row.action,entityType:row.entity_type,entityId:row.entity_id,outcome:row.outcome,actorType:row.actor_type,actorId:row.actor_id}));
  const last = result.rows.length>limit ? items.at(-1) : undefined;
  return { items, hasMore:result.rows.length>limit, nextCursor:last ? {beforeTime:result.rows[limit-1]!.seek_time,beforeId:last.id} : null };
}

/** Unknown or invalid patient links and unauthenticated failures have no trusted tenant. */
export async function recordAnonymousWorkflowFailure(event: WorkflowAuditEvent): Promise<string> {
  return recordWorkflowFailure(null,{...event,actorType:'anonymous',outcome:event.outcome ?? 'denied'});
}
