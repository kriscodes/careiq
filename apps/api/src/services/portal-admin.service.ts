import type { TenantContext } from '../middleware/tenant-context.js';
import { concurrency, id, WorkflowError } from '../workflow/policy.js';
import { scoped, row } from '../workflow/transaction.js';
import { paperworkCursorFor, paperworkCursorFrom } from '../workflow/paperwork-policy.js';
import { patientAdultSelfEligible } from '../workflow/patient-eligibility.js';
import { recordWorkflowAudit } from './workflow-audit.js';

/** Sensitive account bindings are read only through the dedicated portal-management route. */
export async function staffPortalGrants(t: TenantContext, patientId: string, requestId: string, cursor?: string) {
    const patientKey = id(patientId), binding = `portal-admin:${t.practiceId}:${t.locationId}:${t.userId}:${patientKey}`;
    const position = paperworkCursorFrom(cursor, binding);
    return scoped(t, async client => {
        const patient = await row(client, 'patients', t, patientKey, false);
        const adultSelfEligible = await patientAdultSelfEligible(client,patientKey);
        const values: unknown[] = [patientKey,t.practiceId,t.locationId];
        if (position) values.push(position.time,position.id);
        const records = (await client.query(`SELECT id,clerk_user_id,relationship,verification_method,verified_at,paperwork_email_enabled,expires_at,revoked_at,revision,created_at,created_at::text AS cursor_time FROM patient_portal_grants WHERE patient_id=$1 AND practice_id=$2 AND location_id=$3 ${position ? 'AND (created_at,id)<($4::timestamptz,$5::uuid)' : ''} ORDER BY created_at DESC,id DESC LIMIT 51`,values)).rows;
        const selected = records.slice(0,50), last = selected.at(-1), hasMore = records.length>50;
        const items = selected.map(record => concurrency({ id:record.id,clerk_user_id:record.clerk_user_id,relationship:record.relationship,verification_method:record.verification_method,verified_at:record.verified_at,paperwork_email_enabled:record.paperwork_email_enabled,expires_at:record.expires_at,revoked_at:record.revoked_at,revision:record.revision,state:record.revoked_at ? 'revoked' : new Date(record.expires_at)<=new Date() ? 'expired' : 'active' }));
        if (patient.archived_at) throw new WorkflowError('PATIENT_ARCHIVED',409);
        await recordWorkflowAudit(client,t,{action:'paperwork.portal.bindings.read',entityType:'patient',entityId:patientKey,requestId,resources:[{resourceType:'patient',resourceId:patientKey,patientId:patientKey},...selected.map(record=>({resourceType:'patient_portal_grant',resourceId:record.id,patientId:patientKey}))],metadata:{count:items.length}});
        return { items, adultSelfEligible, pagination:{limit:50,hasMore,nextCursor:hasMore && last ? paperworkCursorFor({time:last.cursor_time,id:last.id},binding) : null} };
    },requestId);
}
