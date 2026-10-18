// Migration 0028 owns FORCE RLS, retained-fact triggers and helper-only publication grants.
import { sql } from 'drizzle-orm';
import { pgTable,uuid,text,timestamp,bigint,integer,boolean,foreignKey,unique,uniqueIndex,index,pgPolicy,check,type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { patients } from './patients.js';
import { locations } from './practice-access.js';
import { documentRequests,documentVersions,fileObjects } from './workflow.js';

export const patientPortalGrants=pgTable('patient_portal_grants',{
    id:uuid().primaryKey().default(sql`uuidv7()`),practiceId:uuid('practice_id').notNull(),locationId:uuid('location_id').notNull(),patientId:uuid('patient_id').notNull(),
    clerkUserId:text('clerk_user_id').notNull(),relationship:text().notNull().default('self'),verificationMethod:text('verification_method').notNull(),verificationReference:text('verification_reference').notNull(),verifiedByActorId:text('verified_by_actor_id').notNull(),verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull().defaultNow(),verifiedEmail:text('verified_email'),emailVerifiedAt:timestamp('email_verified_at',{withTimezone:true}),paperworkEmailEnabled:boolean('paperwork_email_enabled').notNull().default(false),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true}),revocationReasonCode:text('revocation_reason_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),revision:bigint({mode:'number'}).notNull().default(1),
},(t):PgTableExtraConfigValue[]=>[
    unique('patient_portal_grants_id_patient_id_practice_id_location_id_key').on(t.id,t.patientId,t.practiceId,t.locationId),
    foreignKey({columns:[t.patientId,t.practiceId,t.locationId],foreignColumns:[patients.id,patients.practiceId,patients.locationId]}),
    foreignKey({columns:[t.locationId,t.practiceId],foreignColumns:[locations.id,locations.practiceId]}),
    uniqueIndex('patient_portal_live_subject_unique').on(t.practiceId,t.locationId,t.patientId,t.clerkUserId).where(sql`revoked_at IS NULL`),
    uniqueIndex('patient_portal_live_patient_unique').on(t.practiceId,t.locationId,t.patientId).where(sql`revoked_at IS NULL`),
    index('patient_portal_subject_idx').on(t.clerkUserId,t.expiresAt).where(sql`revoked_at IS NULL`),
    check('patient_portal_grants_clerk_user_id_check',sql`clerk_user_id ~ '^user_[A-Za-z0-9]+$'`),
    check('patient_portal_grants_relationship_check',sql`relationship='self'`),
    check('patient_portal_grants_verification_method_check',sql`verification_method='staff_in_person'`),
    check('patient_portal_grants_verification_reference_check',sql`length(btrim(verification_reference)) BETWEEN 1 AND 500`),
    check('patient_portal_grants_verified_email_check',sql`verified_email IS NULL OR (length(verified_email)<=254 AND verified_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')`),
    check('patient_portal_grants_check',sql`(verified_email IS NULL)=(email_verified_at IS NULL)`),
    check('patient_portal_grants_check1',sql`NOT paperwork_email_enabled OR verified_email IS NOT NULL`),
    check('patient_portal_grants_check2',sql`expires_at>verified_at`),
    check('patient_portal_grants_revision_check',sql`revision>0`),
    pgPolicy('workflow_scope',{for:'all',to:['public'],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`}),
]).enableRLS();

export const paperworkLibraryItems=pgTable('paperwork_library_items',{
    id:uuid().primaryKey().default(sql`uuidv7()`),practiceId:uuid('practice_id').notNull(),locationId:uuid('location_id').notNull(),patientId:uuid('patient_id').notNull(),requestId:uuid('request_id').notNull(),documentVersionId:uuid('document_version_id').notNull(),documentId:uuid('document_id').notNull(),fileObjectId:uuid('file_object_id').notNull(),contentHash:text('content_hash').notNull(),title:text().notNull(),versionNumber:integer('version_number').notNull(),signed:boolean().notNull(),releaseState:text('release_state').notNull().default('released'),releaseReasonCode:text('release_reason_code'),completedAt:timestamp('completed_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),revision:bigint({mode:'number'}).notNull().default(1),
},(t):PgTableExtraConfigValue[]=>[
    unique('paperwork_library_items_document_version_id_key').on(t.documentVersionId),
    unique('paperwork_library_items_id_patient_id_practice_id_location_id_key').on(t.id,t.patientId,t.practiceId,t.locationId),
    foreignKey({columns:[t.requestId,t.patientId,t.practiceId,t.locationId],foreignColumns:[documentRequests.id,documentRequests.patientId,documentRequests.practiceId,documentRequests.locationId]}),
    foreignKey({columns:[t.documentVersionId,t.documentId,t.patientId,t.practiceId,t.locationId],foreignColumns:[documentVersions.id,documentVersions.documentId,documentVersions.patientId,documentVersions.practiceId,documentVersions.locationId]}),
    foreignKey({columns:[t.fileObjectId,t.patientId,t.practiceId,t.locationId],foreignColumns:[fileObjects.id,fileObjects.patientId,fileObjects.practiceId,fileObjects.locationId]}),
    index('paperwork_library_patient_idx').on(t.practiceId,t.locationId,t.patientId,t.completedAt.desc(),t.id.desc()),
    check('paperwork_library_items_content_hash_check',sql`content_hash ~ '^[0-9a-f]{64}$'`),
    check('paperwork_library_items_version_number_check',sql`version_number>0`),
    check('paperwork_library_items_release_state_check',sql`release_state IN ('released','restricted','voided','superseded')`),
    check('paperwork_library_items_revision_check',sql`revision>0`),
    pgPolicy('workflow_scope',{for:'all',to:['public'],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`}),
]).enableRLS();

