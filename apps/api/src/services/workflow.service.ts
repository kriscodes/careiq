import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { TenantContext } from '../middleware/tenant-context.js';
import { recordWorkflowAudit, listWorkflowActivity } from './workflow-audit.js';
import { body, camel, checkRevision, concurrency, id, instant, isoDate, readiness, text, validateFields, WorkflowError, assertTransition, fingerprint } from '../workflow/policy.js';
import { authoringFromVersion, authoringHash, validateAuthoring, validateFormAnswers, renderFormTemplate, type FormSchema } from '../workflow/forms.js';
import { loadWorkflowReadModel, type WorkflowReadOptions, type WorkflowCollection } from '../workflow/read-model.js';
import { command, row, scoped, type CommandContext, type QueryClient } from '../workflow/transaction.js';
import { detectType, maximumFileBytes, readPrivate, renderSigned, renderTemplate, scanPrivate, sha256, storePrivate } from '../workflow/storage.js';
export type WorkflowCapabilities = Record<string, boolean>;
const scope = (t: TenantContext) => [t.practiceId, t.locationId];
const now = () => new Date().toISOString();
const display = (p: Record<string, any>) => p.preferred_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
const safeResult = (id: string, state?: string, extra: Record<string, unknown> = {}): Record<string, any> & {
    id: string;
    state?: string;
} => ({ id, ...(state ? { state } : {}), ...extra });
const validEmail = (value: unknown) => {
    const s = text(value, 'email', 254, true);
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        throw new WorkflowError('INVALID_EMAIL', 422);
    return s;
};
export async function insert(client: QueryClient, table: string, t: TenantContext, values: Record<string, unknown>, practiceOnly = false) {
    const data = { practice_id: t.practiceId, ...(practiceOnly ? {} : { location_id: t.locationId }), ...values };
    const keys = Object.keys(data);
    return (await client.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, Object.values(data))).rows[0];
}
export async function update(client: QueryClient, table: string, t: TenantContext, entityId: string, values: Record<string, unknown>, practiceOnly = false) {
    const keys = Object.keys(values);
    return (await client.query(`UPDATE ${table} SET ${keys.length ? keys.map((k, i) => `${k}=$${i + 1}`).join(',') + ',' : ''}revision=revision+1,updated_at=now() WHERE id=$${keys.length + 1} AND practice_id=$${keys.length + 2} ${practiceOnly ? '' : `AND location_id=$${keys.length + 3}`} RETURNING *`, [...Object.values(values), entityId, t.practiceId, ...(practiceOnly ? [] : [t.locationId])])).rows[0];
}
export async function snapshot(t: TenantContext, caps: WorkflowCapabilities, requestId: string, options: WorkflowReadOptions = {}) {
    return scoped(t, async (client) => {
        const graph = await loadWorkflowReadModel(client, t, caps, options);
        const { location, patients, appointments, providers, visitTypes, documentTypes, documents, versions, objects, reviews, requirements, evidence, requests, requestItems, workItems, templates, templateVersions, packets, deliveries } = graph;
        const primary = (collection: WorkflowCollection, values: any[]) => values.filter(value => graph.primaryIds[collection].includes(value.id));
        const byId = (items: any[]) => new Map(items.map(r => [r.id, r]));
        const patientMap = byId(patients), providerMap = byId(providers), objectMap = byId(objects), docMap = byId(documents), versionMap = byId(versions), reqMap = byId(requests);
        const reviewHead = (versionId: string) => reviews.find(r => r.document_version_id === versionId && !reviews.some(n => n.supersedes_review_id === r.id));
        const versionDto = (v: any) => { const f = objectMap.get(v.file_object_id); const review = reviewHead(v.id); return { ...camel(v), status: f?.status ?? 'unavailable', sha256: f?.sha256 ?? v.content_hash, originalFilename: f?.original_filename ?? null, contentType: f?.detected_media_type ?? f?.declared_media_type ?? null, sizeBytes: Number(f?.actual_bytes ?? f?.expected_bytes ?? 0), receivedAt: f?.uploaded_at ?? v.completed_at ?? null, review: review ? camel(review) : null }; };
        const requirementDto = (r: any) => {
            const selected = evidence.find(e => e.requirement_id === r.id && !e.revoked_at);
            const candidate = versions.find(v => v.patient_id === r.patient_id && docMap.get(v.document_id)?.document_type_id === r.document_type_id && !docMap.get(v.document_id)?.archived_at);
            const selectedVersion = selected && versionMap.get(selected.document_version_id);
            const doc = selectedVersion && docMap.get(selectedVersion.document_id);
            const file = selectedVersion && objectMap.get(selectedVersion.file_object_id);
            const head = selectedVersion && reviewHead(selectedVersion.id);
            const appointment = appointments.find(a => a.id === r.appointment_id);
            const reasons: string[] = [];
            if (selectedVersion) {
                if (doc?.archived_at)
                    reasons.push('DOCUMENT_ARCHIVED');
                if (file?.status !== 'available')
                    reasons.push('FILE_QUARANTINED');
                if (r.review_required && (!head || head.decision !== 'accepted' || head.id !== selected.accepted_review_id))
                    reasons.push('REVIEW_REQUIRED');
                if (r.signature_required && !packets.some(p => p.output_version_id === selectedVersion.id && p.state === 'completed'))
                    reasons.push('SIGNATURE_REQUIRED');
                if (r.required_template_version_id && r.required_template_version_id !== selectedVersion.template_version_id)
                    reasons.push('TEMPLATE_VERSION_MISMATCH');
                if (r.maximum_age_days && appointment && new Date(selectedVersion.completed_at ?? file?.uploaded_at ?? selectedVersion.received_at).getTime() < new Date(appointment.scheduled_at).getTime() - r.maximum_age_days * 86400000)
                    reasons.push('DOCUMENT_EXPIRED');
            }
            let progressState = 'missing';
            if (r.lifecycle_state === 'waived')
                progressState = 'waived';
            else if (selectedVersion && !reasons.length)
                progressState = 'satisfied';
            else if (candidate) {
                const f = objectMap.get(candidate.file_object_id);
                const h = reviewHead(candidate.id);
                progressState = f?.status === 'available' ? (h?.decision === 'replacement_required' ? 'replacement_requested' : r.signature_required && !packets.some(p => p.output_version_id === candidate.id && p.state === 'completed') ? 'requested' : 'needs_review') : 'processing';
            }
            else if (requestItems.some(i => i.requirement_id === r.id && i.is_open && reqMap.get(i.request_id)?.state === 'open'))
                progressState = 'requested';
            return { ...concurrency(r), progressState, reasonCodes: reasons, candidateVersionId: caps.documentsRead ? candidate?.id ?? null : null, candidateDocumentId: caps.documentsRead ? candidate?.document_id ?? null : null, selectedEvidence: caps.documentsRead && selected ? { ...camel(selected), documentId: selectedVersion?.document_id ?? null } : null, documentType: camel(documentTypes.find(d => d.id === r.document_type_id) ?? {}), allowedActions: [...(caps.requirementsWaive && r.lifecycle_state === 'active' ? ['waive'] : []), ...(caps.requirementsWaive && r.lifecycle_state === 'waived' ? ['revoke_waiver'] : []), ...(caps.documentsReview && candidate ? ['review'] : [])] };
        };
        const requirementDtos = requirements.filter(r => r.lifecycle_state !== 'retired').map(requirementDto);
        const appointmentDtos = primary('appointments', appointments).map(a => { const p = patientMap.get(a.patient_id), provider = providerMap.get(a.provider_id); const checklist = requirementDtos.filter(r => r.appointmentId === a.id); return { ...concurrency(a), patient: { id: a.patient_id, displayName: p ? display(p) : 'Patient' }, provider: provider ? { id: provider.id, displayName: provider.display_name } : null, timeZone: location.time_zone, requirements: checklist, readiness: readiness(checklist), allowedActions: [...(caps.appointmentsUpdate ? ['edit', 'cancel', ...(Object.keys({ confirmed: 1, checked_in: 1, in_progress: 1, completed: 1 })).filter(s => ({ scheduled: ['confirmed', 'checked_in'], confirmed: ['checked_in'], checked_in: ['in_progress'], in_progress: ['completed'] } as any)[a.status]?.includes(s))] : []), ...(caps.requestsSend ? ['request_documents'] : [])] }; });
        const documentDtos = primary('documents', documents).map(d => ({ ...concurrency(d), documentType: camel(documentTypes.find(dt => dt.id === d.document_type_id) ?? {}), versions: versions.filter(v => v.document_id === d.id).map(versionDto), currentVersion: d.current_version_id && versionMap.has(d.current_version_id) ? versionDto(versionMap.get(d.current_version_id)) : null, allowedActions: [...(caps.documentsRead ? ['view', 'download'] : []), ...(caps.documentsReview ? ['review'] : []), ...(caps.documentsArchive ? [d.archived_at ? 'restore' : 'archive'] : [])] }));
        const requestDtos = primary('requests', requests).map(r => ({ ...concurrency(r), recipientChannel: r.recipient_email ? 'email' : r.recipient_phone ? 'sms' : 'local_review', deliveryState: deliveries.find(d => d.request_id === r.id)?.state ?? 'not_requested', items: requestItems.filter(i => i.request_id === r.id).map(camel), allowedActions: caps.requestsSend && r.state === 'open' ? ['remind', 'reissue', 'cancel'] : [] }));
        const result = { location: camel(location), timeZone: location.time_zone, patients: primary('patients', patients).map(p => ({ ...concurrency(p), displayName: display(p) })), appointments: appointmentDtos, documents: caps.documentsRead ? documentDtos : [], requests: requestDtos, workItems: primary('workItems', workItems).map(w => ({ ...concurrency(w), patient: { id: w.patient_id, displayName: patientMap.has(w.patient_id) ? display(patientMap.get(w.patient_id)!) : 'Patient' } })), providers: primary('providers', providers).map(concurrency), visitTypes: primary('visitTypes', visitTypes).map(concurrency), documentTypes: primary('documentTypes', documentTypes).map(concurrency), templates: primary('templates', templates).map(tp => ({ ...concurrency(tp), versions: templateVersions.filter(v => v.template_id === tp.id).map(concurrency) })), capabilities: caps, asOf: now(), summary: graph.summary, pagination: graph.pagination, relatedPagination: graph.relatedPagination, documentVersions: caps.documentsRead ? primary('documentVersions', versions).map(versionDto) : [], templateVersions: caps.documentsRead || caps.configurationManage ? primary('templateVersions', templateVersions).map(concurrency) : [], collectionLimit: graph.collectionLimit, truncated: false };
        const accessResources = [...result.patients.map(p => ({ resourceType: 'patient', resourceId: p.id, patientId: p.id })), ...result.appointments.map(a => ({ resourceType: 'appointment', resourceId: a.id, patientId: a.patientId })), ...result.documents.flatMap(d => [{ resourceType: 'document', resourceId: d.id, patientId: d.patientId }, ...d.versions.map((v: any) => ({ resourceType: 'document_version', resourceId: v.id, patientId: d.patientId }))]), ...result.requests.map(r => ({ resourceType: 'request', resourceId: r.id, patientId: r.patientId })), ...result.workItems.map(w => ({ resourceType: 'work_item', resourceId: w.id, patientId: w.patientId })), ...result.documentVersions.map(v => ({ resourceType: 'document_version', resourceId: v.id, patientId: v.patientId }))];
        for (let batch = 0; batch < Math.max(1, accessResources.length); batch += 500)
            await recordWorkflowAudit(client, t, { action: 'workspace.read', entityType: 'workspace', requestId, metadata: { count: Math.min(500, accessResources.length - batch) }, resources: accessResources.slice(batch, batch + 500) });
        return result;
    }, requestId, true);
}
const activityCursorSecret = process.env.CAREIQ_WORKFLOW_CURSOR_SECRET || randomBytes(32).toString('hex');
export async function activity(t: TenantContext, filters: Record<string, unknown>, requestId: string = randomUUID()) {
    if (Object.keys(filters).some(key => !['patientId', 'appointmentId', 'documentId', 'cursor', 'limit'].includes(key)))
        throw new WorkflowError('INVALID_ACTIVITY_FILTER');
    const selected = { patientId: filters.patientId ? id(filters.patientId) : undefined, appointmentId: filters.appointmentId ? id(filters.appointmentId) : undefined, documentId: filters.documentId ? id(filters.documentId) : undefined };
    const limit = Number(filters.limit ?? 50);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new WorkflowError('INVALID_PAGINATION');
    const binding = fingerprint({ practiceId: t.practiceId, locationId: t.locationId, actor: t.userId, membershipId: t.membershipId, filters: selected, limit });
    let beforeTime: string | undefined, beforeId: string | undefined;
    if (filters.cursor !== undefined) {
        try {
            if (typeof filters.cursor !== 'string' || filters.cursor.length > 4000)
                throw new Error();
            const [payload, signature, extra] = filters.cursor.split('.');
            const expected = createHmac('sha256', activityCursorSecret).update(payload).digest(), given = Buffer.from(signature, 'base64url');
            if (extra || expected.length !== given.length || !timingSafeEqual(expected, given))
                throw new Error();
            const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
            if (parsed.binding !== binding || parsed.expiresAt < Date.now() || !Number.isFinite(Date.parse(parsed.beforeTime)))
                throw new Error();
            beforeId = id(parsed.beforeId);
            beforeTime = parsed.beforeTime;
        }
        catch {
            throw new WorkflowError('INVALID_CURSOR');
        }
    }
    return scoped(t, async (client) => {
        const result = await listWorkflowActivity(client, t, { ...selected, limit, beforeTime, beforeId, requestId });
        let nextCursor: string | null = null;
        if (result.nextCursor) {
            const payload = Buffer.from(JSON.stringify({ ...result.nextCursor, binding, expiresAt: Date.now() + 24 * 3600000 })).toString('base64url');
            nextCursor = payload + '.' + createHmac('sha256', activityCursorSecret).update(payload).digest('base64url');
        }
        return { ...result, nextCursor };
    }, requestId);
}
async function workForRequirement(client: QueryClient, t: TenantContext, r: any, kind = 'collect') {
    return (await client.query("INSERT INTO work_items(practice_id,location_id,patient_id,appointment_id,requirement_id,kind,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(practice_id,location_id,requirement_id,kind) WHERE requirement_id IS NOT NULL AND state IN ('open','in_progress') DO UPDATE SET due_at=EXCLUDED.due_at,revision=work_items.revision+1,updated_at=now() RETURNING *", [t.practiceId, t.locationId, r.patient_id, r.appointment_id, r.id, kind, r.due_at])).rows[0];
}
async function reconcile(client: QueryClient, t: TenantContext, a: any, adoptRules = false) {
    const rules = (await client.query("SELECT DISTINCT ON(r.document_type_id) r.*,rs.version AS rule_set_version,dt.name AS label FROM requirement_rules r JOIN requirement_rule_sets rs ON rs.id=r.rule_set_id JOIN document_types dt ON dt.id=r.document_type_id WHERE r.practice_id=$1 AND rs.active AND rs.published_at IS NOT NULL AND (r.location_id IS NULL OR r.location_id=$2) AND (r.visit_type_id IS NULL OR r.visit_type_id=$3) ORDER BY r.document_type_id,(r.location_id IS NOT NULL) DESC,(r.visit_type_id IS NOT NULL) DESC", [t.practiceId, t.locationId, a.visit_type_id])).rows;
    const current = (await client.query("SELECT * FROM visit_requirements WHERE practice_id=$1 AND location_id=$2 AND appointment_id=$3 AND lifecycle_state<>'retired' FOR UPDATE", [...scope(t), a.id])).rows;
    if (adoptRules)
        for (const r of current)
            if (!rules.some(rule => rule.document_type_id === r.document_type_id)) {
                await update(client, 'visit_requirements', t, r.id, { lifecycle_state: 'retired' });
                await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='requirement_retired',revision=revision+1 WHERE requirement_id=$1 AND revoked_at IS NULL", [r.id]);
                await client.query("UPDATE work_items SET state='cancelled',completion_reason_code='requirement_retired',completed_at=now(),revision=revision+1 WHERE requirement_id=$1 AND state IN ('open','in_progress')", [r.id]);
            }
    for (const rule of rules) {
        let requirement = current.find(r => r.document_type_id === rule.document_type_id);
        const values = { due_at: new Date(new Date(a.scheduled_at).getTime() + rule.due_offset_minutes * 60000) };
        if (!requirement)
            requirement = await insert(client, 'visit_requirements', t, { patient_id: a.patient_id, appointment_id: a.id, document_type_id: rule.document_type_id, source_rule_id: rule.id, rule_set_version: rule.rule_set_version, label_snapshot: rule.label, required: rule.required, review_required: rule.review_required, signature_required: rule.signature_required, reuse_policy: rule.reuse_policy, maximum_age_days: rule.maximum_age_days, required_template_version_id: rule.required_template_version_id, ...values });
        else if (adoptRules) {
            requirement = await update(client, 'visit_requirements', t, requirement.id, { ...values, source_rule_id: rule.id, rule_set_version: rule.rule_set_version, required: rule.required, review_required: rule.review_required, signature_required: rule.signature_required, reuse_policy: rule.reuse_policy, maximum_age_days: rule.maximum_age_days, required_template_version_id: rule.required_template_version_id });
            await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='rules_reconciled',revision=revision+1 WHERE requirement_id=$1 AND revoked_at IS NULL", [requirement.id]);
        }
        if (requirement.lifecycle_state === 'active' && requirement.required)
            await workForRequirement(client, t, requirement);
    }
    return rules.length;
}
async function verifyAvailability(client: QueryClient, t: TenantContext, providerId: string, start: Date, end: Date, excludeId?: string) {
    const provider = await row(client, 'providers', t, providerId, true, true);
    if (provider.status !== 'active')
        throw new WorkflowError('PROVIDER_UNAVAILABLE', 409);
    const assignment = await client.query('SELECT id FROM provider_locations WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active FOR SHARE', [...scope(t), providerId]);
    if (!assignment.rowCount)
        throw new WorkflowError('PROVIDER_UNAVAILABLE', 409);
    const exceptions = (await client.query("SELECT * FROM provider_availability_exceptions WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active AND starts_at<$5 AND ends_at>$4", [...scope(t), providerId, start, end])).rows;
    if (exceptions.some(e => e.kind === 'unavailable'))
        throw new WorkflowError('PROVIDER_UNAVAILABLE', 409);
    const available = await client.query("SELECT r.id FROM provider_availability_rules r JOIN locations l ON l.id=r.location_id WHERE r.practice_id=$1 AND r.location_id=$2 AND r.provider_id=$3 AND r.active AND extract(isodow FROM $4::timestamptz AT TIME ZONE l.time_zone)=r.iso_weekday AND ($4::timestamptz AT TIME ZONE l.time_zone)::date>=r.effective_from AND (r.effective_until IS NULL OR ($4::timestamptz AT TIME ZONE l.time_zone)::date<=r.effective_until) AND ($4::timestamptz AT TIME ZONE l.time_zone)::date=($5::timestamptz AT TIME ZONE l.time_zone)::date AND ($4::timestamptz AT TIME ZONE l.time_zone)::time>=r.starts_at_local AND ($5::timestamptz AT TIME ZONE l.time_zone)::time<=r.ends_at_local", [...scope(t), providerId, start, end]);
    if (!available.rowCount && !exceptions.some(e => e.kind === 'available' && new Date(e.starts_at) <= start && new Date(e.ends_at) >= end))
        throw new WorkflowError('OUTSIDE_PROVIDER_AVAILABILITY', 409);
    const conflict = await client.query("SELECT id FROM appointments WHERE practice_id=$1 AND provider_id=$2 AND status IN ('scheduled','confirmed','checked_in','in_progress') AND ends_at>$3 AND scheduled_at<$4 AND ($5::uuid IS NULL OR id<>$5)", [t.practiceId, providerId, start, end, excludeId ?? null]);
    if (conflict.rowCount)
        throw new WorkflowError('APPOINTMENT_CONFLICT', 409);
}
export async function execute(t: TenantContext, action: string, target: string, input: unknown, context: CommandContext) {
    if (action === 'form-changes.decisions') return (await import('./form-changes.service.js')).decideFormChange(t,target,input,context);
    if (action.startsWith('paperwork.')) return (await import('./patient-paperwork.service.js')).executePaperwork(t, action, target, input, context);
    return command(t, action, target, input, context, async (client) => {
        const b = (allowed: string[]) => body(input, allowed);
        if (action === 'patients.create' || action === 'patients.update') {
            const p = b(action === 'patients.create' ? ['firstName', 'lastName', 'preferredName', 'email', 'phone', 'dateOfBirth'] : ['firstName', 'lastName', 'preferredName', 'email', 'phone', 'dateOfBirth', 'archived']);
            const existing = action.endsWith('update') ? await row(client, 'patients', t, id(target)) : null;
            if (existing)
                checkRevision(existing, context.expectedRevision);
            const values: Record<string, unknown> = {};
            for (const [key, column, max] of [['firstName', 'first_name', 100], ['lastName', 'last_name', 100], ['preferredName', 'preferred_name', 100], ['phone', 'phone', 40]] as const)
                if (p[key] !== undefined || !existing && ['firstName', 'lastName'].includes(key))
                    values[column] = text(p[key], key, max, !['firstName', 'lastName'].includes(key));
            if (p.email !== undefined)
                values.email = validEmail(p.email);
            if (p.dateOfBirth !== undefined)
                values.date_of_birth = p.dateOfBirth ? isoDate(p.dateOfBirth) : null;
            if (p.archived !== undefined) {
                if (typeof p.archived !== 'boolean')
                    throw new WorkflowError('INVALID_ARCHIVE_FLAG', 422);
                values.archived_at = p.archived ? now() : null;
            }
            const patient = existing ? await update(client, 'patients', t, existing.id, values) : await insert(client, 'patients', t, values);
            return safeResult(patient.id, undefined, { revision: Number(patient.revision) });
        }
        if (action === 'appointments.create' || action === 'appointments.update') {
            const p = b(['patientId', 'providerId', 'scheduledAt', 'endsAt', 'visitTypeId', 'reason']);
            const existing = action.endsWith('update') ? await row(client, 'appointments', t, id(target)) : null;
            if (existing) {
                checkRevision(existing, context.expectedRevision);
                if (['completed', 'cancelled', 'no_show'].includes(existing.status))
                    throw new WorkflowError('APPOINTMENT_TERMINAL', 409);
                if (p.patientId !== undefined && p.patientId !== existing.patient_id)
                    throw new WorkflowError('PATIENT_IMMUTABLE', 422);
            }
            const patientId = existing?.patient_id ?? id(p.patientId, 'patientId');
            const patient = await row(client, 'patients', t, patientId, false);
            if (patient.archived_at)
                throw new WorkflowError('PATIENT_ARCHIVED', 409);
            const providerId = id(p.providerId ?? existing?.provider_id, 'providerId'), start = instant(p.scheduledAt ?? existing?.scheduled_at?.toISOString(), 'scheduledAt'), end = instant(p.endsAt ?? existing?.ends_at?.toISOString(), 'endsAt');
            if (end <= start || end.getTime() - start.getTime() > 86400000)
                throw new WorkflowError('INVALID_APPOINTMENT_INTERVAL', 422);
            await verifyAvailability(client, t, providerId, start, end, existing?.id);
            const visitTypeId = p.visitTypeId === null ? null : p.visitTypeId !== undefined ? id(p.visitTypeId) : existing?.visit_type_id ?? null;
            if (visitTypeId) {
                const visit = await row(client, 'visit_types', t, visitTypeId, false, true);
                if (!visit.active)
                    throw new WorkflowError('VISIT_TYPE_INACTIVE', 409);
            }
            const values = { provider_id: providerId, scheduled_at: start, ends_at: end, visit_type_id: visitTypeId, reason: p.reason !== undefined ? text(p.reason, 'reason', 1000, true) : existing?.reason ?? null };
            const appointment = existing ? await update(client, 'appointments', t, existing.id, values) : await insert(client, 'appointments', t, { patient_id: patientId, ...values });
            if (!existing || existing.visit_type_id !== visitTypeId)
                await reconcile(client, t, appointment, Boolean(existing));
            if (existing && existing.visit_type_id === visitTypeId)
                await client.query("UPDATE visit_requirements vr SET due_at=$2::timestamptz+((extract(epoch FROM vr.due_at-$3::timestamptz))||' seconds')::interval,revision=revision+1 WHERE appointment_id=$1 AND lifecycle_state<>'retired'", [existing.id, start, existing.scheduled_at]);
            if (existing)
                await client.query("UPDATE work_items w SET due_at=r.due_at,revision=w.revision+1,updated_at=now() FROM visit_requirements r WHERE w.requirement_id=r.id AND r.appointment_id=$1 AND w.state IN ('open','in_progress')", [existing.id]);
            await recordWorkflowAudit(client, t, { action: action + '.details', entityType: 'appointment', entityId: appointment.id, requestId: context.requestId, resources: [{ resourceType: 'patient', resourceId: patientId, patientId }, { resourceType: 'appointment', resourceId: appointment.id, patientId }], changes: existing ? [{ resourceType: 'appointment', resourceId: appointment.id, fieldPath: 'scheduledAt', captureMode: 'value', before: existing.scheduled_at, after: start }] : [] });
            return safeResult(appointment.id, appointment.status, { revision: Number(appointment.revision) });
        }
        if (action === 'appointments.status' || action === 'appointments.cancellation') {
            const p = b(['status', 'reasonCode', 'note']);
            const a = await row(client, 'appointments', t, id(target));
            checkRevision(a, context.expectedRevision);
            const next = action.endsWith('cancellation') ? 'cancelled' : p.status;
            assertTransition(a.status, next);
            const values: Record<string, unknown> = { status: next };
            if (next === 'cancelled') {
                values.cancelled_at = now();
                values.cancelled_by_actor_id = t.userId;
                values.cancellation_reason_code = text(p.reasonCode, 'reasonCode', 80);
                values.cancellation_note = text(p.note, 'note', 1000, true);
            }
            await update(client, 'appointments', t, a.id, values);
            if (['cancelled', 'no_show'].includes(String(next))) {
                await client.query("UPDATE work_items SET state='cancelled',completed_at=now(),completion_reason_code='appointment_closed',revision=revision+1 WHERE appointment_id=$1 AND state IN ('open','in_progress')", [a.id]);
                const openRequests = (await client.query("SELECT * FROM document_requests WHERE appointment_id=$1 AND state='open' FOR UPDATE", [a.id])).rows;
                for (const request of openRequests)
                    await closeRequest(client, t, request, 'cancelled');
            }
            return safeResult(a.id, String(next), { revision: Number(a.revision) + 1, notification: { status: 'not_requested' } });
        }
        if (action === 'requirements.reconciliation') {
            const p = b(['apply']);
            const a = await row(client, 'appointments', t, id(target));
            checkRevision(a, context.expectedRevision);
            if (p.apply !== true)
                throw new WorkflowError('EXPLICIT_APPLY_REQUIRED', 422);
            const count = await reconcile(client, t, a, true);
            await update(client, 'appointments', t, a.id, {});
            return safeResult(a.id, undefined, { requirementCount: count });
        }
        if (action === 'requirements.waiver' || action === 'requirements.waiver-revocation') {
            const p = b(['reasonCode']);
            const r = await row(client, 'visit_requirements', t, id(target));
            checkRevision(r, context.expectedRevision);
            if (r.lifecycle_state === 'retired')
                throw new WorkflowError('REQUIREMENT_RETIRED', 409);
            const reason = text(p.reasonCode, 'reasonCode', 80)!;
            const waived = action.endsWith('.waiver');
            if (waived && r.lifecycle_state === 'waived' || !waived && r.lifecycle_state !== 'waived')
                throw new WorkflowError('INVALID_REQUIREMENT_TRANSITION', 409);
            await recordWorkflowAudit(client, t, { action: waived ? 'requirements.waiver.granted' : 'requirements.waiver.revoked', entityType: 'requirement', entityId: r.id, reasonCode: reason, resources: [{ resourceType: 'patient', resourceId: r.patient_id, patientId: r.patient_id }, { resourceType: 'appointment', resourceId: r.appointment_id, patientId: r.patient_id }], changes: [{ resourceType: 'requirement', resourceId: r.id, fieldPath: 'waiver', captureMode: 'value', before: { reasonCode: r.waiver_reason_code, actor: r.waived_by_actor_id, at: r.waived_at }, after: waived ? { reasonCode: reason, actor: t.userId } : null }] });
            await update(client, 'visit_requirements', t, r.id, waived ? { lifecycle_state: 'waived', waiver_reason_code: reason, waived_by_actor_id: t.userId, waived_at: now() } : { lifecycle_state: 'active', waiver_reason_code: null, waived_by_actor_id: null, waived_at: null });
            if (waived)
                await client.query("UPDATE work_items SET state='completed',completion_reason_code='waived',completed_at=now(),revision=revision+1 WHERE requirement_id=$1 AND state IN ('open','in_progress')", [r.id]);
            else
                await workForRequirement(client, t, r);
            return safeResult(r.id, waived ? 'waived' : 'active');
        }
        if (action === 'requirements.evidence') {
            const p = b(['documentVersionId']);
            const r = await row(client, 'visit_requirements', t, id(target));
            checkRevision(r, context.expectedRevision);
            await linkEvidence(client, t, r, id(p.documentVersionId));
            return safeResult(r.id, 'satisfied');
        }
        if (action === 'providers.create' || action === 'providers.update') {
            const p = b(['displayName', 'status']);
            const existing = action.endsWith('update') ? await row(client, 'providers', t, id(target), true, true) : null;
            if (existing)
                checkRevision(existing, context.expectedRevision);
            const values: Record<string, unknown> = { display_name: text(p.displayName ?? existing?.display_name, 'displayName', 120) };
            if (p.status !== undefined) {
                if (!['active', 'inactive'].includes(String(p.status)))
                    throw new WorkflowError('INVALID_STATUS', 422);
                values.status = p.status;
            }
            const provider = existing ? await update(client, 'providers', t, existing.id, values, true) : await insert(client, 'providers', t, values, true);
            if (!existing)
                await insert(client, 'provider_locations', t, { provider_id: provider.id });
            return safeResult(provider.id, provider.status, { revision: Number(provider.revision) });
        }
        if (action === 'providers.availability') {
            const p = b(['rules', 'exceptions']);
            const provider = await row(client, 'providers', t, id(target), true, true);
            checkRevision(provider, context.expectedRevision);
            if (!Array.isArray(p.rules) || p.rules.length > 28 || p.exceptions !== undefined && (!Array.isArray(p.exceptions) || p.exceptions.length > 100))
                throw new WorkflowError('INVALID_AVAILABILITY', 422);
            await client.query('UPDATE provider_availability_rules SET active=false,revision=revision+1 WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active', [...scope(t), target]);
            await client.query('UPDATE provider_availability_exceptions SET active=false,revision=revision+1 WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active', [...scope(t), target]);
            for (const raw of p.rules) {
                const r = body(raw, ['isoWeekday', 'startsAtLocal', 'endsAtLocal', 'effectiveFrom', 'effectiveUntil']);
                if (!Number.isInteger(r.isoWeekday) || Number(r.isoWeekday) < 1 || Number(r.isoWeekday) > 7 || !/^\d{2}:\d{2}$/.test(String(r.startsAtLocal)) || !/^\d{2}:\d{2}$/.test(String(r.endsAtLocal)) || String(r.startsAtLocal) >= String(r.endsAtLocal))
                    throw new WorkflowError('INVALID_AVAILABILITY', 422);
                await insert(client, 'provider_availability_rules', t, { provider_id: target, iso_weekday: r.isoWeekday, starts_at_local: r.startsAtLocal, ends_at_local: r.endsAtLocal, effective_from: isoDate(r.effectiveFrom), effective_until: r.effectiveUntil ? isoDate(r.effectiveUntil) : null });
            }
            for (const raw of p.exceptions as unknown[] ?? []) {
                const e = body(raw, ['startsAt', 'endsAt', 'kind', 'reasonCode']);
                const start = instant(e.startsAt, 'startsAt'), end = instant(e.endsAt, 'endsAt');
                if (end <= start || !['available', 'unavailable'].includes(String(e.kind)))
                    throw new WorkflowError('INVALID_AVAILABILITY', 422);
                await insert(client, 'provider_availability_exceptions', t, { provider_id: target, starts_at: start, ends_at: end, kind: e.kind, reason_code: text(e.reasonCode, 'reasonCode', 80, true) });
            }
            await update(client, 'providers', t, target, {}, true);
            return safeResult(target, 'active');
        }
        if (action === 'providers.assignment') {
            const p = b(['active']);
            const provider = await row(client, 'providers', t, id(target), true, true);
            checkRevision(provider, context.expectedRevision);
            if (typeof p.active !== 'boolean')
                throw new WorkflowError('INVALID_ASSIGNMENT', 422);
            await client.query('INSERT INTO provider_locations(practice_id,location_id,provider_id,active) VALUES($1,$2,$3,$4) ON CONFLICT(practice_id,provider_id,location_id) DO UPDATE SET active=EXCLUDED.active,revision=provider_locations.revision+1,updated_at=now()', [...scope(t), target, p.active]);
            await update(client, 'providers', t, target, {}, true);
            return safeResult(target, p.active ? 'active' : 'inactive');
        }
        if (action === 'visit-types.create' || action === 'document-types.create') {
            const p = b(['code', 'name', 'defaultDurationMinutes']);
            const code = text(p.code, 'code', 64)!;
            if (!/^[a-z][a-z0-9_]*$/.test(code))
                throw new WorkflowError('INVALID_CODE', 422);
            const values: Record<string, unknown> = { code, name: text(p.name, 'name', 120) };
            if (action.startsWith('visit-types')) {
                if (!Number.isInteger(p.defaultDurationMinutes) || Number(p.defaultDurationMinutes) < 1 || Number(p.defaultDurationMinutes) > 1440)
                    throw new WorkflowError('INVALID_DURATION', 422);
                values.default_duration_minutes = p.defaultDurationMinutes;
            }
            const result = await insert(client, action.startsWith('visit-types') ? 'visit_types' : 'document_types', t, values, true);
            return safeResult(result.id);
        }
        if (action === 'rules.publication') {
            const p = b(['title', 'rules']);
            if (!Array.isArray(p.rules) || p.rules.length > 100)
                throw new WorkflowError('INVALID_RULES', 422);
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [t.practiceId + ':rules']);
            const version = Number((await client.query('SELECT coalesce(max(version),0)+1 AS next FROM requirement_rule_sets WHERE practice_id=$1', [t.practiceId])).rows[0].next);
            const set = await insert(client, 'requirement_rule_sets', t, { version, title: text(p.title, 'title', 120) }, true);
            for (const raw of p.rules) {
                const r = body(raw, ['documentTypeId', 'visitTypeId', 'locationId', 'required', 'reviewRequired', 'signatureRequired', 'reusePolicy', 'maximumAgeDays', 'dueOffsetMinutes', 'requiredTemplateVersionId']);
                for (const flag of ['required', 'reviewRequired', 'signatureRequired'])
                    if (r[flag] !== undefined && typeof r[flag] !== 'boolean')
                        throw new WorkflowError('INVALID_RULE_FLAG', 422);
                await row(client, 'document_types', t, id(r.documentTypeId), false, true);
                if (r.visitTypeId)
                    await row(client, 'visit_types', t, id(r.visitTypeId), false, true);
                if (r.locationId && r.locationId !== t.locationId)
                    throw new WorkflowError('LOCATION_SCOPE_MISMATCH', 422);
                if (!['none', 'same_patient', 'same_appointment'].includes(String(r.reusePolicy ?? 'none')))
                    throw new WorkflowError('INVALID_REUSE_POLICY', 422);
                if (r.maximumAgeDays !== undefined && r.maximumAgeDays !== null && (!Number.isInteger(r.maximumAgeDays) || Number(r.maximumAgeDays) < 1 || Number(r.maximumAgeDays) > 36500))
                    throw new WorkflowError('INVALID_AGE_POLICY', 422);
                if (r.dueOffsetMinutes !== undefined && (!Number.isInteger(r.dueOffsetMinutes) || Math.abs(Number(r.dueOffsetMinutes)) > 525600))
                    throw new WorkflowError('INVALID_DUE_OFFSET', 422);
                await insert(client, 'requirement_rules', t, { rule_set_id: set.id, document_type_id: r.documentTypeId, visit_type_id: r.visitTypeId ?? null, location_id: r.locationId ?? null, required: r.required !== false, review_required: r.reviewRequired !== false, signature_required: r.signatureRequired === true, reuse_policy: r.reusePolicy ?? 'none', maximum_age_days: r.maximumAgeDays ?? null, due_offset_minutes: r.dueOffsetMinutes ?? 0, required_template_version_id: r.requiredTemplateVersionId ? id(r.requiredTemplateVersionId) : null }, true);
            }
            await client.query('UPDATE requirement_rule_sets SET active=false,revision=revision+1 WHERE practice_id=$1 AND active', [t.practiceId]);
            await update(client, 'requirement_rule_sets', t, set.id, { active: true, published_at: now(), published_by_actor_id: t.userId }, true);
            return safeResult(set.id, 'published', { version });
        }
        if (action === 'documents.current-version') {
            const p = b(['documentVersionId', 'reasonCode']);
            const document = await row(client, 'documents', t, id(target));
            checkRevision(document, context.expectedRevision);
            if (document.archived_at)
                throw new WorkflowError('DOCUMENT_ARCHIVED', 409);
            const version = await row(client, 'document_versions', t, id(p.documentVersionId));
            if (version.document_id !== document.id || version.patient_id !== document.patient_id)
                throw new WorkflowError('DOCUMENT_SCOPE_MISMATCH', 422);
            const file = await row(client, 'file_objects', t, version.file_object_id);
            if (file.status !== 'available')
                throw new WorkflowError('DOCUMENT_UNAVAILABLE', 409);
            text(p.reasonCode, 'reasonCode', 80);
            await update(client, 'documents', t, document.id, { current_version_id: version.id });
            return safeResult(document.id, 'available', { documentVersionId: version.id });
        }
        if (action === 'documents.archive' || action === 'documents.restore') {
            const p = b(['reasonCode']);
            const d = await row(client, 'documents', t, id(target));
            checkRevision(d, context.expectedRevision);
            const archived = action.endsWith('archive');
            if (archived === Boolean(d.archived_at))
                throw new WorkflowError('INVALID_DOCUMENT_TRANSITION', 409);
            await update(client, 'documents', t, d.id, archived ? { archived_at: now(), archived_by_actor_id: t.userId, archive_reason_code: text(p.reasonCode, 'reasonCode', 80) } : { archived_at: null, archived_by_actor_id: null, archive_reason_code: null });
            if (archived) {
                const links = (await client.query('SELECT r.* FROM visit_requirements r JOIN requirement_evidence e ON e.requirement_id=r.id JOIN document_versions v ON v.id=e.document_version_id WHERE v.document_id=$1 AND e.revoked_at IS NULL', [d.id])).rows;
                await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='document_archived',revision=revision+1 WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id=$1) AND revoked_at IS NULL", [d.id]);
                for (const r of links)
                    await workForRequirement(client, t, r);
            }
            return safeResult(d.id, archived ? 'archived' : 'active');
        }
        if (action === 'documents.review') {
            const p = b(['decision', 'requirementIds', 'expectedDocumentRevision', 'reasonCode', 'note', 'supersedesReviewId']);
            const v = await row(client, 'document_versions', t, id(target));
            const d = await row(client, 'documents', t, v.document_id);
            checkRevision(d, Number(p.expectedDocumentRevision));
            if (d.archived_at || d.current_version_id !== v.id)
                throw new WorkflowError('DOCUMENT_VERSION_NOT_CURRENT', 409);
            const f = await row(client, 'file_objects', t, v.file_object_id);
            if (f.status !== 'available')
                throw new WorkflowError('DOCUMENT_UNAVAILABLE', 409);
            if (!['accepted', 'replacement_required'].includes(String(p.decision)))
                throw new WorkflowError('INVALID_REVIEW_DECISION', 422);
            const head = (await client.query('SELECT r.* FROM document_reviews r WHERE document_version_id=$1 AND NOT EXISTS(SELECT 1 FROM document_reviews successor WHERE successor.supersedes_review_id=r.id) FOR UPDATE', [v.id])).rows[0];
            if (head && p.supersedesReviewId !== head.id || !head && p.supersedesReviewId)
                throw new WorkflowError('REVIEW_HEAD_CONFLICT', 409);
            const auditId = await recordWorkflowAudit(client, t, { action: head ? 'documents.review.corrected' : 'documents.review.decided', entityType: 'document_version', entityId: v.id, requestId: context.requestId, resources: [{ resourceType: 'patient', resourceId: v.patient_id, patientId: v.patient_id }, { resourceType: 'document', resourceId: d.id, patientId: v.patient_id }, { resourceType: 'document_version', resourceId: v.id, patientId: v.patient_id }], metadata: { fromState: head?.decision ?? null, toState: p.decision, sourceHash: f.sha256 } });
            const review = await insert(client, 'document_reviews', t, { patient_id: v.patient_id, document_version_id: v.id, reviewer_actor_id: t.userId, decision: p.decision, reason_code: text(p.reasonCode, 'reasonCode', 80, p.decision === 'accepted'), note: text(p.note, 'note', 1000, true), supersedes_review_id: head?.id ?? null, audit_event_id: auditId });
            const affected = (await client.query('SELECT DISTINCT r.* FROM visit_requirements r JOIN requirement_evidence e ON e.requirement_id=r.id WHERE e.document_version_id=$1 AND e.revoked_at IS NULL', [v.id])).rows;
            if (head)
                await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='review_corrected',revision=revision+1 WHERE accepted_review_id=$1 AND revoked_at IS NULL", [head.id]);
            if (p.decision === 'replacement_required')
                await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='replacement_required',revision=revision+1 WHERE document_version_id=$1 AND revoked_at IS NULL", [v.id]);
            for (const r of affected)
                await workForRequirement(client, t, r, p.decision === 'replacement_required' ? 'replace' : 'review');
            if (!Array.isArray(p.requirementIds) || p.requirementIds.length > 100)
                throw new WorkflowError('INVALID_REQUIREMENT_IDS', 422);
            for (const requirementId of p.requirementIds) {
                const r = await row(client, 'visit_requirements', t, id(requirementId));
                if (p.decision === 'accepted')
                    await linkEvidence(client, t, r, v.id, review.id);
                else
                    await workForRequirement(client, t, r, 'replace');
            }
            await update(client, 'documents', t, d.id, {});
            return safeResult(review.id, String(p.decision), { documentId: d.id, documentVersionId: v.id });
        }
        if (action === 'templates.create' || action === 'templates.update') {
            const p = b(action === 'templates.create' ? ['documentTypeId', 'title', 'content', 'fieldSchema', 'schemaVersion', 'formSchema'] : ['documentTypeId', 'title', 'active']);
            const existing = action.endsWith('update') ? await row(client, 'document_templates', t, id(target), true, true) : null;
            if (existing)
                checkRevision(existing, context.expectedRevision);
            if (p.documentTypeId)
                await row(client, 'document_types', t, id(p.documentTypeId), false, true);
            const values: Record<string, unknown> = { title: text(p.title ?? existing?.title, 'title', 240) };
            if (p.documentTypeId && existing && p.documentTypeId !== existing.document_type_id)
                throw new WorkflowError('TEMPLATE_TYPE_IMMUTABLE', 422);
            if (p.documentTypeId)
                values.document_type_id = p.documentTypeId;
            if (p.active !== undefined)
                values.active = p.active === true;
            const template = existing ? await update(client, 'document_templates', t, existing.id, values, true) : await insert(client, 'document_templates', t, values, true);
            if (!existing) {
                const authoring = authoringWithTitle(p.schemaVersion, p.fieldSchema ?? [], p.formSchema,template.title);
                await insert(client, 'template_versions', t, { template_id: template.id, version_number: 1, content: text(p.content ?? 'Complete the requested fields.', 'content', 20000)!, schema_version: authoring.schemaVersion, field_schema: JSON.stringify(authoring.fieldSchema), form_schema: JSON.stringify(authoring.formSchema) }, true);
            }
            return safeResult(template.id, undefined, { revision: Number(template.revision) });
        }
        if (action === 'templates.versions') {
            const p = b(['content', 'fieldSchema', 'schemaVersion', 'formSchema']);
            const template = await row(client, 'document_templates', t, id(target), true, true);
            checkRevision(template, context.expectedRevision);
            const next = Number((await client.query('SELECT coalesce(max(version_number),0)+1 AS next FROM template_versions WHERE template_id=$1', [template.id])).rows[0].next);
            const authoring = authoringWithTitle(p.schemaVersion, p.fieldSchema, p.formSchema,template.title);
            const version = await insert(client, 'template_versions', t, { template_id: template.id, version_number: next, content: text(p.content, 'content', 20000), schema_version: authoring.schemaVersion, field_schema: JSON.stringify(authoring.fieldSchema), form_schema: JSON.stringify(authoring.formSchema) }, true);
            await update(client, 'document_templates', t, template.id, {}, true);
            return safeResult(template.id, 'draft', { templateVersionId: version.id });
        }
        if (action === 'templates.version-update') {
            const p = b(['content', 'fieldSchema', 'schemaVersion', 'formSchema']);
            const version = await row(client, 'template_versions', t, id(target), true, true);
            checkRevision(version, context.expectedRevision);
            if (version.state !== 'draft')
                throw new WorkflowError('PUBLISHED_VERSION_IMMUTABLE', 409);
            const values: Record<string, unknown> = {};
            if (p.content !== undefined)
                values.content = text(p.content, 'content', 20000);
            if (Number(version.schema_version) === 2 && p.schemaVersion === 1) throw new WorkflowError('FORM_SCHEMA_DOWNGRADE_DENIED', 422);
            const template = await row(client,'document_templates',t,version.template_id,false,true);
            const authoring = authoringWithTitle(p.schemaVersion ?? version.schema_version, p.fieldSchema ?? version.field_schema, p.formSchema ?? version.form_schema,template.title);
            values.schema_version = authoring.schemaVersion; values.field_schema = JSON.stringify(authoring.fieldSchema); values.form_schema = JSON.stringify(authoring.formSchema);
            const saved = await update(client, 'template_versions', t, version.id, values, true);
            return safeResult(version.id, 'draft', {revision:Number(saved.revision)});
        }
        if (action === 'templates.publication') {
            const p = b(['versionId','expectedDraftRevision']);
            const template = await row(client, 'document_templates', t, id(target), true, true);
            checkRevision(template, context.expectedRevision);
            const version = p.versionId ? await row(client, 'template_versions', t, id(p.versionId), true, true) : (await client.query("SELECT * FROM template_versions WHERE template_id=$1 AND state='draft' ORDER BY version_number DESC LIMIT 1 FOR UPDATE", [template.id])).rows[0];
            if (!version || version.template_id !== template.id || version.state !== 'draft')
                throw new WorkflowError('TEMPLATE_VERSION_UNAVAILABLE', 409);
            if(Number(version.schema_version)===2)checkRevision(version,Number(p.expectedDraftRevision));
            const authoring = authoringWithTitle(version.schema_version,version.field_schema,version.form_schema,template.title);
            const validation = await checkFormPublication(client,t,{...version,form_schema:authoring.formSchema},context.requestId);
            const contentHash = validation.schemaHash;
            if (authoring.schemaVersion === 2) for (const binding of (authoring.formSchema as FormSchema).bindings) await insert(client,'template_field_bindings',t,{template_version_id:version.id,field_key:binding.fieldKey,destination:binding.destination,review_required:true},true);
            await update(client, 'template_versions', t, version.id, { state: 'published', published_at: now(), published_by_actor_id: t.userId, content_hash: contentHash, form_schema:JSON.stringify(authoring.formSchema) }, true);
            await update(client, 'document_templates', t, template.id, { published_version_id: version.id }, true);
            return safeResult(template.id, 'published', { templateVersionId: version.id });
        }
        if (action === 'templates.validation') {
            b([]); const version = await row(client,'template_versions',t,id(target),true,true); checkRevision(version,context.expectedRevision);
            return {id:version.id,...await checkFormPublication(client,t,version,context.requestId)};
        }
        if (action === 'templates.preparation') {
            const p = b(['patientId', 'appointmentId', 'requirementId', 'templateVersionId', 'answers']);
            const patientId = id(p.patientId ?? target, 'patientId');
            await row(client, 'patients', t, patientId);
            const version = await row(client, 'template_versions', t, id(p.templateVersionId), false, true);
            if (version.state !== 'published')
                throw new WorkflowError('TEMPLATE_NOT_PUBLISHED', 409);
            const template = await row(client, 'document_templates', t, version.template_id, false, true);
            if (p.appointmentId) {
                const a = await row(client, 'appointments', t, id(p.appointmentId), false);
                if (a.patient_id !== patientId)
                    throw new WorkflowError('PATIENT_SCOPE_MISMATCH', 422);
            }
            if (p.requirementId) {
                const r = await row(client, 'visit_requirements', t, id(p.requirementId), false);
                if (r.patient_id !== patientId || r.document_type_id !== template.document_type_id)
                    throw new WorkflowError('PATIENT_SCOPE_MISMATCH', 422);
            }
            const authoring = authoringFromVersion(version);
            const {answers} = validateFormAnswers(authoring,p.answers ?? {},true);
            const prepared = await insert(client, 'prepared_documents', t, { patient_id: patientId, appointment_id: p.appointmentId ?? null, requirement_id: p.requirementId ?? null, template_version_id: version.id, answers: JSON.stringify(answers), state: 'draft', created_by_actor_id: t.userId });
            const created = await freezePrepared(client,t,prepared,{requestId:context.requestId});
            if (p.requirementId)
                await workForRequirement(client, t, await row(client, 'visit_requirements', t, p.requirementId as string), 'review');
            return safeResult(prepared.id, 'ready', { documentId: created.document.id, documentVersionId: created.version.id });
        }
        if (action === 'uploads.reservation')
            return reserveUpload(client, t, target, b(['documentTypeId', 'requirementId', 'existingDocumentId', 'baseVersionId', 'file', 'title']));
        if (action === 'uploads.completion')
            return completeUpload(client, t, id(target), b(['sha256', 'sizeBytes']), context);
        if (action === 'requests.create')
            return createRequest(client, t, target, b(['patientId', 'appointmentId', 'purpose', 'items', 'recipient', 'dueAt', 'expiresAt', 'assigneeUserId', 'delivery', 'reasonCode']));
        if (action === 'requests.cancellation') {
            const p = b(['reasonCode']);
            const request = await row(client, 'document_requests', t, id(target));
            checkRevision(request, context.expectedRevision);
            text(p.reasonCode, 'reasonCode', 80);
            if (request.state !== 'open')
                throw new WorkflowError('REQUEST_TERMINAL', 409);
            await closeRequest(client, t, request, 'cancelled');
            return safeResult(request.id, 'cancelled');
        }
        if (action === 'requests.reminders' || action === 'requests.reissue') {
            const p = b(['reasonCode']);
            const request = await row(client, 'document_requests', t, id(target));
            checkRevision(request, context.expectedRevision);
            if (request.state !== 'open' || new Date(request.expires_at) <= new Date())
                throw new WorkflowError('REQUEST_TERMINAL', 409);
            if (action.endsWith('reminders')) {
                const recent = await client.query("SELECT id FROM delivery_attempts WHERE request_id=$1 AND purpose='reminder' AND created_at>now()-interval '1 hour'", [request.id]);
                if (recent.rowCount)
                    throw new WorkflowError('REMINDER_COOLDOWN', 429);
                const attempt = await localDelivery(client, t, request, 'reminder');
                return safeResult(request.id, 'open', deliveryReceipt(attempt));
            }
            text(p.reasonCode, 'reasonCode', 80);
            await revokeAccess(client, request.id);
            const next = await update(client, 'document_requests', t, request.id, { delivery_generation: Number(request.delivery_generation ?? 1) + 1 });
            const link = await issueGrant(client, t, next);
            const attempt = await localDelivery(client, t, next, 'reissue');
            return safeResult(request.id, 'open', { localReviewPath: link, ...deliveryReceipt(attempt) });
        }
        if (action === 'work-items.assignment' || action === 'work-items.completion') {
            const p = b(['assigneeUserId', 'reasonCode']);
            const work = await row(client, 'work_items', t, id(target));
            checkRevision(work, context.expectedRevision);
            if (!['open', 'in_progress'].includes(work.state))
                throw new WorkflowError('WORK_ITEM_TERMINAL', 409);
            if (action.endsWith('assignment')) {
                const actor = text(p.assigneeUserId, 'assigneeUserId', 128, true);
                if (actor) {
                    const member = await client.query("SELECT m.user_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.user_id=$3 AND m.status='active' AND a.active FOR SHARE", [...scope(t), actor]);
                    if (!member.rowCount)
                        throw new WorkflowError('INVALID_ASSIGNEE', 422);
                }
                await update(client, 'work_items', t, work.id, { assignee_user_id: actor });
            }
            else {
                if (work.requirement_id && ['collect', 'review', 'replace'].includes(work.kind))
                    throw new WorkflowError('WORK_REQUIRES_DOMAIN_COMPLETION', 409);
                await update(client, 'work_items', t, work.id, { state: 'completed', completed_at: now(), completion_reason_code: text(p.reasonCode, 'reasonCode', 80) });
            }
            return safeResult(work.id);
        }
        throw new WorkflowError('UNKNOWN_COMMAND', 404);
    });
}
async function linkEvidence(client: QueryClient, t: TenantContext, r: any, versionId: string, reviewId?: string) {
    if (r.lifecycle_state !== 'active')
        throw new WorkflowError('REQUIREMENT_NOT_ACTIVE', 409);
    const v = await row(client, 'document_versions', t, versionId);
    const d = await row(client, 'documents', t, v.document_id);
    const f = await row(client, 'file_objects', t, v.file_object_id);
    if (v.patient_id !== r.patient_id || d.document_type_id !== r.document_type_id)
        throw new WorkflowError('EVIDENCE_SCOPE_MISMATCH', 422);
    if (d.archived_at || f.status !== 'available')
        throw new WorkflowError('DOCUMENT_UNAVAILABLE', 409);
    const review = (await client.query('SELECT r.* FROM document_reviews r WHERE document_version_id=$1 AND NOT EXISTS(SELECT 1 FROM document_reviews n WHERE n.supersedes_review_id=r.id)', [v.id])).rows[0];
    if (r.review_required && (!review || review.decision !== 'accepted' || reviewId && reviewId !== review.id))
        throw new WorkflowError('REVIEW_REQUIRED', 409);
    if (r.signature_required) {
        const packet = await client.query("SELECT id FROM signature_packets WHERE output_version_id=$1 AND state='completed'", [v.id]);
        if (!packet.rowCount)
            throw new WorkflowError('SIGNATURE_REQUIRED', 409);
    }
    if (r.required_template_version_id && r.required_template_version_id !== v.template_version_id)
        throw new WorkflowError('TEMPLATE_VERSION_MISMATCH', 409);
    const a = await row(client, 'appointments', t, r.appointment_id, false);
    if (r.maximum_age_days && new Date(v.completed_at ?? f.uploaded_at ?? v.received_at).getTime() < new Date(a.scheduled_at).getTime() - r.maximum_age_days * 86400000)
        throw new WorkflowError('DOCUMENT_EXPIRED', 409);
    if (r.reuse_policy !== 'same_patient') {
        const other = await client.query('SELECT e.id FROM requirement_evidence e JOIN visit_requirements r ON r.id=e.requirement_id WHERE e.document_version_id=$1 AND r.appointment_id<>$2', [v.id, r.appointment_id]);
        if (other.rowCount)
            throw new WorkflowError('DOCUMENT_REUSE_FORBIDDEN', 409);
    }
    await client.query("UPDATE requirement_evidence SET revoked_at=now(),revocation_reason_code='evidence_reselected',revision=revision+1 WHERE requirement_id=$1 AND revoked_at IS NULL", [r.id]);
    await insert(client, 'requirement_evidence', t, { patient_id: r.patient_id, requirement_id: r.id, document_version_id: v.id, accepted_review_id: r.review_required ? review.id : null, linked_by_actor_id: t.userId });
    await update(client, 'visit_requirements', t, r.id, {});
    await client.query("UPDATE work_items SET state='completed',completed_at=now(),completion_reason_code='evidence_accepted',revision=revision+1 WHERE requirement_id=$1 AND state IN ('open','in_progress')", [r.id]);
}
function validateAnswers(fields: any[], value: unknown, includeSignatures: boolean) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 50000)
        throw new WorkflowError('INVALID_ANSWERS', 422);
    const answers = value as Record<string, unknown>;
    if (Object.keys(answers).some(key => !fields.some(f => f.key === key)))
        throw new WorkflowError('UNKNOWN_ANSWER_FIELD', 422);
    for (const field of fields) {
        if (!includeSignatures && ['typed_signature', 'drawn_signature'].includes(field.type))
            continue;
        const answer = answers[field.key];
        if (field.required && (answer === undefined || answer === null || answer === '' || field.type === 'checkbox' && answer !== true))
            throw new WorkflowError('REQUIRED_FIELD', 422, { field: field.key });
        if (answer !== undefined && answer !== null) {
            if (field.type === 'checkbox') {
                if (typeof answer !== 'boolean')
                    throw new WorkflowError('INVALID_ANSWER_TYPE', 422);
            }
            else if (typeof answer !== 'string' || answer.length > 4000)
                throw new WorkflowError('INVALID_ANSWER_TYPE', 422);
            if (field.type === 'select' && !field.options?.includes(answer))
                throw new WorkflowError('INVALID_ANSWER_OPTION', 422);
        }
    }
    return answers;
}
export async function createGeneratedDocument(client: QueryClient, t: TenantContext, input: {
    patientId: string;
    documentTypeId: string;
    title: string;
    source: string;
    bytes: Buffer;
    templateVersionId?: string;
    sourceVersionId?: string;
    documentId?: string;
    requestId?: string;
    structuredAnswers?: Record<string,unknown>;
    answersSchemaVersion?: number;
    rendererReference?: string;
}) {
    const objectId = randomUUID(), storageKey = objectId + '.pdf';
    await storePrivate(storageKey, input.bytes);
    const file = await insert(client, 'file_objects', t, { id: objectId, patient_id: input.patientId, ...(input.requestId ? { request_id: input.requestId } : {}), storage_key: storageKey, storage_version: sha256(input.bytes), original_filename: input.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 100) + '.pdf', declared_media_type: 'application/pdf', detected_media_type: 'application/pdf', expected_bytes: input.bytes.length, actual_bytes: input.bytes.length, sha256: sha256(input.bytes), status: 'available', upload_expires_at: now(), uploaded_at: now(), verified_at: now(), scan_verdict: 'clean', scan_reference: input.rendererReference ?? 'careiq-trusted-pdf-renderer-v1' });
    const document = input.documentId ? await row(client, 'documents', t, input.documentId) : await insert(client, 'documents', t, { patient_id: input.patientId, ...(input.requestId ? { request_id: input.requestId } : {}), document_type_id: input.documentTypeId, title: input.title });
    const versionNumber = Number((await client.query('SELECT coalesce(max(version_number),0)+1 AS next FROM document_versions WHERE document_id=$1', [document.id])).rows[0].next);
    const version = await insert(client, 'document_versions', t, { patient_id: input.patientId, ...(input.requestId ? { request_id: input.requestId } : {}), document_id: document.id, version_number: versionNumber, source: input.source, template_version_id: input.templateVersionId ?? null, source_version_id: input.sourceVersionId ?? null, file_object_id: file.id, received_at: now(), completed_at: now(), created_by_actor_id: t.userId, content_hash: sha256(input.bytes), ...(input.structuredAnswers ? {structured_answers:JSON.stringify(input.structuredAnswers),answers_schema_version:input.answersSchemaVersion ?? 1} : {}) });
    await update(client, 'documents', t, document.id, { current_version_id: version.id });
    return { document, version, file };
}
async function reserveUpload(client: QueryClient, t: TenantContext, patientTarget: string, p: Record<string, unknown>, requestId?: string, patientSessionId?: string) {
    const patientId = id(patientTarget || p.patientId, 'patientId');
    if (!requestId)
        await row(client, 'patients', t, patientId);
    const documentTypeId = id(p.documentTypeId, 'documentTypeId');
    if (!requestId)
        await row(client, 'document_types', t, documentTypeId, false, true);
    const file = body(p.file, ['name', 'contentType', 'sizeBytes', 'sha256']);
    const filename = text(file.name, 'file.name', 240)!;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(String(file.contentType)) || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 1 || Number(file.sizeBytes) > maximumFileBytes || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
        throw new WorkflowError('INVALID_FILE', 422);
    if (p.requirementId && !requestId) {
        const requirement = await row(client, 'visit_requirements', t, id(p.requirementId), false);
        if (requirement.patient_id !== patientId || requirement.document_type_id !== documentTypeId)
            throw new WorkflowError('REQUIREMENT_SCOPE_MISMATCH', 422);
    }
    let document;
    if (p.existingDocumentId) {
        document = await row(client, 'documents', t, id(p.existingDocumentId));
        if (document.patient_id !== patientId || document.document_type_id !== documentTypeId || document.archived_at)
            throw new WorkflowError('DOCUMENT_SCOPE_MISMATCH', 422);
        if (document.current_version_id !== (p.baseVersionId ?? null))
            throw new WorkflowError('BASE_VERSION_CONFLICT', 409);
    }
    else
        document = await insert(client, 'documents', t, { patient_id: patientId, document_type_id: documentTypeId, title: text(p.title ?? filename, 'title', 240), ...(requestId ? { request_id: requestId } : {}) });
    const objectId = randomUUID(), expiresAt = new Date(Date.now() + 10 * 60000);
    const object = await insert(client, 'file_objects', t, { id: objectId, patient_id: patientId, ...(requestId ? { request_id: requestId } : {}), storage_key: objectId + '.bin', original_filename: filename, declared_media_type: file.contentType, expected_bytes: file.sizeBytes, upload_expires_at: expiresAt });
    const versionNumber = Number((await client.query('SELECT coalesce(max(version_number),0)+1 AS next FROM document_versions WHERE document_id=$1', [document.id])).rows[0].next);
    const version = await insert(client, 'document_versions', t, { patient_id: patientId, ...(requestId ? { request_id: requestId } : {}), document_id: document.id, version_number: versionNumber, source: patientSessionId ? 'patient_upload' : 'staff_upload', file_object_id: object.id, created_by_actor_id: t.userId });
    const session = await insert(client, 'upload_sessions', t, { patient_id: patientId, ...(requestId ? { request_id: requestId } : {}), document_id: document.id, document_version_id: version.id, base_version_id: document.current_version_id ?? null, file_object_id: object.id, actor_user_id: patientSessionId ? null : t.userId, patient_session_id: patientSessionId ?? null, declared_size_bytes: file.sizeBytes, declared_sha256: file.sha256, declared_media_type: file.contentType, expires_at: expiresAt });
    return safeResult(session.id, 'reserved', { documentId: document.id, documentVersionId: version.id, uploadSessionId: session.id, upload: { method: 'PUT', url: `/api/v1/locations/${t.locationId}/workflow/upload-sessions/${session.id}/content`, headers: { 'Content-Type': String(file.contentType) }, expiresAt: expiresAt.toISOString() } });
}
export async function putUpload(t: TenantContext, sessionId: string, bytes: Buffer, requestId: string) {
    return scoped(t, async (client) => {
        const session = await row(client, 'upload_sessions', t, id(sessionId));
        const object = await row(client, 'file_objects', t, session.file_object_id);
        if (session.completed_at || new Date(session.expires_at) <= new Date())
            throw new WorkflowError('UPLOAD_EXPIRED', 410);
        if (bytes.length !== Number(session.declared_size_bytes) || bytes.length > maximumFileBytes || sha256(bytes) !== session.declared_sha256 || detectType(bytes) !== session.declared_media_type)
            throw new WorkflowError('UPLOAD_INTEGRITY_MISMATCH', 422);
        await storePrivate(object.storage_key, bytes);
        if (object.status === 'reserved')
            await update(client, 'file_objects', t, object.id, { status: 'uploaded', uploaded_at: now(), actual_bytes: bytes.length, sha256: sha256(bytes), detected_media_type: detectType(bytes), storage_version: sha256(bytes) });
        await recordWorkflowAudit(client, t, { action: 'uploads.bytes.received', entityType: 'upload_session', entityId: session.id, requestId, metadata: { byteCount: bytes.length, sourceHash: sha256(bytes) }, resources: [{ resourceType: 'document_version', resourceId: session.document_version_id, patientId: session.patient_id }] });
        return safeResult(session.id, 'uploaded');
    }, requestId);
}
async function completeUpload(client: QueryClient, t: TenantContext, sessionId: string, p: Record<string, unknown>, context: CommandContext, patientRequestId?: string) {
    const session = await row(client, 'upload_sessions', t, sessionId);
    const object = await row(client, 'file_objects', t, session.file_object_id);
    if (session.completed_at)
        throw new WorkflowError('UPLOAD_ALREADY_COMPLETED', 409);
    if (new Date(session.expires_at) <= new Date())
        throw new WorkflowError('UPLOAD_EXPIRED', 410);
    if (!['uploaded', 'quarantined'].includes(object.status))
        throw new WorkflowError('UPLOAD_NOT_RECEIVED', 409);
    const bytes = await readPrivate(object.storage_key);
    if (bytes.length !== Number(session.declared_size_bytes) || sha256(bytes) !== session.declared_sha256 || p.sha256 !== undefined && p.sha256 !== sha256(bytes) || p.sizeBytes !== undefined && Number(p.sizeBytes) !== bytes.length || detectType(bytes) !== session.declared_media_type)
        throw new WorkflowError('UPLOAD_INTEGRITY_MISMATCH', 422);
    const operation = await insert(client, 'workflow_operations', t, { ...(patientRequestId ? { patient_request_id: patientRequestId } : {}), operation_type: 'document_scan', initiating_actor_id: t.userId, target_type: 'upload_session', target_id: session.id, command_fingerprint: fingerprint({ sessionId, sha256: sha256(bytes) }), state: 'running', request_id: context.requestId, started_at: now() });
    const attempt = Number((await client.query('SELECT coalesce(max(attempt),0)+1 AS next FROM file_scan_runs WHERE file_object_id=$1', [object.id])).rows[0].next);
    const job = await insert(client, 'job_runs', t, { operation_id: operation.id, job_type: 'document_scan', job_version: 'v1', attempt: 1, executor_id: 'careiq-local-scanner', fencing_token: randomUUID(), input_references: JSON.stringify({ fileObjectId: object.id, sha256: sha256(bytes) }) });
    const scan = await scanPrivate(object.storage_key);
    const auditId = await recordWorkflowAudit(client, t, { action: 'uploads.scan.result', entityType: 'file_object', entityId: object.id, operationId: operation.id, metadata: { result: scan.verdict, failureCode: scan.failureCode ?? null, sourceHash: sha256(bytes), attempt }, resources: [{ resourceType: 'document_version', resourceId: session.document_version_id, patientId: session.patient_id }] });
    await insert(client, 'file_scan_runs', t, { patient_id: session.patient_id, file_object_id: object.id, job_run_id: job.id, attempt, scanner_version: scan.scanner, ruleset_version: 'local-v1', verified_storage_version: object.storage_version, verified_sha256: sha256(bytes), completed_at: now(), verdict: scan.verdict, failure_code: scan.failureCode ?? null, audit_event_id: auditId });
    const available = scan.verdict === 'clean';
    await update(client, 'file_objects', t, object.id, { status: available ? 'available' : scan.verdict === 'unsafe' ? 'rejected' : 'quarantined', scan_verdict: scan.verdict, scan_reference: scan.scanner, verified_at: now() });
    await update(client, 'job_runs', t, job.id, { state: available ? 'succeeded' : 'failed', finished_at: now(), failure_code: scan.failureCode ?? null, audit_event_id: auditId });
    await update(client, 'workflow_operations', t, operation.id, { state: available ? 'succeeded' : 'failed', completed_at: now(), result_type: 'document_version', result_id: session.document_version_id, failure_code: scan.failureCode ?? null });
    if (available) {
        await update(client, 'upload_sessions', t, session.id, { completed_at: now() });
        const document = await row(client, 'documents', t, session.document_id);
        if (document.current_version_id === (session.base_version_id ?? null))
            await update(client, 'documents', t, document.id, { current_version_id: session.document_version_id });
        const requirements = (await client.query("SELECT * FROM visit_requirements WHERE practice_id=$1 AND location_id=$2 AND patient_id=$3 AND document_type_id=$4 AND lifecycle_state='active'", [...scope(t), session.patient_id, document.document_type_id])).rows;
        for (const r of requirements)
            await workForRequirement(client, t, r, 'review');
    }
    const head = available ? await row(client, 'documents', t, session.document_id, false) : null;
    return safeResult(session.id, available ? 'available' : 'quarantined', { promotion: available ? (head.current_version_id === session.document_version_id ? 'current' : 'requires_resolution') : 'not_available', operationId: operation.id, documentId: session.document_id, documentVersionId: session.document_version_id, failureCode: scan.failureCode ?? null, statusUrl: `/api/v1/locations/${t.locationId}/workflow/operations/${operation.id}` });
}
async function revokeAccess(client: QueryClient, requestId: string) { await client.query('UPDATE patient_access_grants SET revoked_at=now(),revision=revision+1 WHERE request_id=$1 AND revoked_at IS NULL', [requestId]); await client.query('UPDATE patient_sessions SET revoked_at=now(),revision=revision+1 WHERE request_id=$1 AND revoked_at IS NULL', [requestId]); }
async function closeRequest(client: QueryClient, t: TenantContext, request: any, state: string) {
    await revokeAccess(client, request.id);
    await client.query("UPDATE document_request_items SET state='cancelled',is_open=false,revision=revision+1 WHERE request_id=$1 AND is_open", [request.id]);
    await client.query("UPDATE signature_packets SET state=$2,revision=revision+1 WHERE request_id=$1 AND state IN ('pending','completing','failed')", [request.id, state]);
    await client.query("UPDATE work_items SET state='cancelled',completed_at=now(),completion_reason_code=$2,revision=revision+1 WHERE request_id=$1 AND state IN ('open','in_progress')", [request.id, state]);
    await update(client, 'document_requests', t, request.id, { state });
}
export async function issueGrant(client: QueryClient, t: TenantContext, request: any) { const token = randomBytes(32).toString('base64url'); await insert(client, 'patient_access_grants', t, { patient_id: request.patient_id, request_id: request.id, token_hash: sha256(Buffer.from(token)), expires_at: request.expires_at }); return '/patient-workflow#token=' + token; }
export async function localDelivery(client: QueryClient, t: TenantContext, request: any, purpose: string) {
    if (request.recipient_email || request.recipient_phone) {
        const { enqueueLegacyRequestDelivery } = await import('./patient-delivery.service.js');
        const intent = await enqueueLegacyRequestDelivery(client, t, request, purpose);
        return { ...intent, intent_id: intent.id };
    }
    const sequence = Number((await client.query('SELECT coalesce(max(sequence),0)+1 AS next FROM delivery_attempts WHERE request_id=$1', [request.id])).rows[0].next);
    const delivery = await insert(client, 'delivery_attempts', t, { patient_id: request.patient_id, request_id: request.id, purpose, sequence, channel: request.recipient_email ? 'email' : request.recipient_phone ? 'sms' : 'local_review', destination_snapshot: request.recipient_email ?? request.recipient_phone ?? 'local review', provider_id: 'unconfigured', state: 'failed', failure_code: 'DELIVERY_PROVIDER_UNAVAILABLE', completed_at: now(), dedupe_key: randomUUID() });
    await insert(client, 'outbox_events', t, { event_type: 'delivery.unavailable', aggregate_id: request.id, aggregate_revision: Number(request.revision), payload: JSON.stringify({ requestId: request.id, attemptId: delivery.id, channel: delivery.channel }), last_failure_code: 'DELIVERY_PROVIDER_UNAVAILABLE' });
    await client.query("INSERT INTO work_items(practice_id,location_id,patient_id,appointment_id,request_id,kind,assignee_user_id,due_at) VALUES($1,$2,$3,$4,$5,'delivery_follow_up',$6,$7) ON CONFLICT(practice_id,location_id,request_id,kind) WHERE kind='delivery_follow_up' AND state IN ('open','in_progress') DO NOTHING", [...scope(t), request.patient_id, request.appointment_id, request.id, request.assignee_user_id, request.due_at]);
    return delivery;
}
export function deliveryReceipt(delivery: { id: string; intent_id?: string; state?: string; failure_code?: string | null }) {
    return { deliveryState: delivery.state ?? 'failed', ...(delivery.intent_id ? { deliveryIntentId: delivery.intent_id } : { attemptId: delivery.id }), ...(delivery.failure_code ? { failureCode: delivery.failure_code } : {}) };
}
const consentText = 'I consent to use electronic records and signatures for this document. I have reviewed the document and agree that my submitted signature records my intent to sign. I can decline before completion.';
async function createRequest(client: QueryClient, t: TenantContext, target: string, p: Record<string, unknown>) {
    const patientId = id(p.patientId ?? target, 'patientId');
    const patient = await row(client, 'patients', t, patientId);
    if (patient.archived_at)
        throw new WorkflowError('PATIENT_ARCHIVED', 409);
    const appointmentId = p.appointmentId ? id(p.appointmentId) : null;
    if (appointmentId) {
        const a = await row(client, 'appointments', t, appointmentId);
        if (a.patient_id !== patientId || ['cancelled', 'completed', 'no_show'].includes(a.status))
            throw new WorkflowError('APPOINTMENT_UNAVAILABLE', 409);
    }
    const purpose = String(p.purpose ?? 'collection');
    if (!['collection', 'signature', 'replacement'].includes(purpose) || !Array.isArray(p.items) || !p.items.length || p.items.length > 30 || purpose === 'signature' && p.items.length !== 1)
        throw new WorkflowError('INVALID_REQUEST_ITEMS', 422);
    const recipient = body(p.recipient ?? { name: display(patient), channel: 'local_review' }, ['name', 'channel', 'address']);
    if (!['email', 'sms', 'local_review'].includes(String(recipient.channel)))
        throw new WorkflowError('INVALID_CHANNEL', 422);
    const dueAt = p.dueAt ? instant(p.dueAt, 'dueAt') : null, expiresAt = p.expiresAt ? instant(p.expiresAt, 'expiresAt') : new Date(Date.now() + 7 * 86400000);
    if (expiresAt <= new Date() || dueAt && dueAt > expiresAt)
        throw new WorkflowError('INVALID_REQUEST_EXPIRY', 422);
    const assignee = text(p.assigneeUserId, 'assigneeUserId', 128, true);
    if (assignee) {
        const active = await client.query("SELECT a.user_id FROM location_assignments a JOIN practice_member_access m ON m.practice_id=a.practice_id AND m.user_id=a.user_id WHERE a.practice_id=$1 AND a.location_id=$2 AND a.user_id=$3 AND a.active AND m.status='active'", [...scope(t), assignee]);
        if (!active.rowCount)
            throw new WorkflowError('INVALID_ASSIGNEE', 422);
    }
    const request = await insert(client, 'document_requests', t, { patient_id: patientId, appointment_id: appointmentId, purpose, recipient_name: text(recipient.name, 'recipient.name', 200), recipient_email: recipient.channel === 'email' ? validEmail(recipient.address) : null, recipient_phone: recipient.channel === 'sms' ? text(recipient.address, 'recipient.address', 40) : null, due_at: dueAt, expires_at: expiresAt, state: 'open', assignee_user_id: assignee, reason_code: text(p.reasonCode, 'reasonCode', 80, purpose !== 'replacement'), created_by_actor_id: t.userId });
    let sourceVersion: any;
    for (const raw of p.items) {
        const item = body(raw, ['requirementId', 'sourceDocumentVersionId']);
        const r = await row(client, 'visit_requirements', t, id(item.requirementId));
        if (r.patient_id !== patientId || appointmentId && r.appointment_id !== appointmentId || r.lifecycle_state !== 'active')
            throw new WorkflowError('REQUIREMENT_SCOPE_MISMATCH', 422);
        if (purpose === 'signature') {
            sourceVersion = await row(client, 'document_versions', t, id(item.sourceDocumentVersionId));
            if(sourceVersion.template_version_id){const sourceTemplate=await row(client,'template_versions',t,sourceVersion.template_version_id,false,true);if(Number(sourceTemplate.schema_version)===2)throw new WorkflowError('FORM_COMPLETION_REQUEST_REQUIRED',409);}
            const d = await row(client, 'documents', t, sourceVersion.document_id);
            const f = await row(client, 'file_objects', t, sourceVersion.file_object_id);
            if (sourceVersion.patient_id !== patientId || d.document_type_id !== r.document_type_id || d.archived_at || d.current_version_id !== sourceVersion.id || f.status !== 'available' || f.detected_media_type !== 'application/pdf')
                throw new WorkflowError('SIGNATURE_SOURCE_UNAVAILABLE', 409);
        }
        await insert(client, 'document_request_items', t, { patient_id: patientId, request_id: request.id, requirement_id: r.id, document_type_id: r.document_type_id, source_version_id: sourceVersion?.id ?? null });
    }
    if (purpose === 'signature') {
        const packet = await insert(client, 'signature_packets', t, { patient_id: patientId, request_id: request.id, source_version_id: sourceVersion.id, recipient_snapshot: JSON.stringify({ name: request.recipient_name }), consent_text_version: 'careiq-electronic-consent-v1', consent_text: consentText, consent_hash: sha256(Buffer.from(consentText)) });
        await insert(client, 'signature_fields', t, { patient_id: patientId, packet_id: packet.id, field_key: 'patient_signature', page: 1, x: 0.1, y: 0.75, width: 0.5, height: 0.1, field_type: 'signature', required: true });
    }
    const link = await issueGrant(client, t, request);
    const deliveryInput = p.delivery === undefined ? {} : body(p.delivery, ['sendNow']);
    if (deliveryInput.sendNow !== undefined && typeof deliveryInput.sendNow !== 'boolean')
        throw new WorkflowError('INVALID_DELIVERY_OPTION', 422);
    const sendNow = deliveryInput.sendNow === true;
    const delivery = sendNow ? await localDelivery(client, t, request, 'initial') : null;
    return safeResult(request.id, 'open', { revision: 1, localReviewPath: link, ...(delivery ? deliveryReceipt(delivery) : { deliveryState: 'not_requested' }) });
}
export async function operation(t: TenantContext, operationId: string, requestId: string) { return scoped(t, async (client) => { const op = await row(client, 'workflow_operations', t, id(operationId), false); const runs = await client.query('SELECT id,job_type,job_version,attempt,state,started_at,finished_at,failure_code FROM job_runs WHERE operation_id=$1 ORDER BY attempt', [op.id]); await recordWorkflowAudit(client, t, { action: 'operations.read', entityType: 'operation', entityId: op.id, requestId }); return { ...concurrency(op), runs: runs.rows.map(camel) }; }, requestId); }
export async function documentContent(t: TenantContext, versionId: string, requestId: string, purpose = 'view') {
    return scoped(t, async (client) => {
        const v = await row(client, 'document_versions', t, id(versionId), false);
        const d = await row(client, 'documents', t, v.document_id, false);
        const f = await row(client, 'file_objects', t, v.file_object_id, false);
        if (d.archived_at || f.status !== 'available')
            throw new WorkflowError('DOCUMENT_UNAVAILABLE', 409);
        const auditId = await recordWorkflowAudit(client, t, { action: 'documents.access.authorized', entityType: 'document_version', entityId: v.id, requestId, metadata: { purpose }, resources: [{ resourceType: 'document', resourceId: d.id, patientId: v.patient_id }, { resourceType: 'document_version', resourceId: v.id, patientId: v.patient_id }] });
        const grant = await insert(client, 'document_access_grants', t, { patient_id: v.patient_id, document_version_id: v.id, file_object_id: f.id, actor_user_id: t.userId, purpose, expires_at: new Date(Date.now() + 60000), issuing_audit_event_id: auditId });
        const bytes = await readPrivate(f.storage_key);
        if (sha256(bytes) !== f.sha256)
            throw new WorkflowError('STORAGE_INTEGRITY_FAILURE', 503);
        return { bytes, contentType: f.detected_media_type, filename: f.original_filename, grantId: grant.id, versionId: v.id, fileObjectId: f.id, patientId: v.patient_id };
    }, requestId);
}
export async function observeContent(t: TenantContext, result: {
    grantId: string;
    versionId: string;
    fileObjectId: string;
    patientId: string;
}, byteCount: number, success: boolean, requestId: string) { return scoped(t, async (client) => { const auditId = await recordWorkflowAudit(client, t, { action: 'documents.transfer.observed', entityType: 'document_version', entityId: result.versionId, requestId, outcome: success ? 'succeeded' : 'unknown', metadata: { observer: 'gateway', byteCount, result: success ? 'response_completed' : 'disconnected' }, resources: [{ resourceType: 'document_version', resourceId: result.versionId, patientId: result.patientId }] }); await insert(client, 'file_access_observations', t, { patient_id: result.patientId, access_grant_id: result.grantId, file_object_id: result.fileObjectId, document_version_id: result.versionId, observer: 'gateway', provider_event_id: randomUUID(), observed_at: now(), result: success ? 'response_completed' : 'disconnected', bytes_transferred: byteCount, audit_event_id: auditId }); }, requestId); }
// Patient requests use independently validated, request-bound database context, never staff authority.
import { pool } from '../db/client.js';
import { requestKey } from '../workflow/policy.js';
export async function patientTransaction<T>(token: string, isSession: boolean, callback: (client: PoolClient, t: TenantContext, access: any) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token))
        throw new WorkflowError('PATIENT_LINK_UNAVAILABLE', 410);
    const hash = sha256(Buffer.from(token));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serialize one-time exchanges across API processes before resolving an unused grant.
        if (!isSession) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['patient-grant-exchange:' + hash]);
        await client.query("SELECT set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session',$2,true)", [hash, isSession ? 'true' : 'false']);
        const access = (await client.query('SELECT careiq_resolve_patient_access($1,$2) AS context', [hash, isSession])).rows[0]?.context;
        if (!access)
            throw new WorkflowError('PATIENT_LINK_UNAVAILABLE', 410);
        await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [access.practice_id, access.location_id, access.session_id ?? access.grant_id]);
        const t: TenantContext = { practiceId: access.practice_id, locationId: access.location_id, userId: access.session_id ?? access.grant_id, orgId: '' };
        const result = await callback(client, t, access);
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
export async function exchangePatientSession(input: unknown, requestId: string) {
    const p = body(input, ['token']);
    const token = text(p.token, 'token', 100)!;
    return patientTransaction(token, false, async (client, t, access) => {
        const request = await row(client, 'document_requests', t, access.request_id, false);
        const verificationMethod = request.purpose === 'form_completion' ? 'patient_request_link' : 'email_link';
        const sessionToken = randomBytes(32).toString('base64url'), expiresAt = new Date(Math.min(Date.now() + 60 * 60000, new Date(access.expires_at).getTime()));
        const session = await insert(client, 'patient_sessions', t, { patient_id: access.patient_id, request_id: access.request_id, grant_id: access.grant_id, token_hash: sha256(Buffer.from(sessionToken)), request_revision: access.request_revision, expires_at: expiresAt, verification_method: verificationMethod, assurance: 'link_possession' });
        await client.query("SELECT set_config('app.patient_token_hash',$1,true),set_config('app.patient_is_session','true',true)", [sha256(Buffer.from(sessionToken))]);
        await recordWorkflowAudit(client, t, { action: 'patient_sessions.exchanged', entityType: 'patient_session', entityId: session.id, actorType: 'patient_session', requestId, metadata: { verificationMethod, assurance: 'link_possession' }, resources: [{ resourceType: 'request', resourceId: access.request_id, patientId: access.patient_id }] });
        await update(client, 'patient_access_grants', t, access.grant_id, { consumed_at: now() });
        return { sessionToken, requestId: access.request_id, expiresAt: expiresAt.toISOString() };
    });
}
export async function patientRequest(token: string, requestId: string) {
    return patientTransaction(token, true, async (client, t, access) => {
        const request = await row(client, 'document_requests', t, access.request_id, false);
        const packet = (await client.query('SELECT * FROM signature_packets WHERE request_id=$1', [request.id])).rows[0];
        const items = (await client.query('SELECT id,requirement_id,document_type_id,state,source_version_id,fulfilled_version_id FROM document_request_items WHERE request_id=$1', [request.id])).rows;
        let signature = null;
        if (packet) {
            const source = await row(client, 'document_versions', t, packet.source_version_id, false);
            const file = await row(client, 'file_objects', t, source.file_object_id, false);
            const fields = (await client.query('SELECT field_key,field_type,required FROM signature_fields WHERE packet_id=$1 ORDER BY field_key', [packet.id])).rows;
            signature = { packetId: packet.id, revision: Number(packet.revision), sourceSha256: file.sha256, consentText: packet.consent_text, consentTextVersion: packet.consent_text_version, verificationMethod: request.purpose === 'form_completion' ? 'patient_request_link' : 'email_link', assurance: 'link_possession', fields: fields.map(f => ({ key: f.field_key, type: f.field_type === 'signature' ? 'typed_signature' : f.field_type, required: f.required })) };
        }
        await recordWorkflowAudit(client, t, { action: 'patient_requests.read', entityType: 'request', entityId: request.id, actorType: 'patient_session', requestId, resources: [{ resourceType: 'request', resourceId: request.id, patientId: access.patient_id }] });
        const form = request.purpose === 'form_completion' ? await (await import('./patient-paperwork.service.js')).getPatientFormProjection(client,t,access) : null;
        return { id: request.id, purpose: request.purpose, state: request.state, revision: Number(request.revision), recipientName: request.recipient_name, dueAt: request.due_at, expiresAt: request.expires_at, items: items.map(camel), signature, form };
    });
}
export async function patientDocument(token: string, requestId: string) {
    return patientTransaction(token, true, async (client, t, access) => {
        const packet = (await client.query('SELECT * FROM signature_packets WHERE request_id=$1', [access.request_id])).rows[0];
        if (!packet)
            throw new WorkflowError('DOCUMENT_UNAVAILABLE', 404);
        const v = await row(client, 'document_versions', t, packet.source_version_id, false);
        const f = await row(client, 'file_objects', t, v.file_object_id, false);
        if (f.status !== 'available')
            throw new WorkflowError('DOCUMENT_UNAVAILABLE', 409);
        const bytes = await readPrivate(f.storage_key);
        if (sha256(bytes) !== f.sha256)
            throw new WorkflowError('STORAGE_INTEGRITY_FAILURE', 503);
        await recordWorkflowAudit(client, t, { action: 'patient_documents.access_authorized', entityType: 'document_version', entityId: v.id, actorType: 'patient_session', requestId, resources: [{ resourceType: 'document_version', resourceId: v.id, patientId: access.patient_id }] });
        return { bytes, contentType: f.detected_media_type, filename: f.original_filename };
    });
}
export async function patientCompletion(token: string, input: unknown, key: string, requestId: string) {
    key = requestKey(key);
    const p = body(input, ['expectedRevision', 'sourceSha256', 'consent', 'fields']);
    const receipt = (await pool.query('SELECT careiq_patient_completion_receipt($1) AS receipt', [sha256(Buffer.from(token))])).rows[0]?.receipt;
    if (receipt) {
        if (receipt.commandFingerprint !== fingerprint({ key, packetId: receipt.packetId, input: p }))
            throw new WorkflowError('IDEMPOTENCY_KEY_REUSED', 409);
        return { id: receipt.requestId, state: 'completed', operationId: receipt.operationId, documentVersionId: receipt.documentVersionId, staffReviewState: 'pending', certificateSignatureApplied: false };
    }
    return patientTransaction(token, true, async (client, t, access) => {
        const request = await row(client, 'document_requests', t, access.request_id);
        if (!['signature','form_completion'].includes(request.purpose) || request.purpose === 'form_completion' && request.form_completion_policy !== 'form_then_sign')
            throw new WorkflowError('SIGNATURE_REQUEST_REQUIRED', 409);
        if(request.purpose==='form_completion') await (await import('./patient-paperwork.service.js')).requireFormSignerAuthority(client,request.id);
        const packet = (await client.query('SELECT * FROM signature_packets WHERE request_id=$1 FOR UPDATE', [request.id])).rows[0];
        if (!packet) throw new WorkflowError('FORM_REVIEW_NOT_READY',409);
        checkRevision(packet, Number(p.expectedRevision));
        if (packet.state !== 'pending')
            throw new WorkflowError('SIGNATURE_TERMINAL', 409);
        const source = await row(client, 'document_versions', t, packet.source_version_id);
        const sourceFile = await row(client, 'file_objects', t, source.file_object_id);
        const document = await row(client, 'documents', t, source.document_id);
        if (document.archived_at || document.current_version_id !== source.id || sourceFile.status !== 'available' || p.sourceSha256 !== sourceFile.sha256)
            throw new WorkflowError('SIGNATURE_SOURCE_CONFLICT', 409);
        const consent = body(p.consent, ['accepted', 'textVersion']);
        if (consent.accepted !== true || consent.textVersion !== packet.consent_text_version)
            throw new WorkflowError('CONSENT_REQUIRED', 422);
        if (!Array.isArray(p.fields) || !p.fields.length || p.fields.length > 30)
            throw new WorkflowError('INVALID_SIGNATURE_FIELDS', 422);
        const expected = (await client.query('SELECT * FROM signature_fields WHERE packet_id=$1', [packet.id])).rows;
        const keys = new Set<string>();
        const fields = p.fields.map(raw => {
            const f = body(raw, ['key', 'type', 'value']);
            const key = text(f.key, 'key', 64)!;
            const spec = expected.find(e => e.field_key === key);
            if (keys.has(key) || !spec || !(spec.field_type === 'signature' ? ['typed_signature', 'drawn_signature'] : spec.field_type === 'name' ? ['text'] : spec.field_type === 'initials' ? ['typed_signature', 'drawn_signature'] : [spec.field_type]).includes(String(f.type)))
                throw new WorkflowError('INVALID_SIGNATURE_FIELDS', 422);
            keys.add(key);
            const value = text(f.value, 'value', f.type === 'drawn_signature' ? 150000 : 2000)!;
            return { key, type: String(f.type), value };
        });
        if (expected.some(e => e.required && !fields.some(f => f.key === e.field_key)))
            throw new WorkflowError('REQUIRED_SIGNATURE_FIELD', 422);
        const verificationMethod = request.purpose === 'form_completion' ? 'patient_request_link' : 'email_link';
        const evidence = { schemaVersion: request.purpose === 'form_completion' ? 2 : 1, requestId: request.id, packetId: packet.id, sessionId: access.session_id, completedAt: now(), sourceSha256: sourceFile.sha256, consentTextVersion: packet.consent_text_version, consentText: packet.consent_text, consentHash: packet.consent_hash, verificationMethod, assurance: 'link_possession', renderer: 'careiq-electronic-signature-renderer-v1', certificateSignatureApplied: false, fields };
        const sourceBytes = await readPrivate(sourceFile.storage_key);
        if (sha256(sourceBytes) !== sourceFile.sha256)
            throw new WorkflowError('STORAGE_INTEGRITY_FAILURE', 503);
        const output = await renderSigned(sourceBytes, evidence, fields);
        const generated = await createGeneratedDocument(client, t, { patientId: access.patient_id, documentTypeId: document.document_type_id, title: document.title, source: 'signed_output', bytes: output, templateVersionId: source.template_version_id ?? undefined, sourceVersionId: source.id, documentId: document.id, requestId: request.id });
        let authorityDecision: Record<string, unknown> | undefined;
        let authorityAuditId: string | undefined;
        if (request.purpose === 'form_completion') {
            await (await import('./patient-paperwork.service.js')).requireFormSignerAuthority(client, request.id);
            // Retain the local eligibility decision; link possession remains the identity assurance.
            const decision = { policyVersion: 'careiq-adult-self-location-calendar-v1', evaluatedAt: now(), decision: 'eligible', relationship: 'self', minimumAge: 18, maximumAgeExclusive: 130, independentIdentityVerification: false, practiceId: t.practiceId, locationId: t.locationId, patientId: access.patient_id, requestId: request.id, packetId: packet.id, sourceVersionId: source.id, sourceSha256: sourceFile.sha256 };
            authorityAuditId = await recordWorkflowAudit(client, t, { action: 'signatures.authority.verified', entityType: 'signature_packet', entityId: packet.id, actorType: 'patient_session', requestId, authorization: { policyVersion: decision.policyVersion, evaluatedAt: decision.evaluatedAt, decision: decision.decision, independentIdentityVerification: false }, metadata: { policyVersion: decision.policyVersion, result: decision.decision, sourceHash: sourceFile.sha256, requestId: request.id }, resources: [{ resourceType: 'request', resourceId: request.id, patientId: access.patient_id }, { resourceType: 'document_version', resourceId: source.id, patientId: access.patient_id }] });
            authorityDecision = { ...decision, auditEventId: authorityAuditId, decisionHash: fingerprint(decision) };
        }
        const evidenceBytes = Buffer.from(JSON.stringify({ ...evidence, ...(authorityDecision ? { authorityDecision } : {}), outputSha256: sha256(output) }, null, 2)), evidenceId = randomUUID(), evidenceKey = evidenceId + '.json';
        await storePrivate(evidenceKey, evidenceBytes);
        const evidenceObject = await insert(client, 'file_objects', t, { id: evidenceId, patient_id: access.patient_id, request_id: request.id, storage_key: evidenceKey, storage_version: sha256(evidenceBytes), original_filename: 'signature-evidence.json', declared_media_type: 'application/json', detected_media_type: 'application/json', expected_bytes: evidenceBytes.length, actual_bytes: evidenceBytes.length, sha256: sha256(evidenceBytes), status: 'available', upload_expires_at: now(), uploaded_at: now(), verified_at: now(), scan_verdict: 'clean', scan_reference: 'careiq-trusted-evidence-renderer-v1' });
        const operation = await insert(client, 'workflow_operations', t, { patient_request_id: request.id, operation_type: 'signature_completion', initiating_actor_type: 'patient_session', initiating_actor_id: access.session_id, target_type: 'signature_packet', target_id: packet.id, command_fingerprint: fingerprint({ key, packetId: packet.id, input: p }), state: 'succeeded', request_id: requestId, started_at: evidence.completedAt, completed_at: now(), result_type: 'document_version', result_id: generated.version.id });
        const auditId = await recordWorkflowAudit(client, t, { action: 'signatures.completed', entityType: 'signature_packet', entityId: packet.id, actorType: 'patient_session', operationId: operation.id, requestId, ...(authorityAuditId ? { causationEventId: authorityAuditId } : {}), metadata: { sourceHash: sourceFile.sha256, outputHash: sha256(output), consentHash: packet.consent_hash, verificationMethod, assurance: 'link_possession' }, resources: [{ resourceType: 'request', resourceId: request.id, patientId: access.patient_id }, { resourceType: 'document_version', resourceId: generated.version.id, patientId: access.patient_id }] });
        await insert(client, 'job_runs', t, { operation_id: operation.id, job_type: 'signature_completion', job_version: 'careiq-electronic-signature-renderer-v1', attempt: 1, executor_id: 'careiq-local-renderer', fencing_token: randomUUID(), started_at: evidence.completedAt, finished_at: now(), state: 'succeeded', input_references: JSON.stringify({ sourceVersionId: source.id, sourceHash: sourceFile.sha256, consentHash: packet.consent_hash }), output_references: JSON.stringify({ outputVersionId: generated.version.id, outputHash: sha256(output), evidenceObjectId: evidenceObject.id, evidenceHash: sha256(evidenceBytes) }), audit_event_id: auditId });
        for (const field of fields)
            await client.query('UPDATE signature_fields SET entered_value=$2,signed_at=now(),revision=revision+1 WHERE packet_id=$1 AND field_key=$3', [packet.id, field.value, field.key]);
        await insert(client, 'signature_events', t, { patient_id: access.patient_id, packet_id: packet.id, audit_event_id: auditId, event_type: 'completed', actor_type: 'patient_session', actor_id: access.session_id, patient_session_id: access.session_id, source_hash: sourceFile.sha256, consent_hash: packet.consent_hash, evidence_metadata: JSON.stringify({ outputHash: sha256(output), evidenceHash: sha256(evidenceBytes), renderer: 'careiq-electronic-signature-renderer-v1', ...(authorityDecision ? { authorityDecision } : {}) }) });
        await update(client, 'signature_packets', t, packet.id, { state: 'completed', output_version_id: generated.version.id, evidence_object_id: evidenceObject.id, completed_at: now() });
        await client.query("UPDATE document_request_items SET fulfilled_version_id=$2,state='fulfilled',is_open=false,revision=revision+1 WHERE request_id=$1 AND is_open", [request.id, generated.version.id]);
        await (await import('./patient-paperwork.service.js')).publishCompletedPaperwork(client,t,request,generated.version,requestId,{signed:true});
        // This terminal write is last: the restricted DB context ceases to grant access immediately.
        await client.query("SELECT careiq_patient_close_request('completed')");
        return { id: request.id, state: 'completed', operationId: operation.id, documentVersionId: generated.version.id, staffReviewState: 'pending', certificateSignatureApplied: false };
    });
}
export async function patientDecline(token: string, input: unknown, key: string, requestId: string) {
    key = requestKey(key);
    const p = body(input, ['reasonCode']);
    const receipt = (await pool.query('SELECT careiq_patient_command_receipt($1,$2) AS receipt', [sha256(Buffer.from(token)), key])).rows[0]?.receipt;
    if (receipt) {
        if (receipt.operation !== 'patient_requests.decline' || receipt.requestHash !== fingerprint({ sessionId: receipt.sessionId, requestId: receipt.requestId, operation: 'patient_requests.decline', payload: p }))
            throw new WorkflowError('IDEMPOTENCY_KEY_REUSED', 409);
        return receipt.response;
    }
    return patientTransaction(token, true, async (client, t, access) => {
        const result = await patientCommand(client, t, access, key, 'patient_requests.decline', p, async () => {
            const request = await row(client, 'document_requests', t, access.request_id);
            const reason = text(p.reasonCode, 'reasonCode', 80, true);
            await recordWorkflowAudit(client, t, { action: 'patient_requests.declined', entityType: 'request', entityId: request.id, actorType: 'patient_session', requestId, reasonCode: reason ?? 'patient_declined', resources: [{ resourceType: 'request', resourceId: request.id, patientId: access.patient_id }] });
            await client.query("UPDATE document_request_items SET state='cancelled',is_open=false,revision=revision+1 WHERE request_id=$1 AND is_open", [request.id]);
            await client.query("UPDATE signature_packets SET state='declined',revision=revision+1 WHERE request_id=$1 AND state='pending'", [request.id]);
            return { id: request.id, state: 'declined' };
        });
        await client.query("SELECT careiq_patient_close_request('declined')");
        return result;
    });
}
export async function patientCommand<T extends Record<string, unknown>>(client: QueryClient, t: TenantContext, access: any, key: string, operation: string, payload: unknown, callback: () => Promise<T>): Promise<T> {
    key = requestKey(key);
    const requestHash = fingerprint({ sessionId: access.session_id, requestId: access.request_id, operation, payload });
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [access.session_id + ':' + key]);
    const previous = (await client.query('SELECT request_hash,response FROM workflow_request_keys WHERE practice_id=$1 AND location_id=$2 AND actor_user_id=$3 AND request_key=$4', [...scope(t), access.session_id, key])).rows[0];
    if (previous) {
        if (previous.request_hash !== requestHash)
            throw new WorkflowError('IDEMPOTENCY_KEY_REUSED', 409);
        return previous.response as T;
    }
    const result = await callback();
    await client.query('INSERT INTO workflow_request_keys(practice_id,location_id,actor_user_id,request_key,request_hash,operation,target_id,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [...scope(t), access.session_id, key, requestHash, operation, access.request_id, JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'upload')))]);
    return result;
}
export async function patientUploadReservation(token: string, input: unknown, key: string, requestId: string) {
    const p = body(input, ['requirementId', 'file']);
    return patientTransaction(token, true, async (client, t, access) => patientCommand(client, t, access, key, 'patient_upload.reservation', p, async () => {
        const request = await row(client, 'document_requests', t, access.request_id);
        if (!['collection','replacement'].includes(request.purpose))
            throw new WorkflowError('COLLECTION_REQUEST_REQUIRED', 409);
        const item = (await client.query('SELECT * FROM document_request_items WHERE request_id=$1 AND requirement_id=$2 AND is_open FOR UPDATE', [request.id, id(p.requirementId)])).rows[0];
        if (!item)
            throw new WorkflowError('REQUEST_ITEM_UNAVAILABLE', 404);
        const result = await reserveUpload(client, t, access.patient_id, { documentTypeId: item.document_type_id, file: p.file }, request.id, access.session_id);
        await client.query('UPDATE document_request_items SET source_version_id=$2,revision=revision+1 WHERE id=$1', [item.id, result.documentVersionId]);
        await recordWorkflowAudit(client, t, { action: 'patient_uploads.reserved', entityType: 'upload_session', entityId: result.id, actorType: 'patient_session', requestId, resources: [{ resourceType: 'request', resourceId: request.id, patientId: access.patient_id }, { resourceType: 'document_version', resourceId: String(result.documentVersionId), patientId: access.patient_id }] });
        return { ...result, upload: { ...(result.upload as Record<string, unknown>), url: `/api/v1/patient-workflows/uploads/${result.id}/content` } };
    }));
}
export async function patientUploadContent(token: string, sessionId: string, bytes: Buffer, requestId: string) {
    return patientTransaction(token, true, async (client, t, access) => {
        const request = await row(client,'document_requests',t,access.request_id);
        if (!['collection','replacement'].includes(request.purpose)) throw new WorkflowError('COLLECTION_REQUEST_REQUIRED',409);
        const session = await row(client, 'upload_sessions', t, id(sessionId));
        if (session.patient_session_id !== access.session_id || session.request_id !== access.request_id)
            throw new WorkflowError('UPLOAD_UNAVAILABLE', 404);
        const object = await row(client, 'file_objects', t, session.file_object_id);
        if (session.completed_at || new Date(session.expires_at) <= new Date())
            throw new WorkflowError('UPLOAD_EXPIRED', 410);
        if (bytes.length !== Number(session.declared_size_bytes) || bytes.length > maximumFileBytes || sha256(bytes) !== session.declared_sha256 || detectType(bytes) !== session.declared_media_type)
            throw new WorkflowError('UPLOAD_INTEGRITY_MISMATCH', 422);
        await storePrivate(object.storage_key, bytes);
        if (object.status === 'reserved')
            await update(client, 'file_objects', t, object.id, { status: 'uploaded', uploaded_at: now(), actual_bytes: bytes.length, sha256: sha256(bytes), detected_media_type: detectType(bytes), storage_version: sha256(bytes) });
        await recordWorkflowAudit(client, t, { action: 'patient_uploads.bytes.received', entityType: 'upload_session', entityId: session.id, actorType: 'patient_session', requestId, metadata: { byteCount: bytes.length, sourceHash: sha256(bytes) }, resources: [{ resourceType: 'request', resourceId: access.request_id, patientId: access.patient_id }] });
        return safeResult(session.id, 'uploaded');
    });
}
export async function patientUploadCompletion(token: string, sessionId: string, input: unknown, key: string, requestId: string) {
    key = requestKey(key);
    const p = body(input, ['sha256', 'sizeBytes']);
    const receipt = (await pool.query('SELECT careiq_patient_command_receipt($1,$2) AS receipt', [sha256(Buffer.from(token)), key])).rows[0]?.receipt;
    if (receipt) {
        if (receipt.operation !== 'patient_upload.completion' || receipt.requestHash !== fingerprint({ sessionId: receipt.sessionId, requestId: receipt.requestId, operation: 'patient_upload.completion', payload: { sessionId, input: p } }))
            throw new WorkflowError('IDEMPOTENCY_KEY_REUSED', 409);
        return { ...receipt.response, requestState: 'completed', staffReviewState: 'pending' };
    }
    return patientTransaction(token, true, async (client, t, access) => {
        const result = await patientCommand(client, t, access, key, 'patient_upload.completion', { sessionId, input: p }, async () => {
            const request = await row(client,'document_requests',t,access.request_id);
            if (!['collection','replacement'].includes(request.purpose)) throw new WorkflowError('COLLECTION_REQUEST_REQUIRED',409);
            const session = await row(client, 'upload_sessions', t, id(sessionId));
            if (session.patient_session_id !== access.session_id || session.request_id !== access.request_id)
                throw new WorkflowError('UPLOAD_UNAVAILABLE', 404);
            const result = await completeUpload(client, t, session.id, p, { requestId, idempotencyKey: key }, access.request_id);
            if (result.state === 'available') {
                const item = (await client.query('SELECT * FROM document_request_items WHERE request_id=$1 AND source_version_id=$2 AND is_open FOR UPDATE', [access.request_id, result.documentVersionId])).rows[0];
                if (!item)
                    throw new WorkflowError('REQUEST_ITEM_UNAVAILABLE', 404);
                await client.query('SELECT careiq_patient_fulfill_item($1,$2)', [item.id, result.documentVersionId]);
            }
            return result;
        });
        const remaining = await client.query("SELECT id FROM document_request_items WHERE request_id=$1 AND state<>'fulfilled'", [access.request_id]);
        if (!remaining.rowCount) {
            await recordWorkflowAudit(client, t, { action: 'patient_requests.completed', entityType: 'request', entityId: access.request_id, actorType: 'patient_session', requestId, resources: [{ resourceType: 'request', resourceId: access.request_id, patientId: access.patient_id }] });
            await client.query("SELECT careiq_patient_close_request('completed')");
            return { ...result, requestState: 'completed', staffReviewState: 'pending' };
        }
        return result;
    });
}
export async function providerAvailability(t: TenantContext, providerId: string, requestId: string) {
    return scoped(t, async (client) => {
        const provider = await row(client, 'providers', t, id(providerId), false, true);
        const assignment = (await client.query('SELECT * FROM provider_locations WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3', [...scope(t), provider.id])).rows[0];
        const rules = (await client.query('SELECT * FROM provider_availability_rules WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active ORDER BY iso_weekday,starts_at_local', [...scope(t), provider.id])).rows;
        const exceptions = (await client.query('SELECT * FROM provider_availability_exceptions WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND active ORDER BY starts_at', [...scope(t), provider.id])).rows;
        await recordWorkflowAudit(client, t, { action: 'providers.availability.read', entityType: 'provider', entityId: provider.id, requestId });
        return { provider: concurrency(provider), assignment: assignment ? concurrency(assignment) : null, rules: rules.map(concurrency), exceptions: exceptions.map(concurrency) };
    }, requestId);
}
export async function editState(t: TenantContext, resource: string, entityId: string, requestId: string) {
    return scoped(t, async (client) => {
        const tables: Record<string, {
            table: string;
            fields: string[];
            practice?: boolean;
        }> = { patients: { table: 'patients', fields: ['id', 'first_name', 'last_name', 'preferred_name', 'email', 'phone', 'date_of_birth', 'archived_at', 'revision'] }, appointments: { table: 'appointments', fields: ['id', 'patient_id', 'provider_id', 'scheduled_at', 'ends_at', 'visit_type_id', 'reason', 'status', 'revision'] }, documents: { table: 'documents', fields: ['id', 'title', 'document_type_id', 'current_version_id', 'archived_at', 'revision'] }, templates: { table: 'document_templates', practice: true, fields: ['id', 'title', 'document_type_id', 'active', 'published_version_id', 'revision'] } };
        const config = tables[resource];
        if (!config)
            throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
        const record = await row(client, config.table, t, id(entityId), false, config.practice);
        const data = Object.fromEntries(config.fields.map(field => [field, record[field]]));
        await recordWorkflowAudit(client, t, { action: resource + '.edit_state.read', entityType: resource, entityId: record.id, requestId, resources: record.patient_id ? [{ resourceType: resource, resourceId: record.id, patientId: record.patient_id }] : resource === 'patients' ? [{ resourceType: 'patient', resourceId: record.id, patientId: record.id }] : [] });
        return concurrency(data);
    }, requestId);
}
export async function locationDate(t: TenantContext) {
    return scoped(t, async (client) => {
        const zone = (await client.query('SELECT time_zone FROM locations WHERE practice_id=$1 AND id=$2', scope(t))).rows[0]?.time_zone;
        if (!zone)
            throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
        return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    });
}


