import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { TenantContext } from '../middleware/tenant-context.js';
import { camel, checkRevision, concurrency, id, instant, WorkflowError } from '../workflow/policy.js';
import { caseInput, coverageInput, evidenceInput, followUpInput, cursorToken, insuranceCursorFor, insuranceCursorFrom, type InsuranceRange } from '../workflow/insurance-policy.js';
import { command, row, scoped, type CommandContext } from '../workflow/transaction.js';
import { recordWorkflowAudit, recordWorkflowFailure, type WorkflowAuditResource } from './workflow-audit.js';
export { recordWorkflowFailure };
const scope = (tenant: TenantContext) => [tenant.practiceId, tenant.locationId];
const resources = (record: Record<string, any>, evidenceId?: string): WorkflowAuditResource[] => [
    { resourceType: 'insurance_case', resourceId: record.id, patientId: record.patient_id, relationship: 'primary' },
    { resourceType: 'patient', resourceId: record.patient_id, patientId: record.patient_id },
    { resourceType: 'appointment', resourceId: record.appointment_id, patientId: record.patient_id },
    ...(evidenceId ? [{ resourceType: 'insurance_evidence', resourceId: evidenceId, patientId: record.patient_id, relationship: 'evidence' as const }] : []),
];
const staleEvidence = `(c.current_evidence_id IS NOT NULL AND (e.id IS NULL OR e.scheduled_at_snapshot IS NULL OR e.scheduled_at_snapshot IS DISTINCT FROM a.scheduled_at OR e.observed_at<now()-interval '7 days'))`;
const effectiveState = `CASE WHEN ${staleEvidence} THEN 'needs_follow_up' ELSE c.state END`;
const caseSelect = `SELECT c.*,c.state AS recorded_state,${effectiveState} AS state,${staleEvidence} AS stale,CASE WHEN c.current_evidence_id IS NULL THEN 'unverified' WHEN ${staleEvidence} THEN 'stale' ELSE 'current' END AS review_state,CASE WHEN c.current_evidence_id IS NULL THEN NULL WHEN e.id IS NULL OR e.scheduled_at_snapshot IS NULL THEN 'evidence_missing' WHEN e.scheduled_at_snapshot IS DISTINCT FROM a.scheduled_at THEN 'appointment_changed' WHEN e.observed_at<now()-interval '7 days' THEN 'observation_expired' ELSE NULL END AS review_reason,concat_ws(' ',COALESCE(NULLIF(p.preferred_name,''),p.first_name),p.last_name) AS patient_name,to_char(a.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS seek_time,a.scheduled_at,a.status AS appointment_status FROM insurance_cases c JOIN patients p ON p.id=c.patient_id AND p.practice_id=c.practice_id AND p.location_id=c.location_id JOIN appointments a ON a.id=c.appointment_id AND a.practice_id=c.practice_id AND a.location_id=c.location_id LEFT JOIN insurance_evidence e ON e.id=c.current_evidence_id AND e.case_id=c.id AND e.practice_id=c.practice_id AND e.location_id=c.location_id`;

