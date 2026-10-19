import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { practices } from './practices.js';
import { locations, practiceMemberAccess } from './practice-access.js';
import { appointments } from './appointments.js';
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const insuranceCases = pgTable('insurance_cases', {
    id: uuid('id').primaryKey().default(sql`uuidv7()`), practiceId: uuid('practice_id').notNull().references(() => practices.id), locationId: uuid('location_id').notNull(), patientId: uuid('patient_id').notNull(), appointmentId: uuid('appointment_id').notNull(),
    payerName: text('payer_name').notNull(), memberId: text('member_id'), assigneeUserId: text('assignee_user_id'), dueAt: timestamp('due_at', { withTimezone: true }),
    state: text('state').notNull().default('unverified'), currentEvidenceId: uuid('current_evidence_id'), revision: bigint('revision', { mode: 'number' }).notNull().default(1),
    createdByActorId: text('created_by_actor_id').notNull(), createdAt: created(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
    unique('insurance_cases_id_scope_key').on(t.id, t.practiceId, t.locationId), unique('insurance_cases_patient_appointment_scope_key').on(t.id, t.patientId, t.appointmentId, t.practiceId, t.locationId), unique('insurance_cases_appointment_key').on(t.appointmentId, t.practiceId, t.locationId),
    foreignKey({ name: 'insurance_cases_location_fk', columns: [t.locationId, t.practiceId], foreignColumns: [locations.id, locations.practiceId] }),
    foreignKey({ name: 'insurance_cases_appointment_fk', columns: [t.appointmentId, t.patientId, t.practiceId, t.locationId], foreignColumns: [appointments.id, appointments.patientId, appointments.practiceId, appointments.locationId] }),
    foreignKey({ name: 'insurance_cases_assignee_fk', columns: [t.practiceId, t.assigneeUserId], foreignColumns: [practiceMemberAccess.practiceId, practiceMemberAccess.userId] }),
    foreignKey({ name: 'insurance_cases_current_evidence_fk', columns: [t.currentEvidenceId, t.id, t.practiceId, t.locationId], foreignColumns: [insuranceEvidence.id, insuranceEvidence.caseId, insuranceEvidence.practiceId, insuranceEvidence.locationId] }),
    check('insurance_cases_payer_check', sql`length(btrim(${t.payerName})) BETWEEN 1 AND 120`), check('insurance_cases_member_check', sql`${t.memberId} IS NULL OR length(btrim(${t.memberId})) BETWEEN 1 AND 120`),
    check('insurance_cases_state_check', sql`${t.state} IN ('unverified','active','inactive','needs_follow_up')`), check('insurance_cases_revision_check', sql`${t.revision}>0`),
    check('insurance_cases_evidence_state_check', sql`(${t.currentEvidenceId} IS NULL AND ${t.state}='unverified') OR (${t.currentEvidenceId} IS NOT NULL AND ${t.state}<>'unverified')`),
    index('insurance_cases_scope_updated_idx').on(t.practiceId, t.locationId, t.updatedAt.desc(), t.id.desc()), index('insurance_cases_follow_up_idx').on(t.practiceId, t.locationId, t.assigneeUserId, t.dueAt, t.id),
]);
export const insuranceEvidence = pgTable('insurance_evidence', {
    id: uuid('id').primaryKey().default(sql`uuidv7()`), practiceId: uuid('practice_id').notNull().references(() => practices.id), locationId: uuid('location_id').notNull(), patientId: uuid('patient_id').notNull(), appointmentId: uuid('appointment_id').notNull(), caseId: uuid('case_id').notNull(),
    payerNameSnapshot: text('payer_name_snapshot').notNull(), memberIdSnapshot: text('member_id_snapshot'),
    scheduledAtSnapshot: timestamp('scheduled_at_snapshot', { withTimezone: true }),
    source: text('source').notNull(), observedAt: timestamp('observed_at', { withTimezone: true }).notNull(), reference: text('reference').notNull(), outcome: text('outcome').notNull(),
    copayCents: integer('copay_cents'), deductibleRemainingCents: integer('deductible_remaining_cents'), coinsurancePercent: integer('coinsurance_percent'),
    reasonCode: text('reason_code').notNull(), supersedesEvidenceId: uuid('supersedes_evidence_id'), createdByActorId: text('created_by_actor_id').notNull(), auditEventId: uuid('audit_event_id').notNull(), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [
    unique('insurance_evidence_id_case_scope_key').on(t.id, t.caseId, t.practiceId, t.locationId), unique('insurance_evidence_supersedes_key').on(t.supersedesEvidenceId),
    foreignKey({ name: 'insurance_evidence_case_fk', columns: [t.caseId, t.patientId, t.appointmentId, t.practiceId, t.locationId], foreignColumns: [insuranceCases.id, insuranceCases.patientId, insuranceCases.appointmentId, insuranceCases.practiceId, insuranceCases.locationId] }),
    foreignKey({ name: 'insurance_evidence_supersedes_fk', columns: [t.supersedesEvidenceId, t.caseId, t.practiceId, t.locationId], foreignColumns: [t.id, t.caseId, t.practiceId, t.locationId] }),
    check('insurance_evidence_payer_snapshot_check', sql`length(btrim(${t.payerNameSnapshot})) BETWEEN 1 AND 120`), check('insurance_evidence_member_snapshot_check', sql`${t.memberIdSnapshot} IS NULL OR length(btrim(${t.memberIdSnapshot})) BETWEEN 1 AND 120`),
    check('insurance_evidence_source_check', sql`${t.source} IN ('payer_portal','phone','document')`), check('insurance_evidence_outcome_check', sql`${t.outcome} IN ('active','inactive','needs_follow_up')`),
    check('insurance_evidence_reference_check', sql`length(btrim(${t.reference})) BETWEEN 1 AND 200`), check('insurance_evidence_reason_check', sql`(${t.reasonCode}='correction' AND ${t.supersedesEvidenceId} IS NOT NULL) OR (${t.reasonCode}='manual_verification' AND ${t.supersedesEvidenceId} IS NULL)`),
    check('insurance_evidence_copay_check', sql`${t.copayCents} IS NULL OR ${t.copayCents} BETWEEN 0 AND 100000000`), check('insurance_evidence_deductible_check', sql`${t.deductibleRemainingCents} IS NULL OR ${t.deductibleRemainingCents} BETWEEN 0 AND 100000000`), check('insurance_evidence_coinsurance_check', sql`${t.coinsurancePercent} IS NULL OR ${t.coinsurancePercent} BETWEEN 0 AND 100`),
    check('insurance_evidence_active_benefits_check', sql`${t.outcome}='active' OR (${t.copayCents} IS NULL AND ${t.deductibleRemainingCents} IS NULL AND ${t.coinsurancePercent} IS NULL)`),
    check('insurance_evidence_observed_check', sql`${t.observedAt}<=${t.createdAt}+interval '1 minute'`), index('insurance_evidence_history_idx').on(t.practiceId, t.locationId, t.caseId, t.createdAt.desc(), t.id.desc()),
]);