async function checkFormPublication(client:QueryClient,t:TenantContext,version:Record<string,any>,requestId:string){
    const authoring=authoringFromVersion(version),schemaHash=authoringHash(version,authoring); const {answers}=validateFormAnswers(authoring,{},false);
    const bytes=await renderFormTemplate(authoring.schemaVersion===2 ? (authoring.formSchema as FormSchema).documentTitle ?? 'Template preview' : 'Template preview',version.content,authoring,answers); if(bytes.length>maximumFileBytes)throw new WorkflowError('TEMPLATE_OUTPUT_TOO_LARGE',422);
    await insert(client,'template_publication_checks',t,{template_version_id:version.id,draft_revision:Number(version.revision),schema_hash:schemaHash,ruleset_version:'careiq-form-publication-v2',results:JSON.stringify({valid:true,issues:[],previewRendered:true}),checked_by_actor_id:t.userId},true);
    await recordWorkflowAudit(client,t,{action:'templates.validation.checked',entityType:'template_version',entityId:version.id,requestId,metadata:{revision:Number(version.revision),sourceHash:schemaHash}});
    return {valid:true,issues:[],templateVersionId:version.id,draftRevision:Number(version.revision),schemaHash};
}
export async function templatePreview(t:TenantContext,versionId:string,input:unknown,expectedRevision:number,requestId:string){
    const p=body(input,['answers']);return scoped(t,async client=>{const version=await row(client,'template_versions',t,id(versionId),false,true);checkRevision(version,expectedRevision);const authoring=authoringFromVersion(version),{answers}=validateFormAnswers(authoring,p.answers ?? {},false),bytes=await renderFormTemplate(authoring.schemaVersion===2 ? (authoring.formSchema as FormSchema).documentTitle ?? 'Template preview' : 'Template preview',version.content,authoring,answers);if(bytes.length>maximumFileBytes)throw new WorkflowError('TEMPLATE_OUTPUT_TOO_LARGE',422);await recordWorkflowAudit(client,t,{action:'templates.preview.authorized',entityType:'template_version',entityId:version.id,requestId,metadata:{revision:Number(version.revision),byteCount:bytes.length}});return {bytes,contentType:'application/pdf',filename:'template-preview.pdf'};},requestId);
}

