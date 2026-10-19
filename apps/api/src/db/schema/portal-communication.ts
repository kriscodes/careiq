// Migration 0041 grants helper-only writes and current account/grant checks.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, bigint, timestamp, text, jsonb, foreignKey, unique, primaryKey, pgPolicy, index, check } from 'drizzle-orm/pg-core';
import { patientPortalGrants } from './paperwork.js';
export const portalCommunicationProfiles = pgTable('portal_communication_profiles', {
    id: uuid().primaryKey().default(sql`uuidv7()`), practiceId: uuid('practice_id').notNull(), locationId: uuid('location_id').notNull(), patientId: uuid('patient_id').notNull(), grantId: uuid('grant_id').notNull(),
    revision: bigint({ mode: 'number' }).notNull().default(1), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('portal_communication_profile_patient').on(t.practiceId,t.locationId,t.patientId),check('portal_communication_profiles_revision_check',sql`${t.revision}>0`),unique('portal_communication_profiles_grant_id_key').on(t.grantId), foreignKey({ columns: [t.grantId, t.patientId, t.practiceId, t.locationId], foreignColumns: [patientPortalGrants.id, patientPortalGrants.patientId, patientPortalGrants.practiceId, patientPortalGrants.locationId] }), pgPolicy('workflow_scope', { for: 'select', to: ['public'], using: sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')` })]).enableRLS();
export const portalCommunicationRequestKeys = pgTable('portal_communication_request_keys', {
    profileId: uuid('profile_id').notNull().references(() => portalCommunicationProfiles.id), requestKey: uuid('request_key').notNull(), requestHash: text('request_hash').notNull(), response: jsonb().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.profileId, t.requestKey] }),check('portal_communication_request_keys_request_hash_check',sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`)]).enableRLS();
