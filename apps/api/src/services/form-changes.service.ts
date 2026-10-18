import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '../middleware/tenant-context.js';
import { body, checkRevision, concurrency, fingerprint, id, isoDate, text, WorkflowError } from '../workflow/policy.js';
import { command, row, scoped, type CommandContext } from '../workflow/transaction.js';
import { recordWorkflowAudit } from './workflow-audit.js';
import { insert, update } from './workflow.service.js';
/** A patient-reported source proposes a review; it never silently writes a chart fact. */
export async function decideFormChange(t: TenantContext, target: string, input: unknown, context: CommandContext) {
    return command(t, 'form-changes.decisions', target, input, context, async (client) => {
        const p = body(input, ['decision', 'reasonCode', 'expectedPatientRevision']), candidate = await row(client, 'form_change_candidates', t, id(target));
        checkRevision(candidate, context.expectedRevision);
        if (candidate.state !== 'pending')
            throw new WorkflowError('FORM_CHANGE_ALREADY_DECIDED', 409);
        if (!['accepted', 'rejected'].includes(String(p.decision)))
            throw new WorkflowError('INVALID_REVIEW_DECISION', 422);
        const binding = (await client.query('SELECT * FROM template_field_bindings WHERE id=$1 AND practice_id=$2', [candidate.binding_id, t.practiceId])).rows[0];
        if (!binding)
            throw new WorkflowError('INVALID_FIELD_BINDING', 422);
        const patient = await row(client, 'patients', t, candidate.patient_id);
        if (patient.archived_at)
            throw new WorkflowError('PATIENT_ARCHIVED', 409);
        const reasonCode = text(p.reasonCode, 'reasonCode', 80)!;
        let destinationRevision: number | null = null;
        if (p.decision === 'accepted') {
            if (candidate.request_id) {
                const sourceRequest = await row(client, 'document_requests', t, candidate.request_id);
                if (sourceRequest.state !== 'completed')
                    throw new WorkflowError('FORM_SUBMISSION_NOT_COMPLETED', 409);
                const standing = (await client.query('SELECT release_state FROM paperwork_library_items WHERE request_id=$1 AND patient_id=$2 AND practice_id=$3 AND location_id=$4', [sourceRequest.id, patient.id, t.practiceId, t.locationId])).rows[0];
                if (!standing || standing.release_state !== 'released')
                    throw new WorkflowError('FORM_SUBMISSION_RESTRICTED', 409);
            }
            checkRevision(patient, Number(p.expectedPatientRevision));
            const columns: Record<string, string> = { 'patient.preferredName': 'preferred_name', 'patient.email': 'email', 'patient.phone': 'phone', 'patient.dateOfBirth': 'date_of_birth' }, column = columns[binding.destination];
            if (!column)
                throw new WorkflowError('INVALID_FIELD_BINDING', 422);
            const proposed = candidate.proposed_value;
            let value: string | null;
            if (binding.destination === 'patient.dateOfBirth')
                value = proposed === null ? null : isoDate(proposed);
            else {
                value = text(proposed, 'proposedValue', binding.destination === 'patient.phone' ? 40 : binding.destination === 'patient.email' ? 254 : 100, true);
                if (binding.destination === 'patient.email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
                    throw new WorkflowError('INVALID_EMAIL', 422);
            }
            const changed = await update(client, 'patients', t, patient.id, { [column]: value });
            destinationRevision = Number(changed.revision);
            await recordWorkflowAudit(client, t, { action: 'form_changes.applied', entityType: 'patient', entityId: patient.id, requestId: context.requestId, resources: [{ resourceType: 'patient', resourceId: patient.id, patientId: patient.id }], changes: [{ resourceType: 'patient', resourceId: patient.id, fieldPath: binding.destination, captureMode: 'protected_reference', protectedReference: 'form_change_candidates/' + candidate.id }] });
        }
        const decision = await insert(client, 'form_change_decisions', t, { patient_id: candidate.patient_id, candidate_id: candidate.id, decision: p.decision, reason_code: reasonCode, destination_revision: destinationRevision, decided_by_actor_id: t.userId });
        await update(client, 'form_change_candidates', t, candidate.id, { state: p.decision });
        await recordWorkflowAudit(client, t, { action: 'form_changes.decided', entityType: 'form_change_candidate', entityId: candidate.id, reasonCode, requestId: context.requestId, resources: [{ resourceType: 'patient', resourceId: patient.id, patientId: patient.id }, { resourceType: 'form_change_candidate', resourceId: candidate.id, patientId: patient.id }], metadata: { resultState: p.decision } });
        return { id: candidate.id, state: String(p.decision), decisionId: decision.id, patientId: candidate.patient_id, patientRevision: destinationRevision };
    });
}
const cursorSecret = process.env.CAREIQ_WORKFLOW_CURSOR_SECRET || randomBytes(32).toString('hex');
function changeCursor(binding: string, cursor?: string) {
    if (!cursor)
        return null;
    try {
        if (cursor.length > 2048)
            throw Error();
        const [encoded, signature, ...rest] = cursor.split('.');
        if (!encoded || !signature || rest.length)
            throw Error();
        const expected = createHmac('sha256', cursorSecret).update(encoded).digest('base64url');
        if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
            throw Error();
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString());
        if (parsed.v !== 1 || parsed.binding !== binding || typeof parsed.at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(parsed.at))
            throw Error();
        return { at: parsed.at, id: id(parsed.id) };
    }
    catch {
        throw new WorkflowError('INVALID_FORM_CHANGE_CURSOR', 400);
    }
}
export async function formChanges(t: TenantContext, patientId: string, requestId: string, cursor?: string) {
    const selectedPatient = id(patientId), binding = fingerprint({ practiceId: t.practiceId, locationId: t.locationId, patientId: selectedPatient, actor: t.userId, membershipId: t.membershipId }), before = changeCursor(binding, cursor);
    return scoped(t, async (client) => {
        const patient = await row(client, 'patients', t, selectedPatient, false);
        const changes = (await client.query('SELECT c.*,c.created_at::text AS seek_time,b.field_key,b.destination,s.document_version_id FROM form_change_candidates c JOIN template_field_bindings b ON b.id=c.binding_id AND b.practice_id=c.practice_id JOIN form_submissions s ON s.id=c.submission_id AND s.patient_id=c.patient_id AND s.practice_id=c.practice_id AND s.location_id=c.location_id WHERE c.patient_id=$1 AND c.practice_id=$2 AND c.location_id=$3 AND ($4::timestamptz IS NULL OR (c.created_at,c.id)<($4::timestamptz,$5::uuid)) ORDER BY c.created_at DESC,c.id DESC LIMIT 101', [patient.id, t.practiceId, t.locationId, before?.at ?? null, before?.id ?? null])).rows;
        const page = changes.slice(0, 100), last = page.at(-1);
        let nextCursor: string | null = null;
        if (changes.length > 100 && last) {
            const encoded = Buffer.from(JSON.stringify({ v: 1, binding, at: last.seek_time, id: last.id })).toString('base64url');
            nextCursor = encoded + '.' + createHmac('sha256', cursorSecret).update(encoded).digest('base64url');
        }
        await recordWorkflowAudit(client, t, { action: 'form_changes.read', entityType: 'patient', entityId: patient.id, requestId, resources: [{ resourceType: 'patient', resourceId: patient.id, patientId: patient.id }], metadata: { count: page.length } });
        return { patient: concurrency(patient), items: page.map(({ seek_time, ...item }) => concurrency(item)), pagination: { limit: 100, hasMore: changes.length > 100, nextCursor } };
    }, requestId);
}
