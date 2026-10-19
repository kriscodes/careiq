import { deliveryIntents } from './patient-delivery.js';
// Workflow tables are enforced by migration 0019, including FORCE RLS, immutable guards and provider exclusion.
import { pgTable, index, foreignKey, unique, pgPolicy, check, uuid, timestamp, text, bigint, varchar, date, uniqueIndex, boolean, integer, type AnyPgColumn, type PgTableExtraConfigValue, jsonb, time, numeric, pgSchema, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import { appointments } from "./appointments.js";
import { patients } from "./patients.js";
import { practices } from "./practices.js";
import { locations } from "./practice-access.js";

export const audit = pgSchema("audit");

export const providers = pgTable("providers", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	displayName: text("display_name").notNull(),
	clerkUserId: text("clerk_user_id"),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("providers_scope_created_idx").on(table.practiceId,table.createdAt.desc(),table.id.desc()),
  check("providers_display_name_check",sql`((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 120))`),
  check("providers_status_check",sql`(status = ANY (ARRAY['active'::text, 'inactive'::text]))`),
  check("providers_revision_check",sql`(revision > 0)`),
  unique("providers_id_practice_id_key").on(table.id, table.practiceId),
  foreignKey({name:"providers_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const visitTypes = pgTable("visit_types", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	defaultDurationMinutes: integer("default_duration_minutes").notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("visit_types_scope_created_idx").on(table.practiceId,table.createdAt.desc(),table.id.desc()),
  check("visit_types_code_check",sql`((length(code) >= 1) AND (length(code) <= 64))`),
  check("visit_types_name_check",sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`),
  check("visit_types_default_duration_minutes_check",sql`((default_duration_minutes >= 1) AND (default_duration_minutes <= 1440))`),
  check("visit_types_revision_check",sql`(revision > 0)`),
  unique("visit_types_id_practice_id_key").on(table.id, table.practiceId),
  unique("visit_types_practice_id_code_key").on(table.practiceId, table.code),
  foreignKey({name:"visit_types_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const documentTypes = pgTable("document_types", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	active: boolean().default(true).notNull(),
	defaultTemplateId: uuid("default_template_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("document_types_scope_created_idx").on(table.practiceId,table.createdAt.desc(),table.id.desc()),
  check("document_types_code_check",sql`((length(code) >= 1) AND (length(code) <= 64))`),
  check("document_types_name_check",sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`),
  check("document_types_revision_check",sql`(revision > 0)`),
  unique("document_types_id_practice_id_key").on(table.id, table.practiceId),
  unique("document_types_practice_id_code_key").on(table.practiceId, table.code),
  foreignKey({name:"document_types_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_types_default_template_fk",columns:[table.defaultTemplateId, table.practiceId],foreignColumns:[documentTemplates.id, documentTemplates.practiceId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const requirementRuleSets = pgTable("requirement_rule_sets", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	version: integer().notNull(),
	title: text().notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'date' }),
	publishedByActorId: text("published_by_actor_id"),
	active: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("requirement_rule_sets_version_check",sql`(version > 0)`),
  check("requirement_rule_sets_revision_check",sql`(revision > 0)`),
  unique("requirement_rule_sets_id_practice_id_key").on(table.id, table.practiceId),
  unique("requirement_rule_sets_practice_id_version_key").on(table.practiceId, table.version),
  foreignKey({name:"requirement_rule_sets_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  uniqueIndex("requirement_rule_sets_active_idx").on(table.practiceId).where(sql`active`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const requirementRules = pgTable("requirement_rules", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	ruleSetId: uuid("rule_set_id").notNull(),
	documentTypeId: uuid("document_type_id").notNull(),
	visitTypeId: uuid("visit_type_id"),
	locationId: uuid("location_id"),
	required: boolean().default(true).notNull(),
	reviewRequired: boolean("review_required").default(true).notNull(),
	signatureRequired: boolean("signature_required").default(false).notNull(),
	reusePolicy: text("reuse_policy").default('none').notNull(),
	maximumAgeDays: integer("maximum_age_days"),
	dueOffsetMinutes: integer("due_offset_minutes").default(0).notNull(),
	requiredTemplateVersionId: uuid("required_template_version_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("requirement_rules_reuse_policy_check",sql`(reuse_policy = ANY (ARRAY['none'::text, 'same_patient'::text, 'same_appointment'::text]))`),
  check("requirement_rules_maximum_age_days_check",sql`(maximum_age_days > 0)`),
  check("requirement_rules_revision_check",sql`(revision > 0)`),
  unique("requirement_rules_id_practice_id_key").on(table.id, table.practiceId),
  foreignKey({name:"requirement_rules_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"requirement_rules_rule_set_id_practice_id_fkey",columns:[table.ruleSetId, table.practiceId],foreignColumns:[requirementRuleSets.id, requirementRuleSets.practiceId]}),
  foreignKey({name:"requirement_rules_document_type_id_practice_id_fkey",columns:[table.documentTypeId, table.practiceId],foreignColumns:[documentTypes.id, documentTypes.practiceId]}),
  foreignKey({name:"requirement_rules_visit_type_id_practice_id_fkey",columns:[table.visitTypeId, table.practiceId],foreignColumns:[visitTypes.id, visitTypes.practiceId]}),
  foreignKey({name:"requirement_rules_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"requirement_rules_template_fk",columns:[table.requiredTemplateVersionId, table.practiceId],foreignColumns:[templateVersions.id, templateVersions.practiceId]}),
  unique("requirement_rules_precedence_unique").on(table.ruleSetId, table.documentTypeId, table.visitTypeId, table.locationId).nullsNotDistinct(),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const practiceAssetObjects = pgTable("practice_asset_objects", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	storageKey: text("storage_key").notNull(),
	storageVersion: text("storage_version"),
	originalFilename: text("original_filename"),
	mediaType: text("media_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	sha256: text(),
	status: text().default('reserved').notNull(),
	provenance: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("practice_asset_objects_size_bytes_check",sql`(size_bytes >= 0)`),
  check("practice_asset_objects_sha256_check",sql`(sha256 ~ '^[0-9a-f]{64}$'::text)`),
  check("practice_asset_objects_status_check",sql`(status = ANY (ARRAY['reserved'::text, 'uploaded'::text, 'scanning'::text, 'available'::text, 'quarantined'::text, 'rejected'::text, 'abandoned'::text]))`),
  check("practice_asset_objects_revision_check",sql`(revision > 0)`),
  unique("practice_asset_objects_storage_key_key").on(table.storageKey),
  unique("practice_asset_objects_id_practice_id_key").on(table.id, table.practiceId),
  foreignKey({name:"practice_asset_objects_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const documentTemplates = pgTable("document_templates", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	documentTypeId: uuid("document_type_id").notNull(),
	title: text().notNull(),
	active: boolean().default(true).notNull(),
	publishedVersionId: uuid("published_version_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("document_templates_scope_created_idx").on(table.practiceId,table.createdAt.desc(),table.id.desc()),
  check("document_templates_revision_check",sql`(revision > 0)`),
  unique("document_templates_id_practice_id_key").on(table.id, table.practiceId),
  foreignKey({name:"document_templates_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_templates_document_type_id_practice_id_fkey",columns:[table.documentTypeId, table.practiceId],foreignColumns:[documentTypes.id, documentTypes.practiceId]}),
  foreignKey({name:"document_templates_published_version_fk",columns:[table.publishedVersionId, table.id, table.practiceId],foreignColumns:[templateVersions.id, templateVersions.templateId, templateVersions.practiceId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`}),
  pgPolicy("patient_form_template_read",{for:"select",to:["public"],using:sql`EXISTS(SELECT 1 FROM template_versions v JOIN prepared_documents p ON p.template_version_id=v.id AND p.practice_id=v.practice_id WHERE v.template_id=document_templates.id AND v.practice_id=document_templates.practice_id AND careiq_patient_form_scope(p.id))`})
]).enableRLS();

export const templateVersions = pgTable("template_versions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	templateId: uuid("template_id").notNull(),
	versionNumber: integer("version_number").notNull(),
	state: text().default('draft').notNull(),
	schemaVersion: integer("schema_version").default(1).notNull(),
	fieldSchema: jsonb("field_schema").default([]).notNull(),
	formSchema: jsonb("form_schema").default({}).notNull(),
	assetObjectId: uuid("asset_object_id"),
	contentHash: text("content_hash"),
	content: text().default('').notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'date' }),
	publishedByActorId: text("published_by_actor_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("template_versions_template_created_idx").on(table.practiceId,table.templateId,table.createdAt.desc(),table.id.desc()),
  check("template_versions_version_number_check",sql`(version_number > 0)`),
  check("template_versions_state_check",sql`(state = ANY (ARRAY['draft'::text, 'published'::text, 'retired'::text]))`),
  check("template_versions_schema_version_check",sql`(schema_version > 0)`),
  check("template_versions_field_schema_check",sql`(jsonb_typeof(field_schema) = 'array'::text)`),
  check("template_versions_form_schema_check",sql`(jsonb_typeof(form_schema) = 'object'::text AND octet_length(form_schema::text)<=131072)`),
  check("template_versions_content_hash_check",sql`(content_hash ~ '^[0-9a-f]{64}$'::text)`),
  check("template_versions_revision_check",sql`(revision > 0)`),
  unique("template_versions_id_practice_id_key").on(table.id, table.practiceId),
  unique("template_versions_template_id_version_number_key").on(table.templateId, table.versionNumber),
  unique("template_versions_id_template_id_practice_id_key").on(table.id, table.templateId, table.practiceId),
  foreignKey({name:"template_versions_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"template_versions_template_id_practice_id_fkey",columns:[table.templateId, table.practiceId],foreignColumns:[documentTemplates.id, documentTemplates.practiceId]}),
  foreignKey({name:"template_versions_asset_object_id_practice_id_fkey",columns:[table.assetObjectId, table.practiceId],foreignColumns:[practiceAssetObjects.id, practiceAssetObjects.practiceId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`}),
  pgPolicy("patient_form_version_read",{for:"select",to:["public"],using:sql`EXISTS(SELECT 1 FROM prepared_documents p WHERE p.template_version_id=template_versions.id AND p.practice_id=template_versions.practice_id AND careiq_patient_form_scope(p.id))`})
]).enableRLS();

export const providerWebhookReceipts = pgTable("provider_webhook_receipts", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	provider: text().notNull(),
	providerEventId: text("provider_event_id").notNull(),
	deliveryAttemptId: uuid("delivery_attempt_id"),
	signatureVerified: boolean("signature_verified").notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'date' }),
	normalizedResult: jsonb("normalized_result").default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("provider_webhook_receipts_id_practice_id_key").on(table.id, table.practiceId),
  unique("provider_webhook_receipts_provider_provider_event_id_key").on(table.provider, table.providerEventId),
  foreignKey({name:"provider_webhook_receipts_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"webhook_delivery_scope_fk",columns:[table.deliveryAttemptId, table.practiceId],foreignColumns:[deliveryAttempts.id, deliveryAttempts.practiceId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})
]).enableRLS();

export const providerLocations = pgTable("provider_locations", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	providerId: uuid("provider_id").notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("provider_locations_revision_check",sql`(revision > 0)`),
  unique("provider_locations_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("provider_locations_practice_id_provider_id_location_id_key").on(table.practiceId, table.providerId, table.locationId),
  foreignKey({name:"provider_locations_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"provider_locations_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"provider_locations_provider_id_practice_id_fkey",columns:[table.providerId, table.practiceId],foreignColumns:[providers.id, providers.practiceId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const providerAvailabilityRules = pgTable("provider_availability_rules", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	providerId: uuid("provider_id").notNull(),
	isoWeekday: integer("iso_weekday").notNull(),
	startsAtLocal: time("starts_at_local").notNull(),
	endsAtLocal: time("ends_at_local").notNull(),
	effectiveFrom: date("effective_from").notNull(),
	effectiveUntil: date("effective_until"),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("provider_availability_rules_iso_weekday_check",sql`((iso_weekday >= 1) AND (iso_weekday <= 7))`),
  check("provider_availability_rules_revision_check",sql`(revision > 0)`),
  check("provider_availability_rules_check",sql`(starts_at_local < ends_at_local)`),
  check("provider_availability_rules_check1",sql`((effective_until IS NULL) OR (effective_until >= effective_from))`),
  unique("provider_availability_rules_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  foreignKey({name:"provider_availability_rules_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"provider_availability_rules_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"provider_availability_rules_practice_id_provider_id_locati_fkey",columns:[table.practiceId, table.providerId, table.locationId],foreignColumns:[providerLocations.practiceId, providerLocations.providerId, providerLocations.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const providerAvailabilityExceptions = pgTable("provider_availability_exceptions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	providerId: uuid("provider_id").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	kind: text().notNull(),
	reasonCode: text("reason_code"),
 active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
 index("provider_availability_exceptions_active_idx").on(table.practiceId,table.locationId,table.providerId,table.startsAt,table.endsAt).where(sql`${table.active}`),
  check("provider_availability_exceptions_kind_check",sql`(kind = ANY (ARRAY['available'::text, 'unavailable'::text]))`),
  check("provider_availability_exceptions_revision_check",sql`(revision > 0)`),
  check("provider_availability_exceptions_check",sql`(ends_at > starts_at)`),
  unique("provider_availability_exceptions_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  foreignKey({name:"provider_availability_exceptions_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"provider_availability_exceptions_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"provider_availability_excepti_practice_id_provider_id_loca_fkey",columns:[table.practiceId, table.providerId, table.locationId],foreignColumns:[providerLocations.practiceId, providerLocations.providerId, providerLocations.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const visitRequirements = pgTable("visit_requirements", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	documentTypeId: uuid("document_type_id").notNull(),
	sourceRuleId: uuid("source_rule_id"),
	ruleSetVersion: integer("rule_set_version"),
	labelSnapshot: text("label_snapshot").notNull(),
	required: boolean().default(true).notNull(),
	reviewRequired: boolean("review_required").default(true).notNull(),
	signatureRequired: boolean("signature_required").default(false).notNull(),
	reusePolicy: text("reuse_policy").default('none').notNull(),
	maximumAgeDays: integer("maximum_age_days"),
	requiredTemplateVersionId: uuid("required_template_version_id"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'date' }),
	lifecycleState: text("lifecycle_state").default('active').notNull(),
	waiverReasonCode: text("waiver_reason_code"),
	waivedByActorId: text("waived_by_actor_id"),
	waivedAt: timestamp("waived_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("visit_requirements_reuse_policy_check",sql`(reuse_policy = ANY (ARRAY['none'::text, 'same_patient'::text, 'same_appointment'::text]))`),
  check("visit_requirements_maximum_age_days_check",sql`(maximum_age_days > 0)`),
  check("visit_requirements_lifecycle_state_check",sql`(lifecycle_state = ANY (ARRAY['active'::text, 'waived'::text, 'retired'::text]))`),
  check("visit_requirements_revision_check",sql`(revision > 0)`),
  check("visit_requirements_check",sql`((lifecycle_state <> 'waived'::text) OR ((waiver_reason_code IS NOT NULL) AND (waived_by_actor_id IS NOT NULL) AND (waived_at IS NOT NULL)))`),
  unique("visit_requirements_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("visit_requirements_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"visit_requirements_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"visit_requirements_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"visit_requirements_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"visit_requirements_appointment_id_patient_id_practice_id_l_fkey",columns:[table.appointmentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[appointments.id, appointments.patientId, appointments.practiceId, appointments.locationId]}),
  foreignKey({name:"visit_requirements_document_type_id_practice_id_fkey",columns:[table.documentTypeId, table.practiceId],foreignColumns:[documentTypes.id, documentTypes.practiceId]}),
  foreignKey({name:"visit_requirements_source_rule_id_practice_id_fkey",columns:[table.sourceRuleId, table.practiceId],foreignColumns:[requirementRules.id, requirementRules.practiceId]}),
  foreignKey({name:"visit_requirements_template_fk",columns:[table.requiredTemplateVersionId, table.practiceId],foreignColumns:[templateVersions.id, templateVersions.practiceId]}),
  uniqueIndex("visit_requirements_current_unique").on(table.practiceId, table.locationId, table.appointmentId, table.documentTypeId).where(sql`(lifecycle_state <> 'retired'::text)`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const fileObjects = pgTable("file_objects", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	storageKey: text("storage_key").notNull(),
	storageVersion: text("storage_version"),
	originalFilename: text("original_filename").notNull(),
	declaredMediaType: text("declared_media_type").notNull(),
	detectedMediaType: text("detected_media_type"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	actualBytes: bigint("actual_bytes", { mode: "number" }),
	sha256: text(),
	status: text().default('reserved').notNull(),
	uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'date' }),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'date' }),
	scanVerdict: text("scan_verdict"),
	scanReference: text("scan_reference"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
	requestId: uuid("request_id"),
}, (table): PgTableExtraConfigValue[] => [
  foreignKey({name:"file_objects_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"file_objects_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  check("file_objects_expected_bytes_check",sql`((expected_bytes >= 1) AND (expected_bytes <= 26214400))`),
  check("file_objects_actual_bytes_check",sql`(actual_bytes >= 0)`),
  check("file_objects_sha256_check",sql`(sha256 ~ '^[0-9a-f]{64}$'::text)`),
  check("file_objects_status_check",sql`(status = ANY (ARRAY['reserved'::text, 'uploaded'::text, 'scanning'::text, 'available'::text, 'quarantined'::text, 'rejected'::text, 'abandoned'::text]))`),
  check("file_objects_revision_check",sql`(revision > 0)`),
  unique("file_objects_storage_key_key").on(table.storageKey),
  unique("file_objects_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("file_objects_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"file_objects_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"file_objects_request_scope_fk",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('file_objects'::text, to_jsonb(file_objects.*))`,withCheck:sql`careiq_patient_scope('file_objects'::text, to_jsonb(file_objects.*))`})
]).enableRLS();

export const documents = pgTable("documents", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentTypeId: uuid("document_type_id").notNull(),
	title: text().notNull(),
	currentVersionId: uuid("current_version_id"),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'date' }),
	archivedByActorId: text("archived_by_actor_id"),
	archiveReasonCode: text("archive_reason_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
	requestId: uuid("request_id"),
}, (table): PgTableExtraConfigValue[] => [
  index("documents_patient_type_created_idx").on(table.practiceId,table.locationId,table.patientId,table.documentTypeId,table.createdAt.desc(),table.id.desc()).where(sql`archived_at IS NULL`),
  index("documents_scope_created_idx").on(table.practiceId,table.locationId,table.createdAt.desc(),table.id.desc()),
  check("documents_title_check",sql`((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 240))`),
  check("documents_revision_check",sql`(revision > 0)`),
  unique("documents_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("documents_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"documents_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"documents_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"documents_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"documents_document_type_id_practice_id_fkey",columns:[table.documentTypeId, table.practiceId],foreignColumns:[documentTypes.id, documentTypes.practiceId]}),
  foreignKey({name:"documents_current_version_fk",columns:[table.currentVersionId, table.id, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.documentId, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"documents_request_scope_fk",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('documents'::text, to_jsonb(documents.*))`,withCheck:sql`careiq_patient_scope('documents'::text, to_jsonb(documents.*))`})
]).enableRLS();

export const documentVersions = pgTable("document_versions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentId: uuid("document_id").notNull(),
	versionNumber: integer("version_number").notNull(),
	source: text().notNull(),
	templateVersionId: uuid("template_version_id"),
	sourceVersionId: uuid("source_version_id"),
	fileObjectId: uuid("file_object_id"),
	structuredAnswers: jsonb("structured_answers"),
	answersSchemaVersion: integer("answers_schema_version"),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	createdByActorId: text("created_by_actor_id").notNull(),
	contentHash: text("content_hash"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	requestId: uuid("request_id"),
}, (table): PgTableExtraConfigValue[] => [
  index("document_versions_document_created_idx").on(table.practiceId,table.locationId,table.documentId,table.createdAt.desc(),table.id.desc()),
  check("document_versions_version_number_check",sql`(version_number > 0)`),
  check("document_versions_source_check",sql`(source = ANY (ARRAY['staff_upload'::text, 'patient_upload'::text, 'template_generated'::text, 'signed_output'::text, 'import'::text]))`),
  check("document_versions_content_hash_check",sql`(content_hash ~ '^[0-9a-f]{64}$'::text)`),
  unique("document_versions_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_versions_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("document_versions_document_id_version_number_key").on(table.documentId, table.versionNumber),
  unique("document_versions_id_document_id_patient_id_practice_id_loc_key").on(table.id, table.documentId, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"document_versions_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_versions_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_versions_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_versions_document_id_patient_id_practice_id_locat_fkey",columns:[table.documentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documents.id, documents.patientId, documents.practiceId, documents.locationId]}),
  foreignKey({name:"document_versions_template_version_id_practice_id_fkey",columns:[table.templateVersionId, table.practiceId],foreignColumns:[templateVersions.id, templateVersions.practiceId]}),
  foreignKey({name:"document_versions_file_object_id_patient_id_practice_id_lo_fkey",columns:[table.fileObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  foreignKey({name:"document_versions_source_fk",columns:[table.sourceVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"document_versions_request_scope_fk",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('document_versions'::text, to_jsonb(document_versions.*))`,withCheck:sql`careiq_patient_scope('document_versions'::text, to_jsonb(document_versions.*))`})
]).enableRLS();

export const uploadSessions = pgTable("upload_sessions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentId: uuid("document_id").notNull(),
	documentVersionId: uuid("document_version_id"),
 baseVersionId: uuid("base_version_id"),
	fileObjectId: uuid("file_object_id").notNull(),
	actorUserId: text("actor_user_id"),
	patientSessionId: uuid("patient_session_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
	declaredSha256: text("declared_sha256"),
	declaredMediaType: text("declared_media_type").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
	requestId: uuid("request_id"),
}, (table): PgTableExtraConfigValue[] => [
 foreignKey({name:"upload_sessions_base_version_scope_fk",columns:[table.baseVersionId,table.documentId,table.patientId,table.practiceId,table.locationId],foreignColumns:[documentVersions.id,documentVersions.documentId,documentVersions.patientId,documentVersions.practiceId,documentVersions.locationId]}),
  check("upload_sessions_declared_size_bytes_check",sql`((declared_size_bytes >= 1) AND (declared_size_bytes <= 26214400))`),
  check("upload_sessions_declared_sha256_check",sql`(declared_sha256 ~ '^[0-9a-f]{64}$'::text)`),
  check("upload_sessions_revision_check",sql`(revision > 0)`),
  unique("upload_sessions_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("upload_sessions_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("upload_sessions_file_object_id_key").on(table.fileObjectId),
  foreignKey({name:"upload_sessions_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"upload_sessions_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"upload_sessions_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"upload_sessions_document_id_patient_id_practice_id_locatio_fkey",columns:[table.documentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documents.id, documents.patientId, documents.practiceId, documents.locationId]}),
  foreignKey({name:"upload_sessions_document_version_id_patient_id_practice_id_fkey",columns:[table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"upload_sessions_file_object_id_patient_id_practice_id_loca_fkey",columns:[table.fileObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  foreignKey({name:"upload_sessions_patient_session_fk",columns:[table.patientSessionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[patientSessions.id, patientSessions.patientId, patientSessions.practiceId, patientSessions.locationId]}),
  foreignKey({name:"upload_sessions_request_scope_fk",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('upload_sessions'::text, to_jsonb(upload_sessions.*))`,withCheck:sql`careiq_patient_scope('upload_sessions'::text, to_jsonb(upload_sessions.*))`})
]).enableRLS();

export const documentReviews = pgTable("document_reviews", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentVersionId: uuid("document_version_id").notNull(),
	reviewerActorId: text("reviewer_actor_id").notNull(),
	decision: text().notNull(),
	reasonCode: text("reason_code"),
	note: text(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	supersedesReviewId: uuid("supersedes_review_id"),
	auditEventId: uuid("audit_event_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("document_reviews_version_created_idx").on(table.documentVersionId,table.createdAt.desc(),table.id.desc()),
  check("document_reviews_decision_check",sql`(decision = ANY (ARRAY['accepted'::text, 'replacement_required'::text]))`),
  unique("document_reviews_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_reviews_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("document_reviews_id_document_version_id_patient_id_practice_key").on(table.id, table.documentVersionId, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"document_reviews_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_reviews_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_reviews_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_reviews_document_version_id_patient_id_practice_i_fkey",columns:[table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"document_reviews_supersedes_fk",columns:[table.supersedesReviewId, table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentReviews.id, documentReviews.documentVersionId, documentReviews.patientId, documentReviews.practiceId, documentReviews.locationId]}),
  check("document_reviews_no_self",sql`(supersedes_review_id IS DISTINCT FROM id)`),
  foreignKey({name:"document_reviews_audit_event_id_fk",columns:[table.auditEventId],foreignColumns:[eventsInAudit.id]}),
  uniqueIndex("document_reviews_successor_unique").on(table.supersedesReviewId).where(sql`(supersedes_review_id IS NOT NULL)`),
  uniqueIndex("document_reviews_initial_unique").on(table.documentVersionId).where(sql`(supersedes_review_id IS NULL)`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const requirementEvidence = pgTable("requirement_evidence", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requirementId: uuid("requirement_id").notNull(),
	documentVersionId: uuid("document_version_id").notNull(),
	acceptedReviewId: uuid("accepted_review_id"),
	linkedByActorId: text("linked_by_actor_id").notNull(),
	linkedAt: timestamp("linked_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	revocationReasonCode: text("revocation_reason_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("requirement_evidence_revision_check",sql`(revision > 0)`),
  unique("requirement_evidence_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("requirement_evidence_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"requirement_evidence_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"requirement_evidence_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"requirement_evidence_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"requirement_evidence_requirement_id_patient_id_practice_id_fkey",columns:[table.requirementId, table.patientId, table.practiceId, table.locationId],foreignColumns:[visitRequirements.id, visitRequirements.patientId, visitRequirements.practiceId, visitRequirements.locationId]}),
  foreignKey({name:"requirement_evidence_document_version_id_patient_id_practi_fkey",columns:[table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"requirement_evidence_accepted_review_id_document_version_i_fkey",columns:[table.acceptedReviewId, table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentReviews.id, documentReviews.documentVersionId, documentReviews.patientId, documentReviews.practiceId, documentReviews.locationId]}),
  index("requirement_evidence_version_idx").on(table.documentVersionId).where(sql`(revoked_at IS NULL)`),
  index("requirement_evidence_review_idx").on(table.acceptedReviewId).where(sql`(revoked_at IS NULL)`),
  uniqueIndex("requirement_evidence_current_unique").on(table.requirementId).where(sql`(revoked_at IS NULL)`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const preparedDocuments = pgTable("prepared_documents", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id"),
	requirementId: uuid("requirement_id"),
	templateVersionId: uuid("template_version_id").notNull(),
	answers: jsonb().default({}).notNull(),
	renderedSourceVersionId: uuid("rendered_source_version_id"),
	state: text().default('draft').notNull(),
	createdByActorId: text("created_by_actor_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("prepared_documents_answers_check",sql`(jsonb_typeof(answers) = 'object'::text)`),
  check("prepared_documents_state_check",sql`(state = ANY (ARRAY['draft'::text, 'preparing'::text, 'ready'::text, 'failed'::text, 'discarded'::text]))`),
  check("prepared_documents_revision_check",sql`(revision > 0)`),
  unique("prepared_documents_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("prepared_documents_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"prepared_documents_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"prepared_documents_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"prepared_documents_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"prepared_documents_appointment_id_patient_id_practice_id_l_fkey",columns:[table.appointmentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[appointments.id, appointments.patientId, appointments.practiceId, appointments.locationId]}),
  foreignKey({name:"prepared_documents_requirement_id_patient_id_practice_id_l_fkey",columns:[table.requirementId, table.patientId, table.practiceId, table.locationId],foreignColumns:[visitRequirements.id, visitRequirements.patientId, visitRequirements.practiceId, visitRequirements.locationId]}),
  foreignKey({name:"prepared_documents_template_version_id_practice_id_fkey",columns:[table.templateVersionId, table.practiceId],foreignColumns:[templateVersions.id, templateVersions.practiceId]}),
  foreignKey({name:"prepared_documents_rendered_source_version_id_patient_id_p_fkey",columns:[table.renderedSourceVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_form_scope",{for:"all",to:["public"],using:sql`careiq_patient_form_scope(id)`,withCheck:sql`careiq_patient_form_scope(id)`})
]).enableRLS();

export const documentRequests = pgTable("document_requests", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id"),
	deliveryGeneration: integer("delivery_generation").default(1).notNull(),
	purpose: text().notNull(),
	formCompletionPolicy: text("form_completion_policy"),
	recipientName: text("recipient_name").notNull(),
	recipientEmail: text("recipient_email"),
	recipientPhone: text("recipient_phone"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'date' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	state: text().default('draft').notNull(),
	assigneeUserId: text("assignee_user_id"),
	reasonCode: text("reason_code"),
	createdByActorId: text("created_by_actor_id").notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("document_requests_scope_created_idx").on(table.practiceId,table.locationId,table.createdAt.desc(),table.id.desc()),
  check("document_requests_purpose_check",sql`(purpose = ANY (ARRAY['collection'::text, 'signature'::text, 'replacement'::text, 'form_completion'::text]))`),
  check("document_requests_state_check",sql`(state = ANY (ARRAY['draft'::text, 'open'::text, 'completed'::text, 'declined'::text, 'cancelled'::text, 'expired'::text]))`),
  check("document_requests_form_policy_check",sql`((purpose='form_completion' AND form_completion_policy IS NOT NULL AND form_completion_policy IN ('form_only','form_then_sign')) OR (purpose<>'form_completion' AND form_completion_policy IS NULL))`),
  check("document_requests_delivery_generation_check",sql`delivery_generation>0`),
  check("document_requests_revision_check",sql`(revision > 0)`),
  unique("document_requests_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_requests_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"document_requests_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_requests_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_requests_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_requests_appointment_id_patient_id_practice_id_lo_fkey",columns:[table.appointmentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[appointments.id, appointments.patientId, appointments.practiceId, appointments.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('document_requests'::text, to_jsonb(document_requests.*))`,withCheck:sql`careiq_patient_scope('document_requests'::text, to_jsonb(document_requests.*))`})
]).enableRLS();

export const documentRequestItems = pgTable("document_request_items", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requestId: uuid("request_id").notNull(),
	requirementId: uuid("requirement_id"),
	preparedDocumentId: uuid("prepared_document_id"),
	documentTypeId: uuid("document_type_id").notNull(),
	sourceVersionId: uuid("source_version_id"),
	fulfilledVersionId: uuid("fulfilled_version_id"),
	state: text().default('open').notNull(),
	isOpen: boolean("is_open").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  uniqueIndex("request_item_prepared_unique").on(table.preparedDocumentId).where(sql`prepared_document_id IS NOT NULL`),
  foreignKey({name:"request_item_prepared_scope_fk",columns:[table.preparedDocumentId,table.patientId,table.practiceId,table.locationId],foreignColumns:[preparedDocuments.id,preparedDocuments.patientId,preparedDocuments.practiceId,preparedDocuments.locationId]}),
  check("document_request_items_state_check",sql`(state = ANY (ARRAY['open'::text, 'fulfilled'::text, 'cancelled'::text]))`),
  check("document_request_items_revision_check",sql`(revision > 0)`),
  check("document_request_items_check",sql`(is_open = (state = 'open'::text))`),
  unique("document_request_items_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_request_items_id_patient_id_practice_id_location_i_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("document_request_items_request_id_requirement_id_key").on(table.requestId, table.requirementId),
  foreignKey({name:"document_request_items_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_request_items_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_request_items_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_request_items_request_id_patient_id_practice_id_l_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  foreignKey({name:"document_request_items_requirement_id_patient_id_practice__fkey",columns:[table.requirementId, table.patientId, table.practiceId, table.locationId],foreignColumns:[visitRequirements.id, visitRequirements.patientId, visitRequirements.practiceId, visitRequirements.locationId]}),
  foreignKey({name:"document_request_items_document_type_id_practice_id_fkey",columns:[table.documentTypeId, table.practiceId],foreignColumns:[documentTypes.id, documentTypes.practiceId]}),
  foreignKey({name:"document_request_items_source_version_id_patient_id_practi_fkey",columns:[table.sourceVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"document_request_items_fulfilled_version_id_patient_id_pra_fkey",columns:[table.fulfilledVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  uniqueIndex("document_request_items_one_open").on(table.requirementId).where(sql`is_open`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('document_request_items'::text, to_jsonb(document_request_items.*))`,withCheck:sql`careiq_patient_scope('document_request_items'::text, to_jsonb(document_request_items.*))`})
]).enableRLS();

export const patientAccessGrants = pgTable("patient_access_grants", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requestId: uuid("request_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	purpose: text().default('request_access').notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("patient_access_grants_token_hash_check",sql`(token_hash ~ '^[0-9a-f]{64}$'::text)`),
  check("patient_access_grants_revision_check",sql`(revision > 0)`),
  unique("patient_access_grants_token_hash_key").on(table.tokenHash),
  unique("patient_access_grants_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("patient_access_grants_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"patient_access_grants_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"patient_access_grants_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"patient_access_grants_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"patient_access_grants_request_id_patient_id_practice_id_lo_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  unique("patient_access_grants_request_scope_key").on(table.id, table.requestId, table.patientId, table.practiceId, table.locationId),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('patient_access_grants'::text, to_jsonb(patient_access_grants.*))`,withCheck:sql`careiq_patient_scope('patient_access_grants'::text, to_jsonb(patient_access_grants.*))`})
]).enableRLS();

export const patientSessions = pgTable("patient_sessions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requestId: uuid("request_id").notNull(),
	grantId: uuid("grant_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	requestRevision: bigint("request_revision", { mode: "number" }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	verificationMethod: text("verification_method").default('email_link').notNull(),
	assurance: text().default('link_possession').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("patient_sessions_token_hash_check",sql`(token_hash ~ '^[0-9a-f]{64}$'::text)`),
  check("patient_sessions_request_revision_check",sql`(request_revision > 0)`),
  check("patient_sessions_revision_check",sql`(revision > 0)`),
  unique("patient_sessions_token_hash_key").on(table.tokenHash),
  unique("patient_sessions_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("patient_sessions_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("patient_sessions_id_request_id_patient_id_practice_id_locat_key").on(table.id, table.requestId, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"patient_sessions_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"patient_sessions_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"patient_sessions_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"patient_sessions_request_id_patient_id_practice_id_locatio_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  foreignKey({name:"patient_sessions_grant_id_patient_id_practice_id_location__fkey",columns:[table.grantId, table.patientId, table.practiceId, table.locationId],foreignColumns:[patientAccessGrants.id, patientAccessGrants.patientId, patientAccessGrants.practiceId, patientAccessGrants.locationId]}),
  foreignKey({name:"patient_sessions_grant_request_fk",columns:[table.grantId, table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[patientAccessGrants.id, patientAccessGrants.requestId, patientAccessGrants.patientId, patientAccessGrants.practiceId, patientAccessGrants.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('patient_sessions'::text, to_jsonb(patient_sessions.*))`,withCheck:sql`careiq_patient_scope('patient_sessions'::text, to_jsonb(patient_sessions.*))`})
]).enableRLS();

export const signaturePackets = pgTable("signature_packets", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requestId: uuid("request_id").notNull(),
	sourceVersionId: uuid("source_version_id").notNull(),
	recipientSnapshot: jsonb("recipient_snapshot").default({}).notNull(),
	state: text().default('pending').notNull(),
	consentTextVersion: text("consent_text_version").notNull(),
	consentText: text("consent_text").notNull(),
	consentHash: text("consent_hash").notNull(),
	outputVersionId: uuid("output_version_id"),
	evidenceObjectId: uuid("evidence_object_id"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("signature_packets_output_idx").on(table.practiceId,table.locationId,table.outputVersionId).where(sql`output_version_id IS NOT NULL`),
  foreignKey({name:"signature_packets_evidence_object_id_patient_id_practice_i_fkey",columns:[table.evidenceObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  check("signature_packets_state_check",sql`(state = ANY (ARRAY['pending'::text, 'completing'::text, 'completed'::text, 'declined'::text, 'cancelled'::text, 'expired'::text, 'failed'::text]))`),
  check("signature_packets_consent_hash_check",sql`(consent_hash ~ '^[0-9a-f]{64}$'::text)`),
  check("signature_packets_revision_check",sql`(revision > 0)`),
  unique("signature_packets_request_id_key").on(table.requestId),
  unique("signature_packets_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("signature_packets_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"signature_packets_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"signature_packets_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"signature_packets_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"signature_packets_request_id_patient_id_practice_id_locati_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  foreignKey({name:"signature_packets_source_version_id_patient_id_practice_id_fkey",columns:[table.sourceVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"signature_packets_output_version_id_patient_id_practice_id_fkey",columns:[table.outputVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('signature_packets'::text, to_jsonb(signature_packets.*))`,withCheck:sql`careiq_patient_scope('signature_packets'::text, to_jsonb(signature_packets.*))`})
]).enableRLS();

export const signatureFields = pgTable("signature_fields", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	packetId: uuid("packet_id").notNull(),
	fieldKey: text("field_key").notNull(),
	page: integer().notNull(),
	x: numeric().notNull(),
	y: numeric().notNull(),
	width: numeric().notNull(),
	height: numeric().notNull(),
	fieldType: text("field_type").notNull(),
	required: boolean().default(true).notNull(),
	enteredValue: text("entered_value"),
	privateArtifactReference: text("private_artifact_reference"),
	signedAt: timestamp("signed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("signature_fields_page_check",sql`(page > 0)`),
  check("signature_fields_x_check",sql`((x >= (0)::numeric) AND (x <= (1)::numeric))`),
  check("signature_fields_y_check",sql`((y >= (0)::numeric) AND (y <= (1)::numeric))`),
  check("signature_fields_width_check",sql`((width > (0)::numeric) AND (width <= (1)::numeric))`),
  check("signature_fields_height_check",sql`((height > (0)::numeric) AND (height <= (1)::numeric))`),
  check("signature_fields_field_type_check",sql`(field_type = ANY (ARRAY['signature'::text, 'initials'::text, 'name'::text, 'date'::text, 'text'::text, 'checkbox'::text]))`),
  check("signature_fields_revision_check",sql`(revision > 0)`),
  check("signature_fields_check",sql`(((x + width) <= (1)::numeric) AND ((y + height) <= (1)::numeric))`),
  unique("signature_fields_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("signature_fields_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("signature_fields_packet_id_field_key_key").on(table.packetId, table.fieldKey),
  foreignKey({name:"signature_fields_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"signature_fields_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"signature_fields_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"signature_fields_packet_id_patient_id_practice_id_location_fkey",columns:[table.packetId, table.patientId, table.practiceId, table.locationId],foreignColumns:[signaturePackets.id, signaturePackets.patientId, signaturePackets.practiceId, signaturePackets.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('signature_fields'::text, to_jsonb(signature_fields.*))`,withCheck:sql`careiq_patient_scope('signature_fields'::text, to_jsonb(signature_fields.*))`})
]).enableRLS();

export const signatureEvents = pgTable("signature_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	packetId: uuid("packet_id").notNull(),
	auditEventId: uuid("audit_event_id").notNull(),
	eventType: text("event_type").notNull(),
	actorType: text("actor_type").notNull(),
	actorId: text("actor_id").notNull(),
	patientSessionId: uuid("patient_session_id"),
	sourceHash: text("source_hash"),
	consentHash: text("consent_hash"),
	evidenceMetadata: jsonb("evidence_metadata").default({}).notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("signature_events_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("signature_events_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"signature_events_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"signature_events_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"signature_events_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"signature_events_packet_id_patient_id_practice_id_location_fkey",columns:[table.packetId, table.patientId, table.practiceId, table.locationId],foreignColumns:[signaturePackets.id, signaturePackets.patientId, signaturePackets.practiceId, signaturePackets.locationId]}),
  foreignKey({name:"signature_events_patient_session_id_patient_id_practice_id_fkey",columns:[table.patientSessionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[patientSessions.id, patientSessions.patientId, patientSessions.practiceId, patientSessions.locationId]}),
  foreignKey({name:"signature_events_audit_event_id_fk",columns:[table.auditEventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('signature_events'::text, to_jsonb(signature_events.*))`,withCheck:sql`careiq_patient_scope('signature_events'::text, to_jsonb(signature_events.*))`})
]).enableRLS();

export const documentAccessGrants = pgTable("document_access_grants", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentVersionId: uuid("document_version_id").notNull(),
	fileObjectId: uuid("file_object_id").notNull(),
	actorUserId: text("actor_user_id"),
	patientSessionId: uuid("patient_session_id"),
	purpose: text().notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	issuingAuditEventId: uuid("issuing_audit_event_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("document_access_grants_purpose_check",sql`(purpose = ANY (ARRAY['view'::text, 'download'::text, 'print'::text, 'export'::text, 'sign'::text]))`),
  check("document_access_grants_revision_check",sql`(revision > 0)`),
  unique("document_access_grants_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_access_grants_id_patient_id_practice_id_location_i_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"document_access_grants_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_access_grants_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_access_grants_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_access_grants_document_version_id_patient_id_prac_fkey",columns:[table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"document_access_grants_file_object_id_patient_id_practice__fkey",columns:[table.fileObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  foreignKey({name:"document_access_grants_patient_session_id_patient_id_pract_fkey",columns:[table.patientSessionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[patientSessions.id, patientSessions.patientId, patientSessions.practiceId, patientSessions.locationId]}),
  foreignKey({name:"document_access_grants_issuing_audit_event_id_fk",columns:[table.issuingAuditEventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const fileAccessObservations = pgTable("file_access_observations", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	accessGrantId: uuid("access_grant_id").notNull(),
	fileObjectId: uuid("file_object_id").notNull(),
	documentVersionId: uuid("document_version_id").notNull(),
	observer: text().notNull(),
	providerEventId: text("provider_event_id").notNull(),
	observedAt: timestamp("observed_at", { withTimezone: true, mode: 'date' }).notNull(),
	result: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytesTransferred: bigint("bytes_transferred", { mode: "number" }),
	auditEventId: uuid("audit_event_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("file_access_observations_observer_check",sql`(observer = ANY (ARRAY['gateway'::text, 'storage'::text, 'client'::text]))`),
  check("file_access_observations_bytes_transferred_check",sql`(bytes_transferred >= 0)`),
  unique("file_access_observations_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("file_access_observations_id_patient_id_practice_id_location_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("file_access_observations_observer_provider_event_id_key").on(table.observer, table.providerEventId),
  foreignKey({name:"file_access_observations_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"file_access_observations_patient_id_practice_id_location_i_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"file_access_observations_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"file_access_observations_access_grant_id_patient_id_practi_fkey",columns:[table.accessGrantId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentAccessGrants.id, documentAccessGrants.patientId, documentAccessGrants.practiceId, documentAccessGrants.locationId]}),
  foreignKey({name:"file_access_observations_file_object_id_patient_id_practic_fkey",columns:[table.fileObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  foreignKey({name:"file_access_observations_document_version_id_patient_id_pr_fkey",columns:[table.documentVersionId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentVersions.id, documentVersions.patientId, documentVersions.practiceId, documentVersions.locationId]}),
  foreignKey({name:"file_access_observations_audit_event_id_fk",columns:[table.auditEventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const documentRetention = pgTable("document_retention", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentId: uuid("document_id").notNull(),
	policyReference: text("policy_reference").notNull(),
	retainUntil: timestamp("retain_until", { withTimezone: true, mode: 'date' }),
	dispositionStatus: text("disposition_status").default('retained').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("document_retention_disposition_status_check",sql`(disposition_status = ANY (ARRAY['retained'::text, 'review_required'::text, 'approved'::text, 'disposed'::text]))`),
  check("document_retention_revision_check",sql`(revision > 0)`),
  unique("document_retention_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("document_retention_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("document_retention_document_id_key").on(table.documentId),
  foreignKey({name:"document_retention_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_retention_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_retention_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_retention_document_id_patient_id_practice_id_loca_fkey",columns:[table.documentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documents.id, documents.patientId, documents.practiceId, documents.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const documentHolds = pgTable("document_holds", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	documentId: uuid("document_id").notNull(),
	reasonReference: text("reason_reference").notNull(),
	placedByActorId: text("placed_by_actor_id").notNull(),
	placedAt: timestamp("placed_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	releasedByActorId: text("released_by_actor_id"),
	releasedAt: timestamp("released_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("document_holds_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  check("document_holds_revision_check",sql`(revision > 0)`),
  check("document_holds_check",sql`((released_at IS NULL) = (released_by_actor_id IS NULL))`),
  unique("document_holds_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"document_holds_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"document_holds_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"document_holds_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"document_holds_document_id_patient_id_practice_id_location_fkey",columns:[table.documentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documents.id, documents.patientId, documents.practiceId, documents.locationId]}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const workflowOperations = pgTable("workflow_operations", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	operationType: text("operation_type").notNull(),
	initiatingActorType: text("initiating_actor_type").default('user').notNull(),
	initiatingActorId: text("initiating_actor_id").notNull(),
	targetType: text("target_type"),
	targetId: uuid("target_id"),
	commandFingerprint: text("command_fingerprint").notNull(),
	state: text().default('queued').notNull(),
	requestId: uuid("request_id"),
	workflowId: uuid("workflow_id"),
	causationEventId: uuid("causation_event_id"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	resultType: text("result_type"),
	resultId: uuid("result_id"),
	failureCode: text("failure_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
	patientRequestId: uuid("patient_request_id"),
}, (table): PgTableExtraConfigValue[] => [
  check("workflow_operations_command_fingerprint_check",sql`(command_fingerprint ~ '^[0-9a-f]{64}$'::text)`),
  check("workflow_operations_state_check",sql`(state = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))`),
  check("workflow_operations_revision_check",sql`(revision > 0)`),
  unique("workflow_operations_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  foreignKey({name:"workflow_operations_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"workflow_operations_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"workflow_operations_patient_request_scope_fk",columns:[table.patientRequestId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.practiceId, documentRequests.locationId]}),
  foreignKey({name:"workflow_operations_causation_event_id_fk",columns:[table.causationEventId],foreignColumns:[eventsInAudit.id]}),
  uniqueIndex("workflow_operations_signature_completion_unique").on(table.practiceId, table.locationId, table.patientRequestId).where(sql`((operation_type = 'signature_completion'::text) AND (state = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text])))`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('workflow_operations'::text, to_jsonb(workflow_operations.*))`,withCheck:sql`careiq_patient_scope('workflow_operations'::text, to_jsonb(workflow_operations.*))`})
]).enableRLS();

export const workflowRequestKeys = pgTable("workflow_request_keys", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	actorUserId: text("actor_user_id").notNull(),
	requestKey: text("request_key").notNull(),
	requestHash: text("request_hash").notNull(),
	operation: text().notNull(),
	targetId: text("target_id").default('').notNull(),
	resultType: text("result_type"),
	resourceId: uuid("resource_id"),
	operationId: uuid("operation_id"),
	response: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("workflow_request_keys_request_key_check",sql`((length(request_key) >= 1) AND (length(request_key) <= 128))`),
  check("workflow_request_keys_request_hash_check",sql`(request_hash ~ '^[0-9a-f]{64}$'::text)`),
  check("workflow_request_keys_response_check",sql`(jsonb_typeof(response) = 'object'::text)`),
  check("workflow_request_keys_revision_check",sql`(revision > 0)`),
  unique("workflow_request_keys_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("workflow_request_keys_practice_id_location_id_actor_user_id_key").on(table.practiceId, table.locationId, table.actorUserId, table.requestKey),
  foreignKey({name:"workflow_request_keys_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"workflow_request_keys_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"workflow_request_keys_operation_id_practice_id_location_id_fkey",columns:[table.operationId, table.practiceId, table.locationId],foreignColumns:[workflowOperations.id, workflowOperations.practiceId, workflowOperations.locationId]}),
  pgPolicy("patient_request_retry_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_patient_scope('document_requests'::text, jsonb_build_object('id', target_id, 'practice_id', practice_id, 'location_id', location_id)) AND (actor_user_id = (careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) ->> 'session_id'::text)))`,withCheck:sql`(careiq_patient_scope('document_requests'::text, jsonb_build_object('id', target_id, 'practice_id', practice_id, 'location_id', location_id)) AND (actor_user_id = (careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) ->> 'session_id'::text)))`}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const jobRuns = pgTable("job_runs", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	operationId: uuid("operation_id").notNull(),
	jobType: text("job_type").notNull(),
	jobVersion: text("job_version").notNull(),
	attempt: integer().notNull(),
	executorId: text("executor_id").notNull(),
	fencingToken: uuid("fencing_token").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'date' }),
	state: text().default('running').notNull(),
	inputReferences: jsonb("input_references").default({}).notNull(),
	outputReferences: jsonb("output_references").default({}).notNull(),
	failureCode: text("failure_code"),
	auditEventId: uuid("audit_event_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("job_runs_attempt_check",sql`(attempt > 0)`),
  check("job_runs_state_check",sql`(state = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'lost_lease'::text]))`),
  check("job_runs_revision_check",sql`(revision > 0)`),
  unique("job_runs_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("job_runs_operation_id_job_type_attempt_key").on(table.operationId, table.jobType, table.attempt),
  foreignKey({name:"job_runs_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"job_runs_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"job_runs_operation_id_practice_id_location_id_fkey",columns:[table.operationId, table.practiceId, table.locationId],foreignColumns:[workflowOperations.id, workflowOperations.practiceId, workflowOperations.locationId]}),
  foreignKey({name:"job_runs_audit_event_id_fk",columns:[table.auditEventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("patient_job_run_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('workflow_operations'::text, ( SELECT to_jsonb(o.*) AS to_jsonb
   FROM workflow_operations o
  WHERE ((o.id = job_runs.operation_id) AND (o.practice_id = job_runs.practice_id) AND (o.location_id = job_runs.location_id))))`,withCheck:sql`careiq_patient_scope('workflow_operations'::text, ( SELECT to_jsonb(o.*) AS to_jsonb
   FROM workflow_operations o
  WHERE ((o.id = job_runs.operation_id) AND (o.practice_id = job_runs.practice_id) AND (o.location_id = job_runs.location_id))))`}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const fileScanRuns = pgTable("file_scan_runs", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	fileObjectId: uuid("file_object_id").notNull(),
	jobRunId: uuid("job_run_id"),
	attempt: integer().notNull(),
	scannerVersion: text("scanner_version").notNull(),
	rulesetVersion: text("ruleset_version").notNull(),
	verifiedStorageVersion: text("verified_storage_version").notNull(),
	verifiedSha256: text("verified_sha256").notNull(),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	verdict: text().notNull(),
	failureCode: text("failure_code"),
	auditEventId: uuid("audit_event_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("file_scan_runs_verdict_check",sql`(verdict = ANY (ARRAY['clean'::text, 'unsafe'::text, 'error'::text, 'unknown'::text]))`),
  check("file_scan_runs_attempt_check",sql`(attempt > 0)`),
  check("file_scan_runs_verified_sha256_check",sql`(verified_sha256 ~ '^[0-9a-f]{64}$'::text)`),
  unique("file_scan_runs_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("file_scan_runs_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("file_scan_runs_file_object_id_attempt_key").on(table.fileObjectId, table.attempt),
  foreignKey({name:"file_scan_runs_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"file_scan_runs_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"file_scan_runs_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"file_scan_runs_file_object_id_patient_id_practice_id_locat_fkey",columns:[table.fileObjectId, table.patientId, table.practiceId, table.locationId],foreignColumns:[fileObjects.id, fileObjects.patientId, fileObjects.practiceId, fileObjects.locationId]}),
  foreignKey({name:"file_scan_runs_job_run_id_practice_id_location_id_fkey",columns:[table.jobRunId, table.practiceId, table.locationId],foreignColumns:[jobRuns.id, jobRuns.practiceId, jobRuns.locationId]}),
  foreignKey({name:"file_scan_runs_audit_event_id_fk",columns:[table.auditEventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("patient_scan_run_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('file_objects'::text, ( SELECT to_jsonb(f.*) AS to_jsonb
   FROM file_objects f
  WHERE ((f.id = file_scan_runs.file_object_id) AND (f.patient_id = file_scan_runs.patient_id) AND (f.practice_id = file_scan_runs.practice_id) AND (f.location_id = file_scan_runs.location_id))))`,withCheck:sql`careiq_patient_scope('file_objects'::text, ( SELECT to_jsonb(f.*) AS to_jsonb
   FROM file_objects f
  WHERE ((f.id = file_scan_runs.file_object_id) AND (f.patient_id = file_scan_runs.patient_id) AND (f.practice_id = file_scan_runs.practice_id) AND (f.location_id = file_scan_runs.location_id))))`}),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const deliveryAttempts = pgTable("delivery_attempts", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	requestId: uuid("request_id").notNull(),
	intentId: uuid("intent_id"),
	externalKey: text("external_key"),
	providerAccount: text("provider_account"),
	renderHash: text("render_hash"),
	purpose: text().notNull(),
	sequence: integer().notNull(),
	channel: text().notNull(),
	destinationSnapshot: text("destination_snapshot"),
	providerId: text("provider_id"),
	providerMessageId: text("provider_message_id"),
	state: text().default('queued').notNull(),
	failureCode: text("failure_code"),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'date' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	dedupeKey: text("dedupe_key").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  foreignKey({name:"delivery_attempt_intent_scope_fk",columns:[table.intentId,table.patientId,table.practiceId,table.locationId],foreignColumns:[deliveryIntents.id,deliveryIntents.patientId,deliveryIntents.practiceId,deliveryIntents.locationId]}),
  check("delivery_attempts_purpose_check",sql`(purpose = ANY (ARRAY['initial'::text, 'reminder'::text, 'reissue'::text, 'paperwork_ready'::text, 'paperwork_resend'::text]))`),
  check("delivery_attempts_sequence_check",sql`(sequence > 0)`),
  check("delivery_attempts_channel_check",sql`(channel = ANY (ARRAY['email'::text, 'sms'::text, 'local_review'::text]))`),
  check("delivery_attempts_state_check",sql`(state = ANY (ARRAY['queued'::text, 'submitting'::text, 'accepted'::text, 'delivered'::text, 'failed'::text, 'unknown'::text]))`),
  check("delivery_attempts_revision_check",sql`(revision > 0)`),
  unique("delivery_attempts_dedupe_key_key").on(table.dedupeKey),
  unique("delivery_attempts_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("delivery_attempts_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  unique("delivery_attempts_request_id_sequence_key").on(table.requestId, table.sequence),
  foreignKey({name:"delivery_attempts_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"delivery_attempts_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"delivery_attempts_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"delivery_attempts_request_id_patient_id_practice_id_locati_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  unique("delivery_attempts_id_practice_unique").on(table.id, table.practiceId),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const workItems = pgTable("work_items", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id"),
	requirementId: uuid("requirement_id"),
	requestId: uuid("request_id"),
	notificationDueGeneration: bigint("notification_due_generation", {mode:"number"}).default(1).notNull(),
	notificationOwnerGeneration: bigint("notification_owner_generation", {mode:"number"}).default(1).notNull(),
	kind: text().notNull(),
	assigneeUserId: text("assignee_user_id"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'date' }),
	priority: text().default('normal').notNull(),
	state: text().default('open').notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	completionReasonCode: text("completion_reason_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index("work_items_scope_created_idx").on(table.practiceId,table.locationId,table.createdAt.desc(),table.id.desc()),
  foreignKey({name:"work_items_requirement_id_patient_id_practice_id_location__fkey",columns:[table.requirementId, table.patientId, table.practiceId, table.locationId],foreignColumns:[visitRequirements.id, visitRequirements.patientId, visitRequirements.practiceId, visitRequirements.locationId]}),
  foreignKey({name:"work_items_request_id_patient_id_practice_id_location_id_fkey",columns:[table.requestId, table.patientId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.patientId, documentRequests.practiceId, documentRequests.locationId]}),
  check("work_items_kind_check",sql`(kind = ANY (ARRAY['collect'::text, 'review'::text, 'replace'::text, 'delivery_follow_up'::text]))`),
  check("work_items_priority_check",sql`(priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))`),
  check("work_items_state_check",sql`(state = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))`),
  check("work_items_revision_check",sql`(revision > 0)`),
  unique("work_items_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  unique("work_items_id_patient_id_practice_id_location_id_key").on(table.id, table.patientId, table.practiceId, table.locationId),
  foreignKey({name:"work_items_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"work_items_patient_id_practice_id_location_id_fkey",columns:[table.patientId, table.practiceId, table.locationId],foreignColumns:[patients.id, patients.practiceId, patients.locationId]}),
  foreignKey({name:"work_items_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"work_items_appointment_id_patient_id_practice_id_location__fkey",columns:[table.appointmentId, table.patientId, table.practiceId, table.locationId],foreignColumns:[appointments.id, appointments.patientId, appointments.practiceId, appointments.locationId]}),
  uniqueIndex("work_items_active_requirement_kind").on(table.practiceId, table.locationId, table.requirementId, table.kind).where(sql`((requirement_id IS NOT NULL) AND (state = ANY (ARRAY['open'::text, 'in_progress'::text])))`),
  index("work_items_queue_idx").on(table.practiceId, table.locationId, table.state, table.dueAt, table.id),
  uniqueIndex("work_items_active_delivery").on(table.practiceId, table.locationId, table.requestId, table.kind).where(sql`((kind = 'delivery_follow_up'::text) AND (state = ANY (ARRAY['open'::text, 'in_progress'::text])))`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`})
]).enableRLS();

export const outboxEvents = pgTable("outbox_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	practiceId: uuid("practice_id").notNull(),
	locationId: uuid("location_id").notNull(),
	operationId: uuid("operation_id"),
	causationEventId: uuid("causation_event_id"),
	eventType: text("event_type").notNull(),
	aggregateId: uuid("aggregate_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	aggregateRevision: bigint("aggregate_revision", { mode: "number" }).notNull(),
	payload: jsonb().default({}).notNull(),
	availableAt: timestamp("available_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	attemptCount: integer("attempt_count").default(0).notNull(),
	leaseToken: uuid("lease_token"),
	leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: 'date' }),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'date' }),
	lastFailureCode: text("last_failure_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revision: bigint({ mode: "number" }).default(1).notNull(),
	patientRequestId: uuid("patient_request_id"),
}, (table): PgTableExtraConfigValue[] => [
  check("outbox_events_aggregate_revision_check",sql`(aggregate_revision > 0)`),
  check("outbox_events_payload_check",sql`(jsonb_typeof(payload) = 'object'::text)`),
  check("outbox_events_attempt_count_check",sql`(attempt_count >= 0)`),
  check("outbox_events_revision_check",sql`(revision > 0)`),
  unique("outbox_events_id_practice_id_location_id_key").on(table.id, table.practiceId, table.locationId),
  foreignKey({name:"outbox_events_practice_id_fkey",columns:[table.practiceId],foreignColumns:[practices.id]}),
  foreignKey({name:"outbox_events_location_id_practice_id_fkey",columns:[table.locationId, table.practiceId],foreignColumns:[locations.id, locations.practiceId]}),
  foreignKey({name:"outbox_events_operation_id_practice_id_location_id_fkey",columns:[table.operationId, table.practiceId, table.locationId],foreignColumns:[workflowOperations.id, workflowOperations.practiceId, workflowOperations.locationId]}),
  foreignKey({name:"outbox_events_patient_request_scope_fk",columns:[table.patientRequestId, table.practiceId, table.locationId],foreignColumns:[documentRequests.id, documentRequests.practiceId, documentRequests.locationId]}),
  foreignKey({name:"outbox_events_causation_event_id_fk",columns:[table.causationEventId],foreignColumns:[eventsInAudit.id]}),
  index("outbox_events_pending_idx").on(table.availableAt, table.id).where(sql`(published_at IS NULL)`),
  pgPolicy("workflow_scope",{as:"permissive",for:"all",to:["public"],using:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`,withCheck:sql`(careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text)))`}),
  pgPolicy("patient_request_scope",{as:"permissive",for:"all",to:["public"],using:sql`careiq_patient_scope('outbox_events'::text, to_jsonb(outbox_events.*))`,withCheck:sql`careiq_patient_scope('outbox_events'::text, to_jsonb(outbox_events.*))`})
]).enableRLS();

export const eventsInAudit = audit.table("events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	schemaVersion: integer("schema_version").default(1).notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull(),
	clockSource: text("clock_source").default('server').notNull(),
	scopeKind: text("scope_kind").notNull(),
	practiceId: uuid("practice_id"),
	locationId: uuid("location_id"),
	actorType: text("actor_type").notNull(),
	actorId: text("actor_id"),
	initiatingActorType: text("initiating_actor_type"),
	initiatingActorId: text("initiating_actor_id"),
	effectivePrincipalId: text("effective_principal_id"),
	executorId: text("executor_id"),
	channel: text().default('api').notNull(),
	action: varchar({ length: 96 }).notNull(),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	outcome: text().notNull(),
	reasonCode: varchar("reason_code", { length: 96 }),
	requestId: uuid("request_id"),
	operationId: uuid("operation_id"),
	workflowId: uuid("workflow_id"),
	causationEventId: uuid("causation_event_id"),
	replayedEventId: uuid("replayed_event_id"),
	jobRunId: uuid("job_run_id"),
	providerReceiptId: uuid("provider_receipt_id"),
	transactionId: uuid("transaction_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	databaseTransactionId: bigint("database_transaction_id", { mode: "number" }).default(sql`txid_current()`).notNull(),
	authorizationContext: jsonb("authorization_context").default({}).notNull(),
	metadata: jsonb().default({}).notNull(),
	retainUntil: timestamp("retain_until", { withTimezone: true, mode: 'date' }).default(sql`(clock_timestamp() + '6 years'::interval)`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("events_schema_version_check",sql`(schema_version > 0)`),
  check("events_scope_kind_check",sql`(scope_kind = ANY (ARRAY['platform'::text, 'practice'::text, 'location'::text]))`),
  check("events_actor_type_check",sql`(actor_type = ANY (ARRAY['user'::text, 'patient_session'::text, 'service'::text, 'background_job'::text, 'integration'::text, 'administrator'::text, 'migration'::text, 'anonymous'::text]))`),
  check("events_action_check",sql`(length((action)::text) > 0)`),
  check("events_outcome_check",sql`(outcome = ANY (ARRAY['accepted'::text, 'succeeded'::text, 'denied'::text, 'rejected'::text, 'failed'::text, 'unknown'::text]))`),
  check("events_authorization_context_check",sql`(jsonb_typeof(authorization_context) = 'object'::text)`),
  check("events_metadata_check",sql`((jsonb_typeof(metadata) = 'object'::text) AND (octet_length((metadata)::text) <= 8192))`),
  check("events_check",sql`(((scope_kind = 'platform'::text) AND (practice_id IS NULL) AND (location_id IS NULL)) OR ((scope_kind = 'practice'::text) AND (practice_id IS NOT NULL) AND (location_id IS NULL)) OR ((scope_kind = 'location'::text) AND (practice_id IS NOT NULL) AND (location_id IS NOT NULL)))`),
  check("events_check1",sql`((actor_id IS NOT NULL) OR (actor_type = 'anonymous'::text))`),
  foreignKey({name:"events_causation_event_id_fkey",columns:[table.causationEventId],foreignColumns:[eventsInAudit.id]}),
  foreignKey({name:"events_replayed_event_id_fkey",columns:[table.replayedEventId],foreignColumns:[eventsInAudit.id]}),
  index("events_transaction_idx").on(table.transactionId, table.recordedAt, table.id),
  index("events_scope_time_idx").on(table.practiceId, table.locationId, table.recordedAt, table.id),
  index("events_operation_idx").on(table.operationId, table.recordedAt, table.id).where(sql`(operation_id IS NOT NULL)`),
  pgPolicy("audit_reader_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(practice_id = careiq_context_uuid('app.practice_id'::text))`})
]).enableRLS();

export const databaseRecordsInAudit = audit.table("database_records", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull(),
	schemaName: text("schema_name").notNull(),
	tableName: text("table_name").notNull(),
	operation: text().notNull(),
	rowKey: jsonb("row_key").notNull(),
	practiceId: uuid("practice_id"),
	locationId: uuid("location_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revisionBefore: bigint("revision_before", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	revisionAfter: bigint("revision_after", { mode: "number" }),
	changedFields: text("changed_fields").array().notNull(),
	beforeEvidence: jsonb("before_evidence").default({}).notNull(),
	afterEvidence: jsonb("after_evidence").default({}).notNull(),
	transactionId: uuid("transaction_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	databaseTransactionId: bigint("database_transaction_id", { mode: "number" }).default(sql`txid_current()`).notNull(),
	statementAt: timestamp("statement_at", { withTimezone: true, mode: 'date' }).default(sql`statement_timestamp()`).notNull(),
	applicationEventId: uuid("application_event_id"),
	actorContext: text("actor_context"),
	authenticatedLogin: text("authenticated_login").notNull(),
	executionRole: text("execution_role").notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("database_records_operation_check",sql`(operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text]))`),
  foreignKey({name:"database_records_application_event_id_fkey",columns:[table.applicationEventId],foreignColumns:[eventsInAudit.id]}),
  index("database_records_transaction_idx").on(table.transactionId),
  index("database_records_scope_time_idx").on(table.practiceId, table.locationId, table.recordedAt, table.id),
  pgPolicy("audit_reader_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(practice_id = careiq_context_uuid('app.practice_id'::text))`})
]).enableRLS();

export const archiveManifestsInAudit = audit.table("archive_manifests", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	practiceId: uuid("practice_id"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	objectReference: text("object_reference").notNull(),
	storageVersion: text("storage_version").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	recordCount: bigint("record_count", { mode: "number" }).notNull(),
	canonicalizationVersion: text("canonicalization_version").notNull(),
	digestAlgorithm: text("digest_algorithm").default('sha256').notNull(),
	digest: text().notNull(),
	signingKeyReference: text("signing_key_reference"),
	verificationStatus: text("verification_status").default('pending').notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'date' }),
	retentionLockReference: text("retention_lock_reference"),
}, (table): PgTableExtraConfigValue[] => [
  check("archive_manifests_record_count_check",sql`(record_count >= 0)`),
  pgPolicy("audit_reader_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(practice_id = careiq_context_uuid('app.practice_id'::text))`})
]).enableRLS();

export const holdEventsInAudit = audit.table("hold_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	holdId: uuid("hold_id").notNull(),
	action: text().notNull(),
	targetEventId: uuid("target_event_id"),
	resourceType: text("resource_type"),
	resourceId: text("resource_id"),
	batchId: uuid("batch_id"),
	practiceId: uuid("practice_id"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }),
	reasonReference: text("reason_reference").notNull(),
	authorityActorId: text("authority_actor_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	releasesEventId: uuid("releases_event_id"),
}, (table): PgTableExtraConfigValue[] => [
  check("hold_events_action_check",sql`(action = ANY (ARRAY['placed'::text, 'released'::text]))`),
  foreignKey({name:"hold_events_target_event_id_fkey",columns:[table.targetEventId],foreignColumns:[eventsInAudit.id]}),
  foreignKey({name:"hold_events_batch_id_fkey",columns:[table.batchId],foreignColumns:[archiveManifestsInAudit.id]}),
  foreignKey({name:"hold_events_releases_event_id_fkey",columns:[table.releasesEventId],foreignColumns:[holdEventsInAudit.id]}),
  pgPolicy("audit_reader_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(practice_id = careiq_context_uuid('app.practice_id'::text))`})
]).enableRLS();

export const changesInAudit = audit.table("changes", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	resourceType: text("resource_type").notNull(),
	resourceId: text("resource_id").notNull(),
	fieldPath: text("field_path").notNull(),
	captureMode: text("capture_mode").notNull(),
	beforeValue: jsonb("before_value"),
	afterValue: jsonb("after_value"),
	protectedReference: text("protected_reference"),
	capturePolicyVersion: integer("capture_policy_version").default(1).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("changes_capture_mode_check",sql`(capture_mode = ANY (ARRAY['value'::text, 'masked'::text, 'changed_only'::text, 'protected_reference'::text]))`),
  check("changes_check",sql`((capture_mode = 'value'::text) OR ((before_value IS NULL) AND (after_value IS NULL)))`),
  foreignKey({name:"changes_event_id_fkey",columns:[table.eventId],foreignColumns:[eventsInAudit.id]}),
  pgPolicy("audit_reader_event_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(EXISTS ( SELECT 1
   FROM audit.events e
  WHERE ((e.id = changes.event_id) AND (e.practice_id = careiq_context_uuid('app.practice_id'::text)))))`})
]).enableRLS();

export const retentionAssignmentsInAudit = audit.table("retention_assignments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	eventId: uuid("event_id"),
	batchId: uuid("batch_id"),
	classification: text().notNull(),
	policyVersion: text("policy_version").notNull(),
	retentionAnchor: timestamp("retention_anchor", { withTimezone: true, mode: 'date' }).notNull(),
	retainUntil: timestamp("retain_until", { withTimezone: true, mode: 'date' }),
	manualReview: boolean("manual_review").default(true).notNull(),
	approvalEventId: uuid("approval_event_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  foreignKey({name:"retention_assignments_approval_event_id_fkey",columns:[table.approvalEventId],foreignColumns:[eventsInAudit.id]}),
  check("retention_assignments_check",sql`((event_id IS NOT NULL) OR (batch_id IS NOT NULL))`),
  foreignKey({name:"retention_assignments_event_id_fkey",columns:[table.eventId],foreignColumns:[eventsInAudit.id]}),
  foreignKey({name:"retention_assignments_batch_id_fkey",columns:[table.batchId],foreignColumns:[archiveManifestsInAudit.id]}),
  pgPolicy("audit_reader_event_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(EXISTS ( SELECT 1
   FROM audit.events e
  WHERE ((e.id = retention_assignments.event_id) AND (e.practice_id = careiq_context_uuid('app.practice_id'::text)))))`})
]).enableRLS();

export const capturePoliciesInAudit = audit.table("capture_policies", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	tableName: text("table_name").notNull(),
	fieldPath: text("field_path").notNull(),
	policyVersion: integer("policy_version").notNull(),
	classification: text().notNull(),
	captureMode: text("capture_mode").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("capture_policies_capture_mode_check",sql`(capture_mode = ANY (ARRAY['value'::text, 'masked'::text, 'changed_only'::text, 'protected_reference'::text]))`),
  unique("capture_policies_table_name_field_path_policy_version_key").on(table.tableName, table.fieldPath, table.policyVersion)
]);

export const eventResourcesInAudit = audit.table("event_resources", {
	eventId: uuid("event_id").notNull(),
	ordinal: integer().notNull(),
	resourceType: text("resource_type").notNull(),
	resourceId: text("resource_id").notNull(),
	relationship: text().notNull(),
	practiceId: uuid("practice_id"),
	locationId: uuid("location_id"),
	patientId: uuid("patient_id"),
}, (table): PgTableExtraConfigValue[] => [
  check("event_resources_ordinal_check",sql`(ordinal >= 0)`),
  check("event_resources_relationship_check",sql`(relationship = ANY (ARRAY['primary'::text, 'affected'::text, 'subject'::text, 'evidence'::text]))`),
  primaryKey({name:"event_resources_pkey",columns:[table.eventId, table.ordinal]}),
  unique("event_resources_event_id_resource_type_resource_id_relation_key").on(table.eventId, table.resourceType, table.resourceId, table.relationship),
  foreignKey({name:"event_resources_event_id_fkey",columns:[table.eventId],foreignColumns:[eventsInAudit.id]}),
  index("event_resources_lookup_idx").on(table.practiceId, table.locationId, table.resourceType, table.resourceId, table.eventId),
  index("event_resources_patient_idx").on(table.practiceId, table.locationId, table.patientId, table.eventId).where(sql`(patient_id IS NOT NULL)`),
  pgPolicy("audit_reader_event_scope",{as:"permissive",for:"select",to:["careiq_audit_reader"],using:sql`(EXISTS ( SELECT 1
   FROM audit.events e
  WHERE ((e.id = event_resources.event_id) AND (e.practice_id = careiq_context_uuid('app.practice_id'::text)))))`})
]).enableRLS();

// Guided-form source facts are immutable, scoped independently from current chart data.
export const formSubmissions = pgTable("form_submissions", {
 id: uuid().default(sql`uuidv7()`).primaryKey().notNull(), practiceId: uuid("practice_id").notNull(), locationId: uuid("location_id").notNull(), patientId: uuid("patient_id").notNull(),
 preparedDocumentId: uuid("prepared_document_id").notNull(), templateVersionId: uuid("template_version_id").notNull(), requestId: uuid("request_id"), documentVersionId: uuid("document_version_id").notNull(),
 schemaVersion: integer("schema_version").notNull(), answers: jsonb().notNull(), activeFieldKeys: jsonb("active_field_keys").default([]).notNull(), rulesetVersion: text("ruleset_version").notNull(),
 schemaHash: text("schema_hash").notNull(), answersHash: text("answers_hash").notNull(), locale: text().notNull(), submittedByActorId: text("submitted_by_actor_id").notNull(), submittedAt: timestamp("submitted_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),
}, table=>[
 unique("form_submissions_id_scope_key").on(table.id,table.patientId,table.practiceId,table.locationId), unique("form_submissions_prepared_key").on(table.preparedDocumentId),
 foreignKey({name:"form_submissions_prepared_fk",columns:[table.preparedDocumentId,table.patientId,table.practiceId,table.locationId],foreignColumns:[preparedDocuments.id,preparedDocuments.patientId,preparedDocuments.practiceId,preparedDocuments.locationId]}),
 foreignKey({name:"form_submissions_version_fk",columns:[table.templateVersionId,table.practiceId],foreignColumns:[templateVersions.id,templateVersions.practiceId]}),
 foreignKey({name:"form_submissions_output_fk",columns:[table.documentVersionId,table.patientId,table.practiceId,table.locationId],foreignColumns:[documentVersions.id,documentVersions.patientId,documentVersions.practiceId,documentVersions.locationId]}),
 foreignKey({name:"form_submissions_request_fk",columns:[table.requestId,table.patientId,table.practiceId,table.locationId],foreignColumns:[documentRequests.id,documentRequests.patientId,documentRequests.practiceId,documentRequests.locationId]}),
 check("form_submissions_source_check",sql`schema_version IN(1,2) AND jsonb_typeof(answers)='object' AND octet_length(answers::text)<=131072 AND jsonb_typeof(active_field_keys)='array' AND schema_hash ~ '^[0-9a-f]{64}$' AND answers_hash ~ '^[0-9a-f]{64}$' AND locale IN('en','es')`),
 index("form_submissions_patient_idx").on(table.practiceId,table.locationId,table.patientId,table.submittedAt.desc()),
 pgPolicy("workflow_scope",{for:"all",to:["public"],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`}),
  pgPolicy("patient_form_submission_scope",{for:"all",to:["public"],using:sql`careiq_patient_form_scope(prepared_document_id) AND careiq_patient_scope('document_requests',jsonb_build_object('id',request_id,'practice_id',practice_id,'location_id',location_id,'patient_id',patient_id))`,withCheck:sql`careiq_patient_form_scope(prepared_document_id) AND careiq_patient_scope('document_requests',jsonb_build_object('id',request_id,'practice_id',practice_id,'location_id',location_id,'patient_id',patient_id))`})
]).enableRLS();
export const templatePublicationChecks = pgTable("template_publication_checks", {
 id:uuid().default(sql`uuidv7()`).primaryKey().notNull(),practiceId:uuid("practice_id").notNull(),templateVersionId:uuid("template_version_id").notNull(),draftRevision:bigint("draft_revision",{mode:"number"}).notNull(),schemaHash:text("schema_hash").notNull(),rulesetVersion:text("ruleset_version").notNull(),results:jsonb().notNull(),checkedByActorId:text("checked_by_actor_id").notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),
}, table=>[foreignKey({name:"template_publication_checks_version_fk",columns:[table.templateVersionId,table.practiceId],foreignColumns:[templateVersions.id,templateVersions.practiceId]}),check("template_publication_checks_result_check",sql`draft_revision>0 AND schema_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(results)='object'`),pgPolicy("workflow_scope",{for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`})]).enableRLS();
export const templateFieldBindings = pgTable("template_field_bindings", {
 id:uuid().default(sql`uuidv7()`).primaryKey().notNull(),practiceId:uuid("practice_id").notNull(),templateVersionId:uuid("template_version_id").notNull(),fieldKey:text("field_key").notNull(),destination:text().notNull(),reviewRequired:boolean("review_required").default(true).notNull(),normalizationVersion:text("normalization_version").default('careiq-demographics-v1').notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),
}, table=>[unique("template_field_bindings_id_practice_key").on(table.id,table.practiceId),unique("template_field_bindings_field_key").on(table.templateVersionId,table.fieldKey),foreignKey({name:"template_field_bindings_version_fk",columns:[table.templateVersionId,table.practiceId],foreignColumns:[templateVersions.id,templateVersions.practiceId]}),check("template_field_bindings_destination_check",sql`destination IN('patient.preferredName','patient.email','patient.phone','patient.dateOfBirth') AND review_required`),pgPolicy("workflow_scope",{for:"all",to:["public"],using:sql`careiq_workflow_practice_scope(practice_id)`,withCheck:sql`careiq_workflow_practice_scope(practice_id)`}),pgPolicy("patient_form_binding_read",{for:"select",to:["public"],using:sql`EXISTS(SELECT 1 FROM prepared_documents p WHERE p.template_version_id=template_field_bindings.template_version_id AND p.practice_id=template_field_bindings.practice_id AND careiq_patient_form_scope(p.id))`})]).enableRLS();
export const formChangeCandidates = pgTable("form_change_candidates", {
 id:uuid().default(sql`uuidv7()`).primaryKey().notNull(),practiceId:uuid("practice_id").notNull(),locationId:uuid("location_id").notNull(),patientId:uuid("patient_id").notNull(),submissionId:uuid("submission_id").notNull(),bindingId:uuid("binding_id").notNull(),requestId:uuid("request_id"),proposedValue:jsonb("proposed_value"),state:text().default('pending').notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),revision:bigint({mode:"number"}).default(1).notNull(),
},table=>[unique("form_change_candidates_id_scope_key").on(table.id,table.patientId,table.practiceId,table.locationId),unique("form_change_candidates_source_key").on(table.submissionId,table.bindingId),foreignKey({name:"form_change_candidates_submission_fk",columns:[table.submissionId,table.patientId,table.practiceId,table.locationId],foreignColumns:[formSubmissions.id,formSubmissions.patientId,formSubmissions.practiceId,formSubmissions.locationId]}),foreignKey({name:"form_change_candidates_binding_fk",columns:[table.bindingId,table.practiceId],foreignColumns:[templateFieldBindings.id,templateFieldBindings.practiceId]}),foreignKey({name:"form_change_candidates_request_fk",columns:[table.requestId,table.patientId,table.practiceId,table.locationId],foreignColumns:[documentRequests.id,documentRequests.patientId,documentRequests.practiceId,documentRequests.locationId]}),check("form_change_candidates_state_check",sql`state IN('pending','accepted','rejected','conflicted') AND revision>0`),index("form_change_candidates_pending_idx").on(table.practiceId,table.locationId,table.patientId,table.createdAt.desc()),pgPolicy("workflow_scope",{for:"all",to:["public"],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`}),pgPolicy("patient_form_candidate_insert",{for:"insert",to:["public"],withCheck:sql`EXISTS(SELECT 1 FROM form_submissions s WHERE s.id=form_change_candidates.submission_id AND s.patient_id=form_change_candidates.patient_id AND s.practice_id=form_change_candidates.practice_id AND s.location_id=form_change_candidates.location_id AND careiq_patient_form_scope(s.prepared_document_id))`})]).enableRLS();
export const formChangeDecisions = pgTable("form_change_decisions", {
 id:uuid().default(sql`uuidv7()`).primaryKey().notNull(),practiceId:uuid("practice_id").notNull(),locationId:uuid("location_id").notNull(),patientId:uuid("patient_id").notNull(),candidateId:uuid("candidate_id").notNull(),decision:text().notNull(),reasonCode:text("reason_code").notNull(),destinationRevision:bigint("destination_revision",{mode:"number"}),decidedByActorId:text("decided_by_actor_id").notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:'date'}).defaultNow().notNull(),
},table=>[foreignKey({name:"form_change_decisions_candidate_fk",columns:[table.candidateId,table.patientId,table.practiceId,table.locationId],foreignColumns:[formChangeCandidates.id,formChangeCandidates.patientId,formChangeCandidates.practiceId,formChangeCandidates.locationId]}),check("form_change_decisions_decision_check",sql`decision IN('accepted','rejected') AND length(reason_code) BETWEEN 1 AND 80 AND (destination_revision IS NULL OR destination_revision>0)`),pgPolicy("workflow_scope",{for:"all",to:["public"],using:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`,withCheck:sql`careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')`})]).enableRLS();