export const paperworkNotifications=pgTable('paperwork_notifications',{
    id:uuid().primaryKey().default(sql`uuidv7()`),practiceId:uuid('practice_id').notNull(),locationId:uuid('location_id').notNull(),patientId:uuid('patient_id').notNull(),requestId:uuid('request_id').notNull(),libraryItemId:uuid('library_item_id').notNull(),recipientGrantId:uuid('recipient_grant_id'),documentVersionId:uuid('document_version_id').notNull(),channel:text().notNull().default('email'),state:text().notNull(),failureCode:text('failure_code'),providerId:text('provider_id').notNull().default('unconfigured'),dedupeKey:text('dedupe_key').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),revision:bigint({mode:'number'}).notNull().default(1),
},(t):PgTableExtraConfigValue[]=>[
    unique('paperwork_notifications_dedupe_key_key').on(t.dedupeKey),unique('paperwork_notifications_library_item_id_key').on(t.libraryItemId),unique('paperwork_notifications_id_patient_id_practice_id_location_id_key').on(t.id,t.patientId,t.practiceId,t.locationId),
    foreignKey({columns:[t.requestId,t.patientId,t.practiceId,t.locationId],foreignColumns:[documentRequests.id,documentRequests.patientId,documentRequests.practiceId,documentRequests.locationId]}),
    foreignKey({columns:[t.libraryItemId,t.patientId,t.practiceId,t.locationId],foreignColumns:[paperworkLibraryItems.id,paperworkLibraryItems.patientId,paperworkLibraryItems.practiceId,paperworkLibraryItems.locationId]}),
    foreignKey({columns:[t.documentVersionId,t.patientId,t.practiceId,t.locationId],foreignColumns:[documentVersions.id,documentVersions.patientId,documentVersions.practiceId,documentVersions.locationId]}),
    foreignKey({columns:[t.recipientGrantId,t.patientId,t.practiceId,t.locationId],foreignColumns:[patientPortalGrants.id,patientPortalGrants.patientId,patientPortalGrants.practiceId,patientPortalGrants.locationId]}),
    check('paperwork_notifications_channel_check',sql`channel='email'`),check('paperwork_notifications_state_check',sql`state IN ('pending','needs_attention','suppressed','accepted','delivered','unknown')`),check('paperwork_notifications_provider_id_check',sql`provider_id='unconfigured'`),check('paperwork_notifications_revision_check',sql`revision>0`),check('paperwork_notifications_check',sql`state NOT IN ('accepted','delivered','unknown')`),
    pgPolicy('workflow_scope',{for:'all',to:['public'],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`}),
]).enableRLS();