function presentCase(record: Record<string, any>) {
    const { member_id, practice_id, location_id, seek_time, ...safe } = record;
    return concurrency({ ...safe, member_id_masked: member_id ? '••••' + (String(member_id).length > 4 ? String(member_id).slice(-4) : '') : null });
}
function presentEvidence(record: Record<string, any>) { const { practice_id, location_id, patient_id, appointment_id, seek_time, member_id_snapshot, ...safe } = record; return camel({ ...safe, ...(record.outcome !== 'active' ? { copay_cents: null, deductible_remaining_cents: null, coinsurance_percent: null } : {}), member_id_masked_snapshot: member_id_snapshot ? '••••' + (String(member_id_snapshot).length > 4 ? String(member_id_snapshot).slice(-4) : '') : null }); }
async function caseRecord(client: PoolClient, tenant: TenantContext, caseId: string) {
    const result = await client.query(`${caseSelect} WHERE c.id=$3 AND c.practice_id=$1 AND c.location_id=$2`, [...scope(tenant), caseId]);
    if (!result.rows[0]) throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
    return result.rows[0];
}
async function location(client: PoolClient, tenant: TenantContext) { return (await client.query('SELECT time_zone,now() AS as_of FROM locations WHERE practice_id=$1 AND id=$2', scope(tenant))).rows[0]!; }
async function authorizedAssignee(client: PoolClient, tenant: TenantContext, userId: string | null) {
    if (userId === null) return;
    const result = await client.query("SELECT m.user_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.user_id=$3 AND m.status='active' AND a.active FOR SHARE OF m,a", [...scope(tenant), userId]);
    if (!result.rowCount) throw new WorkflowError('ASSIGNEE_UNAVAILABLE', 422);
}
const rangeClause = `a.scheduled_at >= ($3::date::timestamp AT TIME ZONE $5) AND a.scheduled_at < (($4::date+1)::timestamp AT TIME ZONE $5) AND a.status NOT IN ('cancelled','no_show')`;
export async function listCases(tenant: TenantContext, range: InsuranceRange, requestId: string) {
    return scoped(tenant, async client => {
        const context = await location(client, tenant);
        const values: unknown[] = [...scope(tenant), range.from, range.to, context.time_zone];
        const binding = { kind: 'cases', from: range.from, to: range.to, limit: range.limit };
        const cursor = insuranceCursorFrom(range.cursor, tenant, binding);
        let seek = '';
        if (cursor) { values.push(cursor.time, cursor.id); seek = ' AND (a.scheduled_at,c.id)>($6::timestamptz,$7::uuid)'; }
        values.push(range.limit + 1);
        const result = await client.query(`${caseSelect} WHERE c.practice_id=$1 AND c.location_id=$2 AND ${rangeClause}${seek} ORDER BY a.scheduled_at,c.id LIMIT $${values.length}`, values);
        const items = result.rows.slice(0, range.limit), last = items.at(-1), hasMore = result.rows.length > range.limit;
        await recordWorkflowAudit(client, tenant, { action: 'insurance.cases.list', entityType: 'insurance_case', requestId, resources: items.flatMap(record => resources(record)), metadata: { count: items.length, purpose: 'service_dates:' + range.from + '/' + range.to } });
        return { items: items.map(presentCase), pagination: { hasMore, nextCursor: hasMore && last ? insuranceCursorFor({ time: last.seek_time, id: last.id }, tenant, binding) : null }, from: range.from, to: range.to, timeZone: context.time_zone, asOf: context.as_of.toISOString(), payerConnection: 'unavailable' };
    }, requestId, true);
}
type Seek = { limit: number; cursor?: string };
export function historyOptions(query: Record<string, unknown>): Seek {
    if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) throw new WorkflowError('INVALID_QUERY');
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if ((query.limit !== undefined && typeof query.limit !== 'string') || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new WorkflowError('INVALID_PAGINATION');
    return { limit, ...(query.cursor !== undefined ? { cursor: cursorToken(query.cursor) } : {}) };
}
function page(rows: Record<string, any>[], options: Seek, tenant: TenantContext, binding: Record<string, unknown>) {
    const items = rows.slice(0, options.limit), last = items.at(-1), hasMore = rows.length > options.limit;
    return { items, pagination: { hasMore, nextCursor: hasMore && last ? insuranceCursorFor({ time: last.seek_time, id: last.id }, tenant, binding) : null } };
}
async function evidenceRows(client: PoolClient, tenant: TenantContext, caseId: string, options: Seek) {
    const binding = { kind: 'evidence', caseId, limit: options.limit }, cursor = insuranceCursorFrom(options.cursor, tenant, binding);
    const result = await client.query(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS seek_time FROM insurance_evidence WHERE practice_id=$1 AND location_id=$2 AND case_id=$3 AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT $6`, [...scope(tenant), caseId, cursor?.time ?? null, cursor?.id ?? null, options.limit + 1]);
    return page(result.rows, options, tenant, binding);
}

export async function caseDetail(tenant: TenantContext, caseId: string, requestId: string) {
    return scoped(tenant, async client => {
        const record = await caseRecord(client, tenant, id(caseId)), history = await evidenceRows(client, tenant, record.id, { limit: 50 });
        await recordWorkflowAudit(client, tenant, { action: 'insurance.case.read', entityType: 'insurance_case', entityId: record.id, requestId, resources: [...resources(record), ...history.items.map(item => ({ resourceType: 'insurance_evidence', resourceId: item.id, patientId: record.patient_id, relationship: 'evidence' as const }))], metadata: { count: history.items.length } });
        return { case: presentCase(record), evidence: history.items.map(presentEvidence), evidencePagination: history.pagination };
    }, requestId, true);
}
export async function evidenceHistory(tenant: TenantContext, caseId: string, options: Seek, requestId: string) {
    return scoped(tenant, async client => {
        const record = await caseRecord(client, tenant, id(caseId)), result = await evidenceRows(client, tenant, record.id, options);
        await recordWorkflowAudit(client, tenant, { action: 'insurance.evidence.list', entityType: 'insurance_case', entityId: record.id, requestId, resources: [...resources(record), ...result.items.map(item => ({ resourceType: 'insurance_evidence', resourceId: item.id, patientId: record.patient_id, relationship: 'evidence' as const }))], metadata: { count: result.items.length } });
        return { items: result.items.map(presentEvidence), pagination: result.pagination };
    }, requestId, true);
}
export async function createCase(tenant: TenantContext, raw: unknown, context: CommandContext) {
    const input = caseInput(raw);
    return command(tenant, 'insurance.cases.create', input.appointmentId, input, context, async client => {
        const appointment = await row(client, 'appointments', tenant, input.appointmentId);
        const patient = await row(client, 'patients', tenant, appointment.patient_id);
        if (patient.archived_at || ['cancelled', 'no_show', 'completed'].includes(appointment.status)) throw new WorkflowError('APPOINTMENT_NOT_ELIGIBLE', 409);
        await authorizedAssignee(client, tenant, input.assigneeUserId);
        const caseId = randomUUID(), record = { id: caseId, patient_id: patient.id, appointment_id: appointment.id };
        await recordWorkflowAudit(client, tenant, { action: 'insurance.case.created', entityType: 'insurance_case', entityId: caseId, requestId: context.requestId, resources: resources(record), metadata: { revision: 1, toState: 'unverified' }, changes: [{ resourceType: 'insurance_case', resourceId: caseId, fieldPath: 'coverage', captureMode: 'changed_only' }] });
        await client.query('INSERT INTO insurance_cases(id,practice_id,location_id,patient_id,appointment_id,payer_name,member_id,assignee_user_id,due_at,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [caseId, ...scope(tenant), patient.id, appointment.id, input.payerName, input.memberId, input.assigneeUserId, input.dueAt, tenant.userId]);
        return { id: caseId, revision: 1, state: 'unverified' };
    });
}
export async function addEvidence(tenant: TenantContext, caseId: string, raw: unknown, context: CommandContext) {
    caseId = id(caseId); const input = evidenceInput(raw);
    return command(tenant, 'insurance.evidence.create', caseId, input, context, async client => {
        const record = await row(client, 'insurance_cases', tenant, caseId); checkRevision(record, context.expectedRevision);
        if (input.supersedesEvidenceId && input.supersedesEvidenceId !== record.current_evidence_id) throw new WorkflowError('EVIDENCE_NOT_CURRENT', 409);
        const appointment = (await client.query("SELECT scheduled_at::text AS exact_scheduled_at FROM appointments WHERE id=$3 AND practice_id=$1 AND location_id=$2 FOR SHARE", [...scope(tenant), record.appointment_id])).rows[0];
        if (!appointment) throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
        const evidenceId = randomUUID(), nextRevision = Number(record.revision) + 1;
        const eventId = await recordWorkflowAudit(client, tenant, { action: input.supersedesEvidenceId ? 'insurance.evidence.corrected' : 'insurance.evidence.recorded', entityType: 'insurance_case', entityId: caseId, requestId: context.requestId, reasonCode: input.reasonCode, resources: resources(record, evidenceId), metadata: { previousRevision: Number(record.revision), revision: nextRevision, fromState: record.state, toState: input.outcome, channel: input.source }, changes: [{ resourceType: 'insurance_case', resourceId: caseId, fieldPath: 'state', captureMode: 'value', before: record.state, after: input.outcome }, { resourceType: 'insurance_evidence', resourceId: evidenceId, fieldPath: 'benefits', captureMode: 'protected_reference', protectedReference: evidenceId }] });
        await client.query('INSERT INTO insurance_evidence(id,practice_id,location_id,patient_id,appointment_id,case_id,source,observed_at,reference,outcome,copay_cents,deductible_remaining_cents,coinsurance_percent,reason_code,supersedes_evidence_id,created_by_actor_id,audit_event_id,payer_name_snapshot,member_id_snapshot,scheduled_at_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)', [evidenceId, ...scope(tenant), record.patient_id, record.appointment_id, caseId, input.source, input.observedAt, input.reference, input.outcome, input.copayCents, input.deductibleRemainingCents, input.coinsurancePercent, input.reasonCode, input.supersedesEvidenceId, tenant.userId, eventId, record.payer_name, record.member_id, appointment.exact_scheduled_at]);
        await client.query('UPDATE insurance_cases SET state=$4,current_evidence_id=$5,revision=revision+1,updated_at=now() WHERE id=$3 AND practice_id=$1 AND location_id=$2', [...scope(tenant), caseId, input.outcome, evidenceId]);
        return { id: caseId, revision: nextRevision, state: input.outcome, evidenceId };
    });
}
export async function reviseFollowUp(tenant: TenantContext, caseId: string, raw: unknown, context: CommandContext) {
    caseId = id(caseId); const input = followUpInput(raw);
    return command(tenant, 'insurance.follow-up.update', caseId, input, context, async client => {
        const record = await row(client, 'insurance_cases', tenant, caseId); checkRevision(record, context.expectedRevision);
        await authorizedAssignee(client, tenant, input.assigneeUserId);
        const nextRevision = Number(record.revision) + 1;
        await recordWorkflowAudit(client, tenant, { action: 'insurance.follow_up.revised', entityType: 'insurance_case', entityId: caseId, requestId: context.requestId, reasonCode: input.reasonCode, resources: resources(record), metadata: { previousRevision: Number(record.revision), revision: nextRevision }, changes: [{ resourceType: 'insurance_case', resourceId: caseId, fieldPath: 'assigneeUserId', captureMode: 'value', before: record.assignee_user_id, after: input.assigneeUserId }, { resourceType: 'insurance_case', resourceId: caseId, fieldPath: 'dueAt', captureMode: 'value', before: record.due_at, after: input.dueAt }] });
        await client.query('UPDATE insurance_cases SET assignee_user_id=$4,due_at=$5,revision=revision+1,updated_at=now() WHERE id=$3 AND practice_id=$1 AND location_id=$2', [...scope(tenant), caseId, input.assigneeUserId, input.dueAt]);
        return { id: caseId, revision: nextRevision, state: record.state };
    });
}
export async function assignees(tenant: TenantContext, requestId: string) {
    return scoped(tenant, async client => {
        const result = await client.query("SELECT m.user_id FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=$1 AND a.location_id=$2 AND m.status='active' AND a.active ORDER BY m.user_id LIMIT 501", scope(tenant));
        if (result.rows.length > 500) throw new WorkflowError('TEAM_TOO_LARGE', 409);
        await recordWorkflowAudit(client, tenant, { action: 'insurance.assignees.read', entityType: 'location_team', requestId, metadata: { count: result.rows.length } });
        return camel(result.rows);
    }, requestId, true);
}
async function managerRead(tenant: TenantContext, range: InsuranceRange, requestId: string, exportOnly = false) {
    return scoped(tenant, async client => {
        const context = await location(client, tenant), values = [...scope(tenant), range.from, range.to, context.time_zone];
        const scopedAppointments = `FROM appointments a LEFT JOIN insurance_cases c ON c.appointment_id=a.id AND c.practice_id=a.practice_id AND c.location_id=a.location_id LEFT JOIN insurance_evidence e ON e.id=c.current_evidence_id AND e.case_id=c.id AND e.practice_id=c.practice_id AND e.location_id=c.location_id WHERE a.practice_id=$1 AND a.location_id=$2 AND ${rangeClause}`;
        const result = (await client.query(`SELECT count(*) AS appointments,count(c.id) AS tracked,count(*) FILTER(WHERE c.id IS NULL) AS untracked,count(*) FILTER(WHERE (${effectiveState})='unverified') AS unverified,count(*) FILTER(WHERE (${effectiveState})='active') AS active,count(*) FILTER(WHERE (${effectiveState})='inactive') AS inactive,count(*) FILTER(WHERE (${effectiveState})='needs_follow_up') AS needs_follow_up,count(*) FILTER(WHERE (${effectiveState})<>'active' AND c.due_at<now()) AS overdue,count(*) FILTER(WHERE (${effectiveState})<>'active' AND c.assignee_user_id IS NULL) AS unassigned,count(*) FILTER(WHERE ${staleEvidence}) AS stale ${scopedAppointments}`, values)).rows[0]!;
        const team = exportOnly ? { rows: [] } : await client.query(`SELECT c.assignee_user_id AS user_id,count(*) AS open_cases,count(*) FILTER(WHERE c.due_at<now()) AS overdue_cases ${scopedAppointments} AND c.id IS NOT NULL AND (${effectiveState})<>'active' GROUP BY c.assignee_user_id ORDER BY c.assignee_user_id NULLS LAST LIMIT 501`, values);
        if (team.rows.length > 500) throw new WorkflowError('TEAM_TOO_LARGE', 409);
        await recordWorkflowAudit(client, tenant, { action: exportOnly ? 'manager.summary.export_authorized' : 'manager.dashboard.read', entityType: 'manager_dashboard', requestId, metadata: { count: Number(result.appointments), resourceCount: Number(result.tracked), purpose: 'service_dates:' + range.from + '/' + range.to } });
        const summary = camel(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Number(value)])));
        return { from: range.from, to: range.to, timeZone: context.time_zone, asOf: context.as_of.toISOString(), summary, team: team.rows.map(row => ({ userId: row.user_id, openCases: Number(row.open_cases), overdueCases: Number(row.overdue_cases) })), payerConnection: 'unavailable' };
    }, requestId, true);
}
export async function managerSummary(tenant: TenantContext, range: InsuranceRange, requestId: string) { return managerRead(tenant, range, requestId); }
export async function exportManagerSummary(tenant: TenantContext, range: InsuranceRange, requestId: string) {
    if (range.cursor || range.limit !== 50) throw new WorkflowError('INVALID_QUERY');
    const { from, to, asOf, timeZone, summary } = await managerRead(tenant, range, requestId, true);
    return { from, to, asOf, timeZone, summary };
}
export async function caseActivity(tenant: TenantContext, caseId: string, options: Seek, requestId: string) {
    return scoped(tenant, async client => {
        const record = await caseRecord(client, tenant, id(caseId));
        await recordWorkflowAudit(client, tenant, { action: 'insurance.activity.read', entityType: 'insurance_case', entityId: record.id, requestId, resources: resources(record), metadata: { count: options.limit } });
        const binding = { kind: 'activity', caseId: record.id, limit: options.limit }, cursor = insuranceCursorFrom(options.cursor, tenant, binding);
        const result = await client.query(`SELECT *,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS seek_time FROM audit.insurance_activity($1::uuid,$2::integer,$3::timestamptz,$4::uuid)`, [record.id, options.limit + 1, cursor?.time ?? null, cursor?.id ?? null]);
        const history = page(result.rows, options, tenant, binding);
        return { items: camel(history.items.map(({seek_time,...safe}) => safe)), pagination: history.pagination };
    }, requestId, true);
}

export async function reviseCoverage(tenant: TenantContext, caseId: string, raw: unknown, context: CommandContext) {
    caseId = id(caseId); const input = coverageInput(raw);
    return command(tenant, 'insurance.coverage.update', caseId, input, context, async client => {
        const record = await row(client, 'insurance_cases', tenant, caseId); checkRevision(record, context.expectedRevision);
        const nextRevision = Number(record.revision) + 1;
        await recordWorkflowAudit(client, tenant, { action: 'insurance.coverage.revised', entityType: 'insurance_case', entityId: caseId, requestId: context.requestId, reasonCode: input.reasonCode, resources: resources(record), metadata: { previousRevision: Number(record.revision), revision: nextRevision, fromState: record.state, toState: 'unverified' }, changes: [{ resourceType: 'insurance_case', resourceId: caseId, fieldPath: 'coverage', captureMode: 'changed_only' }] });
        // A policy correction invalidates the selected result but retains every historical observation.
        await client.query("UPDATE insurance_cases SET payer_name=$4,member_id=$5,state='unverified',current_evidence_id=NULL,revision=revision+1,updated_at=now() WHERE id=$3 AND practice_id=$1 AND location_id=$2", [...scope(tenant), caseId, input.payerName, input.memberId === undefined ? record.member_id : input.memberId]);
        return { id: caseId, revision: nextRevision, state: 'unverified' };
    });
}