export async function freezePrepared(client:QueryClient,t:TenantContext,prepared:Record<string,any>,context:{requestId:string;patientRequestId?:string}){
    if(!['draft','preparing'].includes(prepared.state))throw new WorkflowError('PREPARED_DOCUMENT_FROZEN',409);
    const version=await row(client,'template_versions',t,prepared.template_version_id,false,true);if(version.state!=='published' && !(context.patientRequestId && version.state==='retired'))throw new WorkflowError('TEMPLATE_NOT_PUBLISHED',409);
    const template=await row(client,'document_templates',t,version.template_id,false,true),authoring=authoringFromVersion(version),evaluated=validateFormAnswers(authoring,prepared.answers,true);
    const documentTitle=authoring.schemaVersion===2 ? (authoring.formSchema as FormSchema).documentTitle ?? template.title : template.title;
    const bytes=await renderFormTemplate(documentTitle,version.content,authoring,evaluated.answers);if(bytes.length>maximumFileBytes)throw new WorkflowError('TEMPLATE_OUTPUT_TOO_LARGE',422);
    const created=await createGeneratedDocument(client,t,{patientId:prepared.patient_id,documentTypeId:template.document_type_id,title:documentTitle,source:'template_generated',templateVersionId:version.id,bytes,requestId:context.patientRequestId,structuredAnswers:evaluated.answers,answersSchemaVersion:authoring.schemaVersion,rendererReference:'careiq-guided-form-renderer-v2'});
    if(sha256(await readPrivate(created.file.storage_key))!==created.file.sha256)throw new WorkflowError('STORAGE_INTEGRITY_FAILURE',503);
    const submission=await insert(client,'form_submissions',t,{patient_id:prepared.patient_id,prepared_document_id:prepared.id,template_version_id:version.id,request_id:context.patientRequestId ?? null,document_version_id:created.version.id,schema_version:authoring.schemaVersion,answers:JSON.stringify(evaluated.answers),active_field_keys:JSON.stringify(evaluated.activeFieldKeys),ruleset_version:evaluated.rulesetVersion,schema_hash:authoringHash(version,authoring),answers_hash:fingerprint(evaluated.answers),locale:authoring.schemaVersion===2 ? (authoring.formSchema as FormSchema).defaultLocale : 'en',submitted_by_actor_id:t.userId});
    const bindings=(await client.query('SELECT * FROM template_field_bindings WHERE template_version_id=$1 AND practice_id=$2',[version.id,t.practiceId])).rows;
    for(const binding of bindings)if(Object.hasOwn(evaluated.answers,binding.field_key)){
        const value=JSON.stringify(evaluated.answers[binding.field_key]);
        if(context.patientRequestId) await client.query('INSERT INTO form_change_candidates(practice_id,location_id,patient_id,submission_id,binding_id,request_id,proposed_value) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[t.practiceId,t.locationId,prepared.patient_id,submission.id,binding.id,context.patientRequestId,value]);
        else await insert(client,'form_change_candidates',t,{patient_id:prepared.patient_id,submission_id:submission.id,binding_id:binding.id,request_id:null,proposed_value:value});
    }
    await update(client,'prepared_documents',t,prepared.id,{answers:JSON.stringify(evaluated.answers),state:'ready',rendered_source_version_id:created.version.id});
    await recordWorkflowAudit(client,t,{action:'forms.submission.frozen',entityType:'form_submission',entityId:submission.id,requestId:context.requestId,resources:[{resourceType:'form_submission',resourceId:submission.id,patientId:prepared.patient_id},{resourceType:'document_version',resourceId:created.version.id,patientId:prepared.patient_id}],metadata:{sourceHash:submission.schema_hash,outputHash:created.file.sha256,templateVersionId:version.id},changes:[{resourceType:'form_submission',resourceId:submission.id,fieldPath:'answers',captureMode:'protected_reference',protectedReference:submission.id}]});
    return {...created,submission};
}

function authoringWithTitle(schemaVersion:unknown,fields:unknown,schema:unknown,title:string){const authoring=validateAuthoring(schemaVersion,fields,schema);if(authoring.schemaVersion===2)(authoring.formSchema as FormSchema).documentTitle=title;return authoring;}
