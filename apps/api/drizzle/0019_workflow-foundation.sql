-- Local workflow implementation. No existing tenant rows receive grants or inferred location mappings.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE patients ADD COLUMN preferred_name text, ADD COLUMN date_of_birth date,
 ADD COLUMN archived_at timestamptz, ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE appointments ADD COLUMN ends_at timestamptz, ADD COLUMN provider_id uuid, ADD COLUMN visit_type_id uuid,
 ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by_actor_id text, ADD COLUMN cancellation_reason_code text, ADD COLUMN cancellation_note text;
-- Historical appointments lack validated duration; do not infer an end or provider.
ALTER TABLE appointments ADD CONSTRAINT appointments_interval_check CHECK(ends_at IS NULL OR ends_at>scheduled_at);
ALTER TABLE appointments ADD CONSTRAINT appointments_id_scope_key UNIQUE(id,practice_id,location_id);
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_scope_key UNIQUE(id,patient_id,practice_id,location_id);
--> statement-breakpoint
CREATE TABLE public.providers (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 120), clerk_user_id text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.provider_locations (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, provider_id uuid NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(provider_id,practice_id) REFERENCES public.providers(id,practice_id), UNIQUE(practice_id,provider_id,location_id));
--> statement-breakpoint
CREATE TABLE public.provider_availability_rules (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, provider_id uuid NOT NULL, iso_weekday integer NOT NULL CHECK(iso_weekday BETWEEN 1 AND 7), starts_at_local time NOT NULL, ends_at_local time NOT NULL, effective_from date NOT NULL, effective_until date, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(practice_id,provider_id,location_id) REFERENCES public.provider_locations(practice_id,provider_id,location_id), CHECK(starts_at_local<ends_at_local), CHECK(effective_until IS NULL OR effective_until>=effective_from));
--> statement-breakpoint
CREATE TABLE public.provider_availability_exceptions (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, provider_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, kind text NOT NULL CHECK(kind IN ('available','unavailable')), reason_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(practice_id,provider_id,location_id) REFERENCES public.provider_locations(practice_id,provider_id,location_id), CHECK(ends_at>starts_at));
--> statement-breakpoint
CREATE TABLE public.visit_types (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), code text NOT NULL CHECK(length(code) BETWEEN 1 AND 64), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), default_duration_minutes integer NOT NULL CHECK(default_duration_minutes BETWEEN 1 AND 1440), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), UNIQUE(practice_id,code));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_provider_location_fk FOREIGN KEY(practice_id,provider_id,location_id) REFERENCES public.provider_locations(practice_id,provider_id,location_id);
ALTER TABLE appointments ADD CONSTRAINT appointments_visit_type_scope_fk FOREIGN KEY(visit_type_id,practice_id) REFERENCES public.visit_types(id,practice_id);
ALTER TABLE appointments ADD CONSTRAINT appointments_provider_overlap EXCLUDE USING gist (practice_id WITH =,provider_id WITH =,tstzrange(scheduled_at,ends_at,'[)') WITH &&) WHERE(provider_id IS NOT NULL AND ends_at IS NOT NULL AND status IN ('scheduled','confirmed','checked_in','in_progress'));
CREATE INDEX appointments_patient_schedule_idx ON appointments(practice_id,location_id,patient_id,scheduled_at,id);
--> statement-breakpoint
CREATE TABLE public.document_types (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), code text NOT NULL CHECK(length(code) BETWEEN 1 AND 64), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), active boolean NOT NULL DEFAULT true, default_template_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), UNIQUE(practice_id,code));
--> statement-breakpoint
CREATE TABLE public.requirement_rule_sets (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), version integer NOT NULL CHECK(version>0), title text NOT NULL, published_at timestamptz, published_by_actor_id text, active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), UNIQUE(practice_id,version));
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_rule_sets_active_idx ON requirement_rule_sets(practice_id) WHERE active;
--> statement-breakpoint
CREATE TABLE public.requirement_rules (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), rule_set_id uuid NOT NULL, document_type_id uuid NOT NULL, visit_type_id uuid, location_id uuid, required boolean NOT NULL DEFAULT true, review_required boolean NOT NULL DEFAULT true, signature_required boolean NOT NULL DEFAULT false, reuse_policy text NOT NULL DEFAULT 'none' CHECK(reuse_policy IN ('none','same_patient','same_appointment')), maximum_age_days integer CHECK(maximum_age_days>0), due_offset_minutes integer NOT NULL DEFAULT 0, required_template_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), FOREIGN KEY(rule_set_id,practice_id) REFERENCES public.requirement_rule_sets(id,practice_id), FOREIGN KEY(document_type_id,practice_id) REFERENCES public.document_types(id,practice_id), FOREIGN KEY(visit_type_id,practice_id) REFERENCES public.visit_types(id,practice_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id));
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_rules_precedence_unique ON requirement_rules(rule_set_id,document_type_id,visit_type_id,location_id) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE TABLE public.visit_requirements (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, appointment_id uuid NOT NULL, document_type_id uuid NOT NULL, source_rule_id uuid, rule_set_version integer, label_snapshot text NOT NULL, required boolean NOT NULL DEFAULT true, review_required boolean NOT NULL DEFAULT true, signature_required boolean NOT NULL DEFAULT false, reuse_policy text NOT NULL DEFAULT 'none' CHECK(reuse_policy IN ('none','same_patient','same_appointment')), maximum_age_days integer CHECK(maximum_age_days>0), required_template_version_id uuid, due_at timestamptz, lifecycle_state text NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','waived','retired')), waiver_reason_code text, waived_by_actor_id text, waived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(appointment_id,patient_id,practice_id,location_id) REFERENCES public.appointments(id,patient_id,practice_id,location_id), FOREIGN KEY(document_type_id,practice_id) REFERENCES public.document_types(id,practice_id), FOREIGN KEY(source_rule_id,practice_id) REFERENCES public.requirement_rules(id,practice_id), CHECK(lifecycle_state<>'waived' OR (waiver_reason_code IS NOT NULL AND waived_by_actor_id IS NOT NULL AND waived_at IS NOT NULL)));
--> statement-breakpoint
CREATE UNIQUE INDEX visit_requirements_current_unique ON visit_requirements(practice_id,location_id,appointment_id,document_type_id) WHERE lifecycle_state<>'retired';
--> statement-breakpoint
CREATE TABLE public.practice_asset_objects (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), storage_key text NOT NULL UNIQUE, storage_version text, original_filename text, media_type text NOT NULL, size_bytes bigint CHECK(size_bytes>=0), sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'), status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','uploaded','scanning','available','quarantined','rejected','abandoned')), provenance jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.document_templates (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), document_type_id uuid NOT NULL, title text NOT NULL, active boolean NOT NULL DEFAULT true, published_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), FOREIGN KEY(document_type_id,practice_id) REFERENCES public.document_types(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.template_versions (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), template_id uuid NOT NULL, version_number integer NOT NULL CHECK(version_number>0), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired')), schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0), field_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(field_schema)='array'), asset_object_id uuid, content_hash text CHECK(content_hash ~ '^[0-9a-f]{64}$'), content text NOT NULL DEFAULT '', published_at timestamptz, published_by_actor_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id), FOREIGN KEY(template_id,practice_id) REFERENCES public.document_templates(id,practice_id), FOREIGN KEY(asset_object_id,practice_id) REFERENCES public.practice_asset_objects(id,practice_id), UNIQUE(template_id,version_number), UNIQUE(id,template_id,practice_id));
--> statement-breakpoint
ALTER TABLE document_templates ADD CONSTRAINT document_templates_published_version_fk FOREIGN KEY(published_version_id,id,practice_id) REFERENCES public.template_versions(id,template_id,practice_id);
ALTER TABLE document_types ADD CONSTRAINT document_types_default_template_fk FOREIGN KEY(default_template_id,practice_id) REFERENCES public.document_templates(id,practice_id);
ALTER TABLE requirement_rules ADD CONSTRAINT requirement_rules_template_fk FOREIGN KEY(required_template_version_id,practice_id) REFERENCES public.template_versions(id,practice_id);
ALTER TABLE visit_requirements ADD CONSTRAINT visit_requirements_template_fk FOREIGN KEY(required_template_version_id,practice_id) REFERENCES public.template_versions(id,practice_id);
--> statement-breakpoint
CREATE TABLE public.file_objects (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, storage_key text NOT NULL UNIQUE, storage_version text, original_filename text NOT NULL, declared_media_type text NOT NULL, detected_media_type text, expected_bytes bigint NOT NULL CHECK(expected_bytes BETWEEN 1 AND 26214400), actual_bytes bigint CHECK(actual_bytes>=0), sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'), status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','uploaded','scanning','available','quarantined','rejected','abandoned')), upload_expires_at timestamptz NOT NULL, uploaded_at timestamptz, verified_at timestamptz, scan_verdict text, scan_reference text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.documents (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_type_id uuid NOT NULL, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 240), current_version_id uuid, archived_at timestamptz, archived_by_actor_id text, archive_reason_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_type_id,practice_id) REFERENCES public.document_types(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.document_versions (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_id uuid NOT NULL, version_number integer NOT NULL CHECK(version_number>0), source text NOT NULL CHECK(source IN ('staff_upload','patient_upload','template_generated','signed_output','import')), template_version_id uuid, source_version_id uuid, file_object_id uuid, structured_answers jsonb, answers_schema_version integer, received_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, created_by_actor_id text NOT NULL, content_hash text CHECK(content_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_id,patient_id,practice_id,location_id) REFERENCES public.documents(id,patient_id,practice_id,location_id), FOREIGN KEY(template_version_id,practice_id) REFERENCES public.template_versions(id,practice_id), FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id), UNIQUE(document_id,version_number), UNIQUE(id,document_id,patient_id,practice_id,location_id));
--> statement-breakpoint
ALTER TABLE document_versions ADD CONSTRAINT document_versions_source_fk FOREIGN KEY(source_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id);
ALTER TABLE documents ADD CONSTRAINT documents_current_version_fk FOREIGN KEY(current_version_id,id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,document_id,patient_id,practice_id,location_id);
--> statement-breakpoint
CREATE TABLE public.upload_sessions (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_id uuid NOT NULL, document_version_id uuid, file_object_id uuid NOT NULL, actor_user_id text, patient_session_id uuid, declared_size_bytes bigint NOT NULL CHECK(declared_size_bytes BETWEEN 1 AND 26214400), declared_sha256 text CHECK(declared_sha256 ~ '^[0-9a-f]{64}$'), declared_media_type text NOT NULL, expires_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_id,patient_id,practice_id,location_id) REFERENCES public.documents(id,patient_id,practice_id,location_id), FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id), UNIQUE(file_object_id));
--> statement-breakpoint
CREATE TABLE public.document_reviews (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_version_id uuid NOT NULL, reviewer_actor_id text NOT NULL, decision text NOT NULL CHECK(decision IN ('accepted','replacement_required')), reason_code text, note text, reviewed_at timestamptz NOT NULL DEFAULT now(), supersedes_review_id uuid, audit_event_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), UNIQUE(id,document_version_id,patient_id,practice_id,location_id));
--> statement-breakpoint
ALTER TABLE document_reviews ADD CONSTRAINT document_reviews_supersedes_fk FOREIGN KEY(supersedes_review_id,document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_reviews(id,document_version_id,patient_id,practice_id,location_id);
ALTER TABLE document_reviews ADD CONSTRAINT document_reviews_no_self CHECK(supersedes_review_id IS DISTINCT FROM id);
CREATE UNIQUE INDEX document_reviews_initial_unique ON document_reviews(document_version_id) WHERE supersedes_review_id IS NULL;
CREATE UNIQUE INDEX document_reviews_successor_unique ON document_reviews(supersedes_review_id) WHERE supersedes_review_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.requirement_evidence (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, requirement_id uuid NOT NULL, document_version_id uuid NOT NULL, accepted_review_id uuid, linked_by_actor_id text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revocation_reason_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(requirement_id,patient_id,practice_id,location_id) REFERENCES public.visit_requirements(id,patient_id,practice_id,location_id), FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(accepted_review_id,document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_reviews(id,document_version_id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_evidence_current_unique ON requirement_evidence(requirement_id) WHERE revoked_at IS NULL; CREATE INDEX requirement_evidence_version_idx ON requirement_evidence(document_version_id) WHERE revoked_at IS NULL; CREATE INDEX requirement_evidence_review_idx ON requirement_evidence(accepted_review_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE public.prepared_documents (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, appointment_id uuid, requirement_id uuid, template_version_id uuid NOT NULL, answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(answers)='object'), rendered_source_version_id uuid, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','preparing','ready','failed','discarded')), created_by_actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(appointment_id,patient_id,practice_id,location_id) REFERENCES public.appointments(id,patient_id,practice_id,location_id), FOREIGN KEY(requirement_id,patient_id,practice_id,location_id) REFERENCES public.visit_requirements(id,patient_id,practice_id,location_id), FOREIGN KEY(template_version_id,practice_id) REFERENCES public.template_versions(id,practice_id), FOREIGN KEY(rendered_source_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.document_requests (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, appointment_id uuid, purpose text NOT NULL CHECK(purpose IN ('collection','signature','replacement')), recipient_name text NOT NULL, recipient_email text, recipient_phone text, due_at timestamptz, expires_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','open','completed','declined','cancelled','expired')), assignee_user_id text, reason_code text, created_by_actor_id text NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(appointment_id,patient_id,practice_id,location_id) REFERENCES public.appointments(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.document_request_items (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, request_id uuid NOT NULL, requirement_id uuid NOT NULL, document_type_id uuid NOT NULL, source_version_id uuid, fulfilled_version_id uuid, state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','fulfilled','cancelled')), is_open boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id), FOREIGN KEY(requirement_id,patient_id,practice_id,location_id) REFERENCES public.visit_requirements(id,patient_id,practice_id,location_id), FOREIGN KEY(document_type_id,practice_id) REFERENCES public.document_types(id,practice_id), FOREIGN KEY(source_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(fulfilled_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), UNIQUE(request_id,requirement_id), CHECK(is_open=(state='open')));
--> statement-breakpoint
CREATE UNIQUE INDEX document_request_items_one_open ON document_request_items(requirement_id) WHERE is_open;
--> statement-breakpoint
CREATE TABLE public.patient_access_grants (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, request_id uuid NOT NULL, token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'), purpose text NOT NULL DEFAULT 'request_access', expires_at timestamptz NOT NULL, revoked_at timestamptz, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.patient_sessions (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, request_id uuid NOT NULL, grant_id uuid NOT NULL, token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'), request_revision bigint NOT NULL CHECK(request_revision>0), expires_at timestamptz NOT NULL, revoked_at timestamptz, verification_method text NOT NULL DEFAULT 'email_link', assurance text NOT NULL DEFAULT 'link_possession', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id), FOREIGN KEY(grant_id,patient_id,practice_id,location_id) REFERENCES public.patient_access_grants(id,patient_id,practice_id,location_id), UNIQUE(id,request_id,patient_id,practice_id,location_id));
--> statement-breakpoint
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_patient_session_fk FOREIGN KEY(patient_session_id,patient_id,practice_id,location_id) REFERENCES public.patient_sessions(id,patient_id,practice_id,location_id);
--> statement-breakpoint
CREATE TABLE public.signature_packets (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, request_id uuid NOT NULL UNIQUE, source_version_id uuid NOT NULL, recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completing','completed','declined','cancelled','expired','failed')), consent_text_version text NOT NULL, consent_text text NOT NULL, consent_hash text NOT NULL CHECK(consent_hash ~ '^[0-9a-f]{64}$'), output_version_id uuid, evidence_object_id uuid, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id), FOREIGN KEY(source_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(output_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(evidence_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.signature_fields (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, packet_id uuid NOT NULL, field_key text NOT NULL, page integer NOT NULL CHECK(page>0), x numeric NOT NULL CHECK(x BETWEEN 0 AND 1), y numeric NOT NULL CHECK(y BETWEEN 0 AND 1), width numeric NOT NULL CHECK(width>0 AND width<=1), height numeric NOT NULL CHECK(height>0 AND height<=1), field_type text NOT NULL CHECK(field_type IN ('signature','initials','name','date','text','checkbox')), required boolean NOT NULL DEFAULT true, entered_value text, private_artifact_reference text, signed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(packet_id,patient_id,practice_id,location_id) REFERENCES public.signature_packets(id,patient_id,practice_id,location_id), UNIQUE(packet_id,field_key), CHECK(x+width<=1 AND y+height<=1));
--> statement-breakpoint
CREATE TABLE public.signature_events (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, packet_id uuid NOT NULL, audit_event_id uuid NOT NULL, event_type text NOT NULL, actor_type text NOT NULL, actor_id text NOT NULL, patient_session_id uuid, source_hash text, consent_hash text, evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(packet_id,patient_id,practice_id,location_id) REFERENCES public.signature_packets(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_session_id,patient_id,practice_id,location_id) REFERENCES public.patient_sessions(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.document_access_grants (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_version_id uuid NOT NULL, file_object_id uuid NOT NULL, actor_user_id text, patient_session_id uuid, purpose text NOT NULL CHECK(purpose IN ('view','download','print','export','sign')), issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz, issuing_audit_event_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_session_id,patient_id,practice_id,location_id) REFERENCES public.patient_sessions(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE TABLE public.file_access_observations (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, access_grant_id uuid NOT NULL, file_object_id uuid NOT NULL, document_version_id uuid NOT NULL, observer text NOT NULL CHECK(observer IN ('gateway','storage','client')), provider_event_id text NOT NULL, observed_at timestamptz NOT NULL, result text NOT NULL, bytes_transferred bigint CHECK(bytes_transferred>=0), audit_event_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(access_grant_id,patient_id,practice_id,location_id) REFERENCES public.document_access_grants(id,patient_id,practice_id,location_id), FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id), FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id), UNIQUE(observer,provider_event_id));
--> statement-breakpoint
CREATE TABLE public.document_retention (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_id uuid NOT NULL, policy_reference text NOT NULL, retain_until timestamptz, disposition_status text NOT NULL DEFAULT 'retained' CHECK(disposition_status IN ('retained','review_required','approved','disposed')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_id,patient_id,practice_id,location_id) REFERENCES public.documents(id,patient_id,practice_id,location_id), UNIQUE(document_id));
--> statement-breakpoint
CREATE TABLE public.document_holds (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, document_id uuid NOT NULL, reason_reference text NOT NULL, placed_by_actor_id text NOT NULL, placed_at timestamptz NOT NULL DEFAULT now(), released_by_actor_id text, released_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(document_id,patient_id,practice_id,location_id) REFERENCES public.documents(id,patient_id,practice_id,location_id), CHECK((released_at IS NULL)=(released_by_actor_id IS NULL)));
--> statement-breakpoint
CREATE TABLE public.workflow_operations (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, operation_type text NOT NULL, initiating_actor_type text NOT NULL DEFAULT 'user', initiating_actor_id text NOT NULL, target_type text, target_id uuid, command_fingerprint text NOT NULL CHECK(command_fingerprint ~ '^[0-9a-f]{64}$'), state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled')), request_id uuid, workflow_id uuid, causation_event_id uuid, started_at timestamptz, completed_at timestamptz, result_type text, result_id uuid, failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id));
--> statement-breakpoint
CREATE TABLE public.workflow_request_keys (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, actor_user_id text NOT NULL, request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128), request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), operation text NOT NULL, target_id text NOT NULL DEFAULT '', result_type text, resource_id uuid, operation_id uuid, response jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(response)='object'), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(operation_id,practice_id,location_id) REFERENCES public.workflow_operations(id,practice_id,location_id), UNIQUE(practice_id,location_id,actor_user_id,request_key));
--> statement-breakpoint
CREATE TABLE public.job_runs (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, operation_id uuid NOT NULL, job_type text NOT NULL, job_version text NOT NULL, attempt integer NOT NULL CHECK(attempt>0), executor_id text NOT NULL, fencing_token uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed','cancelled','lost_lease')), input_references jsonb NOT NULL DEFAULT '{}'::jsonb, output_references jsonb NOT NULL DEFAULT '{}'::jsonb, failure_code text, audit_event_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(operation_id,practice_id,location_id) REFERENCES public.workflow_operations(id,practice_id,location_id), UNIQUE(operation_id,job_type,attempt));
--> statement-breakpoint
CREATE TABLE public.file_scan_runs (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, file_object_id uuid NOT NULL, job_run_id uuid, attempt integer NOT NULL CHECK(attempt>0), scanner_version text NOT NULL, ruleset_version text NOT NULL, verified_storage_version text NOT NULL, verified_sha256 text NOT NULL CHECK(verified_sha256 ~ '^[0-9a-f]{64}$'), submitted_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, verdict text NOT NULL CHECK(verdict IN ('clean','unsafe','error','unknown')), failure_code text, audit_event_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id), FOREIGN KEY(job_run_id,practice_id,location_id) REFERENCES public.job_runs(id,practice_id,location_id), UNIQUE(file_object_id,attempt));
--> statement-breakpoint
CREATE TABLE public.delivery_attempts (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, request_id uuid NOT NULL, purpose text NOT NULL CHECK(purpose IN ('initial','reminder','reissue')), sequence integer NOT NULL CHECK(sequence>0), channel text NOT NULL CHECK(channel IN ('email','sms','local_review')), destination_snapshot text, provider_id text, provider_message_id text, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','submitting','accepted','delivered','failed','unknown')), failure_code text, submitted_at timestamptz, completed_at timestamptz, dedupe_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id), UNIQUE(request_id,sequence));
--> statement-breakpoint
CREATE TABLE public.provider_webhook_receipts (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), provider text NOT NULL, provider_event_id text NOT NULL, delivery_attempt_id uuid, signature_verified boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, normalized_result jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,practice_id), UNIQUE(provider,provider_event_id));
--> statement-breakpoint
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_id_practice_unique UNIQUE(id,practice_id);
--> statement-breakpoint
ALTER TABLE provider_webhook_receipts ADD CONSTRAINT webhook_delivery_scope_fk FOREIGN KEY(delivery_attempt_id,practice_id) REFERENCES public.delivery_attempts(id,practice_id);
--> statement-breakpoint
CREATE TABLE public.work_items (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, patient_id uuid NOT NULL, appointment_id uuid, requirement_id uuid, request_id uuid, kind text NOT NULL CHECK(kind IN ('collect','review','replace','delivery_follow_up')), assignee_user_id text, due_at timestamptz, priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','completed','cancelled')), completed_at timestamptz, completion_reason_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), UNIQUE(id,patient_id,practice_id,location_id), FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(appointment_id,patient_id,practice_id,location_id) REFERENCES public.appointments(id,patient_id,practice_id,location_id), FOREIGN KEY(requirement_id,patient_id,practice_id,location_id) REFERENCES public.visit_requirements(id,patient_id,practice_id,location_id), FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id));
--> statement-breakpoint
CREATE UNIQUE INDEX work_items_active_requirement_kind ON work_items(practice_id,location_id,requirement_id,kind) WHERE requirement_id IS NOT NULL AND state IN ('open','in_progress'); CREATE UNIQUE INDEX work_items_active_delivery ON work_items(practice_id,location_id,request_id,kind) WHERE kind='delivery_follow_up' AND state IN ('open','in_progress'); CREATE INDEX work_items_queue_idx ON work_items(practice_id,location_id,state,due_at,id);
--> statement-breakpoint
CREATE TABLE public.outbox_events (id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL REFERENCES public.practices(id), location_id uuid NOT NULL, operation_id uuid, causation_event_id uuid, event_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_revision bigint NOT NULL CHECK(aggregate_revision>0), payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'), available_at timestamptz NOT NULL DEFAULT now(), attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), lease_token uuid, lease_expires_at timestamptz, published_at timestamptz, last_failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(operation_id,practice_id,location_id) REFERENCES public.workflow_operations(id,practice_id,location_id));
--> statement-breakpoint
CREATE INDEX outbox_events_pending_idx ON outbox_events(available_at,id) WHERE published_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.documents ADD COLUMN request_id uuid, ADD CONSTRAINT documents_request_scope_fk FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE public.document_versions ADD COLUMN request_id uuid, ADD CONSTRAINT document_versions_request_scope_fk FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE public.file_objects ADD COLUMN request_id uuid, ADD CONSTRAINT file_objects_request_scope_fk FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE public.upload_sessions ADD COLUMN request_id uuid, ADD CONSTRAINT upload_sessions_request_scope_fk FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE public.workflow_operations ADD COLUMN patient_request_id uuid, ADD CONSTRAINT workflow_operations_patient_request_scope_fk FOREIGN KEY(patient_request_id,practice_id,location_id) REFERENCES public.document_requests(id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE public.outbox_events ADD COLUMN patient_request_id uuid, ADD CONSTRAINT outbox_events_patient_request_scope_fk FOREIGN KEY(patient_request_id,practice_id,location_id) REFERENCES public.document_requests(id,practice_id,location_id);
--> statement-breakpoint
ALTER TABLE patient_access_grants ADD CONSTRAINT patient_access_grants_request_scope_key UNIQUE(id,request_id,patient_id,practice_id,location_id); ALTER TABLE patient_sessions ADD CONSTRAINT patient_sessions_grant_request_fk FOREIGN KEY(grant_id,request_id,patient_id,practice_id,location_id) REFERENCES public.patient_access_grants(id,request_id,patient_id,practice_id,location_id);
--> statement-breakpoint
-- Token lookup is deliberately restricted to the API role. Raw high-entropy tokens never enter SQL or audit.
CREATE FUNCTION public.careiq_resolve_patient_access(token_hash_value text,is_session boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE resolved jsonb;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 IF is_session THEN
  SELECT jsonb_build_object('practice_id',s.practice_id,'location_id',s.location_id,'patient_id',s.patient_id,'request_id',s.request_id,'grant_id',s.grant_id,'session_id',s.id,'request_revision',s.request_revision,'expires_at',s.expires_at) INTO resolved
  FROM public.patient_sessions s JOIN public.patient_access_grants g ON g.id=s.grant_id AND g.request_id=s.request_id AND g.patient_id=s.patient_id AND g.practice_id=s.practice_id AND g.location_id=s.location_id
  JOIN public.document_requests r ON r.id=s.request_id AND r.patient_id=s.patient_id AND r.practice_id=s.practice_id AND r.location_id=s.location_id
  JOIN public.practices p ON p.id=s.practice_id JOIN public.locations l ON l.id=s.location_id AND l.practice_id=s.practice_id
  WHERE s.token_hash=token_hash_value AND s.revoked_at IS NULL AND s.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND r.state='open' AND r.expires_at>now() AND r.revision=s.request_revision AND p.status='active' AND l.status='active';
 ELSE
  SELECT jsonb_build_object('practice_id',g.practice_id,'location_id',g.location_id,'patient_id',g.patient_id,'request_id',g.request_id,'grant_id',g.id,'session_id',NULL,'request_revision',r.revision,'expires_at',g.expires_at) INTO resolved
  FROM public.patient_access_grants g JOIN public.document_requests r ON r.id=g.request_id AND r.patient_id=g.patient_id AND r.practice_id=g.practice_id AND r.location_id=g.location_id
  JOIN public.practices p ON p.id=g.practice_id JOIN public.locations l ON l.id=g.location_id AND l.practice_id=g.practice_id
  WHERE g.token_hash=token_hash_value AND g.revoked_at IS NULL AND g.consumed_at IS NULL AND g.expires_at>now() AND r.state='open' AND r.expires_at>now() AND p.status='active' AND l.status='active';
 END IF;
 RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION public.careiq_resolve_patient_access(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_clinical_runtime;
CREATE FUNCTION public.careiq_patient_scope(table_name_value text,row_data jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE access_data jsonb; request_uuid uuid; row_uuid uuid; kind text;
BEGIN
 access_data:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),current_setting('app.patient_is_session',true)='true');
 IF access_data IS NULL OR (row_data->>'practice_id') IS DISTINCT FROM (access_data->>'practice_id') OR (row_data->>'location_id') IS DISTINCT FROM (access_data->>'location_id') THEN RETURN false; END IF;
 IF row_data ? 'patient_id' AND (row_data->>'patient_id') IS DISTINCT FROM (access_data->>'patient_id') THEN RETURN false; END IF;
 request_uuid:=(access_data->>'request_id')::uuid; row_uuid:=(row_data->>'id')::uuid;
 CASE table_name_value
 WHEN 'document_requests' THEN RETURN row_uuid=request_uuid;
 WHEN 'document_request_items' THEN RETURN (row_data->>'request_id')::uuid=request_uuid;
 WHEN 'patient_access_grants' THEN RETURN row_uuid=(access_data->>'grant_id')::uuid;
 WHEN 'patient_sessions' THEN RETURN (row_data->>'request_id')::uuid=request_uuid AND (row_data->>'grant_id')::uuid=(access_data->>'grant_id')::uuid;
 WHEN 'signature_packets' THEN RETURN (row_data->>'request_id')::uuid=request_uuid;
 WHEN 'signature_fields','signature_events' THEN RETURN EXISTS(SELECT 1 FROM public.signature_packets p WHERE p.id=(row_data->>'packet_id')::uuid AND p.request_id=request_uuid AND p.practice_id=(access_data->>'practice_id')::uuid AND p.location_id=(access_data->>'location_id')::uuid);
 WHEN 'workflow_operations','outbox_events' THEN RETURN (row_data->>'patient_request_id')::uuid=request_uuid;
 WHEN 'upload_sessions' THEN RETURN (row_data->>'request_id')::uuid=request_uuid;
 WHEN 'documents' THEN RETURN (row_data->>'request_id')::uuid=request_uuid OR EXISTS(SELECT 1 FROM public.document_versions v JOIN public.document_request_items i ON v.id IN (i.source_version_id,i.fulfilled_version_id) WHERE v.document_id=row_uuid AND i.request_id=request_uuid) OR EXISTS(SELECT 1 FROM public.document_versions v JOIN public.signature_packets p ON v.id IN (p.source_version_id,p.output_version_id) WHERE v.document_id=row_uuid AND p.request_id=request_uuid);
 WHEN 'document_versions' THEN RETURN (row_data->>'request_id')::uuid=request_uuid OR EXISTS(SELECT 1 FROM public.document_request_items i WHERE i.request_id=request_uuid AND row_uuid IN (i.source_version_id,i.fulfilled_version_id)) OR EXISTS(SELECT 1 FROM public.signature_packets p WHERE p.request_id=request_uuid AND row_uuid IN (p.source_version_id,p.output_version_id));
 WHEN 'file_objects' THEN RETURN (row_data->>'request_id')::uuid=request_uuid OR EXISTS(SELECT 1 FROM public.document_versions v JOIN public.document_request_items i ON v.id IN (i.source_version_id,i.fulfilled_version_id) WHERE v.file_object_id=row_uuid AND i.request_id=request_uuid) OR EXISTS(SELECT 1 FROM public.document_versions v JOIN public.signature_packets p ON v.id IN (p.source_version_id,p.output_version_id) WHERE v.file_object_id=row_uuid AND p.request_id=request_uuid);
 ELSE RETURN false;
 END CASE;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_scope(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_scope(text,jsonb) TO careiq_clinical_runtime;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['document_requests','document_request_items','patient_access_grants','patient_sessions','signature_packets','signature_fields','signature_events','workflow_operations','outbox_events','upload_sessions','documents','document_versions','file_objects'] LOOP
  EXECUTE format('CREATE POLICY patient_request_scope ON public.%I USING(public.careiq_patient_scope(%L,to_jsonb(%I))) WITH CHECK(public.careiq_patient_scope(%L,to_jsonb(%I)))',t,t,t,t,t);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.careiq_workflow_practice_scope(row_practice uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.careiq_clinical_scope(row_practice,public.careiq_context_uuid('app.location_id'))
   AND public.careiq_context_uuid('app.location_id') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.careiq_workflow_practice_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_workflow_practice_scope(uuid) TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.providers FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.providers USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.providers FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.providers TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.visit_types ENABLE ROW LEVEL SECURITY; ALTER TABLE public.visit_types FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.visit_types USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.visit_types FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.visit_types TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_types FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_types USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.document_types FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_types TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.requirement_rule_sets ENABLE ROW LEVEL SECURITY; ALTER TABLE public.requirement_rule_sets FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.requirement_rule_sets USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.requirement_rule_sets FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.requirement_rule_sets TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.requirement_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.requirement_rules FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.requirement_rules USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.requirement_rules FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.requirement_rules TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.practice_asset_objects ENABLE ROW LEVEL SECURITY; ALTER TABLE public.practice_asset_objects FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.practice_asset_objects USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.practice_asset_objects FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.practice_asset_objects TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_templates FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_templates USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.document_templates FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_templates TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.template_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.template_versions FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.template_versions USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.template_versions FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.template_versions TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.provider_webhook_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.provider_webhook_receipts FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.provider_webhook_receipts USING(public.careiq_workflow_practice_scope(practice_id)) WITH CHECK(public.careiq_workflow_practice_scope(practice_id)); REVOKE ALL ON public.provider_webhook_receipts FROM PUBLIC; GRANT SELECT,INSERT ON public.provider_webhook_receipts TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.provider_locations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.provider_locations FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.provider_locations USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.provider_locations FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.provider_locations TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.provider_availability_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.provider_availability_rules FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.provider_availability_rules USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.provider_availability_rules FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.provider_availability_rules TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.provider_availability_exceptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.provider_availability_exceptions FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.provider_availability_exceptions USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.provider_availability_exceptions FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.provider_availability_exceptions TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.visit_requirements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.visit_requirements FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.visit_requirements USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.visit_requirements FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.visit_requirements TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.file_objects ENABLE ROW LEVEL SECURITY; ALTER TABLE public.file_objects FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.file_objects USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.file_objects FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.file_objects TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY; ALTER TABLE public.documents FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.documents USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.documents FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.documents TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_versions FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_versions USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_versions FROM PUBLIC; GRANT SELECT,INSERT ON public.document_versions TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.upload_sessions FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.upload_sessions USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.upload_sessions FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.upload_sessions TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_reviews FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_reviews USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_reviews FROM PUBLIC; GRANT SELECT,INSERT ON public.document_reviews TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.requirement_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE public.requirement_evidence FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.requirement_evidence USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.requirement_evidence FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.requirement_evidence TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.prepared_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE public.prepared_documents FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.prepared_documents USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.prepared_documents FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.prepared_documents TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_requests FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_requests USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_requests FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_requests TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_request_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_request_items FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_request_items USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_request_items FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_request_items TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.patient_access_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.patient_access_grants FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.patient_access_grants USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.patient_access_grants FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.patient_access_grants TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.patient_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.patient_sessions FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.patient_sessions USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.patient_sessions FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.patient_sessions TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.signature_packets ENABLE ROW LEVEL SECURITY; ALTER TABLE public.signature_packets FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.signature_packets USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.signature_packets FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.signature_packets TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY; ALTER TABLE public.signature_fields FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.signature_fields USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.signature_fields FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.signature_fields TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.signature_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.signature_events FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.signature_events USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.signature_events FROM PUBLIC; GRANT SELECT,INSERT ON public.signature_events TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_access_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_access_grants FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_access_grants USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_access_grants FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_access_grants TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.file_access_observations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.file_access_observations FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.file_access_observations USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.file_access_observations FROM PUBLIC; GRANT SELECT,INSERT ON public.file_access_observations TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_retention ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_retention FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_retention USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_retention FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_retention TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.document_holds ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_holds FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.document_holds USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.document_holds FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.document_holds TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.workflow_operations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.workflow_operations FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.workflow_operations USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.workflow_operations FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.workflow_operations TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.workflow_request_keys ENABLE ROW LEVEL SECURITY; ALTER TABLE public.workflow_request_keys FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.workflow_request_keys USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.workflow_request_keys FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.workflow_request_keys TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.job_runs FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.job_runs USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.job_runs FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.job_runs TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.file_scan_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.file_scan_runs FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.file_scan_runs USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.file_scan_runs FROM PUBLIC; GRANT SELECT,INSERT ON public.file_scan_runs TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.delivery_attempts FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.delivery_attempts USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.delivery_attempts FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.delivery_attempts TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.work_items FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.work_items USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.work_items FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.work_items TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY; CREATE POLICY workflow_scope ON public.outbox_events USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')); REVOKE ALL ON public.outbox_events FROM PUBLIC; GRANT SELECT,INSERT,UPDATE ON public.outbox_events TO careiq_clinical_runtime;
--> statement-breakpoint
-- Mutations preserve identity and scope; no DELETE/TRUNCATE privileges are granted.
GRANT UPDATE(first_name,last_name,email,phone,preferred_name,date_of_birth,archived_at,revision,updated_at) ON public.patients TO careiq_clinical_runtime;
GRANT UPDATE(scheduled_at,ends_at,provider_id,visit_type_id,status,reason,revision,cancelled_at,cancelled_by_actor_id,cancellation_reason_code,cancellation_note,updated_at) ON public.appointments TO careiq_clinical_runtime;
--> statement-breakpoint
CREATE SCHEMA audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
CREATE TABLE audit.events (
 id uuid PRIMARY KEY DEFAULT uuidv7(), schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 clock_source text NOT NULL DEFAULT 'server', scope_kind text NOT NULL CHECK(scope_kind IN ('platform','practice','location')),
 practice_id uuid, location_id uuid, actor_type text NOT NULL CHECK(actor_type IN ('user','patient_session','service','background_job','integration','administrator','migration','anonymous')),
 actor_id text, initiating_actor_type text, initiating_actor_id text, effective_principal_id text, executor_id text,
 channel text NOT NULL DEFAULT 'api', action varchar(96) NOT NULL CHECK(length(action)>0), entity_type text, entity_id text,
 outcome text NOT NULL CHECK(outcome IN ('accepted','succeeded','denied','rejected','failed','unknown')), reason_code varchar(96),
 request_id uuid, operation_id uuid, workflow_id uuid, causation_event_id uuid REFERENCES audit.events(id), replayed_event_id uuid REFERENCES audit.events(id),
 job_run_id uuid, provider_receipt_id uuid, transaction_id uuid NOT NULL, database_transaction_id bigint NOT NULL DEFAULT txid_current(),
 authorization_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(authorization_context)='object'),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=8192),
 retain_until timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '6 years'),
 CHECK((scope_kind='platform' AND practice_id IS NULL AND location_id IS NULL) OR (scope_kind='practice' AND practice_id IS NOT NULL AND location_id IS NULL) OR (scope_kind='location' AND practice_id IS NOT NULL AND location_id IS NOT NULL)),
 CHECK(actor_id IS NOT NULL OR actor_type='anonymous')
);
CREATE INDEX events_scope_time_idx ON audit.events(practice_id,location_id,recorded_at DESC,id DESC);
CREATE INDEX events_operation_idx ON audit.events(operation_id,recorded_at,id) WHERE operation_id IS NOT NULL;
CREATE INDEX events_transaction_idx ON audit.events(transaction_id,recorded_at,id);
CREATE TABLE audit.event_resources (
 event_id uuid NOT NULL REFERENCES audit.events(id), ordinal integer NOT NULL CHECK(ordinal>=0), resource_type text NOT NULL,
 resource_id text NOT NULL, relationship text NOT NULL CHECK(relationship IN ('primary','affected','subject','evidence')),
 practice_id uuid, location_id uuid, patient_id uuid, PRIMARY KEY(event_id,ordinal), UNIQUE(event_id,resource_type,resource_id,relationship)
);
CREATE INDEX event_resources_lookup_idx ON audit.event_resources(practice_id,location_id,resource_type,resource_id,event_id);
CREATE INDEX event_resources_patient_idx ON audit.event_resources(practice_id,location_id,patient_id,event_id) WHERE patient_id IS NOT NULL;
CREATE TABLE audit.changes (
 id uuid PRIMARY KEY DEFAULT uuidv7(), event_id uuid NOT NULL REFERENCES audit.events(id), resource_type text NOT NULL, resource_id text NOT NULL,
 field_path text NOT NULL, capture_mode text NOT NULL CHECK(capture_mode IN ('value','masked','changed_only','protected_reference')),
 before_value jsonb, after_value jsonb, protected_reference text, capture_policy_version integer NOT NULL DEFAULT 1,
 CHECK(capture_mode='value' OR (before_value IS NULL AND after_value IS NULL))
);
CREATE TABLE audit.database_records (
 id uuid PRIMARY KEY DEFAULT uuidv7(), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), schema_name text NOT NULL,
 table_name text NOT NULL, operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')), row_key jsonb NOT NULL,
 practice_id uuid, location_id uuid, revision_before bigint, revision_after bigint, changed_fields text[] NOT NULL,
 before_evidence jsonb NOT NULL DEFAULT '{}'::jsonb, after_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 transaction_id uuid NOT NULL, database_transaction_id bigint NOT NULL DEFAULT txid_current(), statement_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 application_event_id uuid REFERENCES audit.events(id), actor_context text, authenticated_login text NOT NULL, execution_role text NOT NULL
);
CREATE INDEX database_records_scope_time_idx ON audit.database_records(practice_id,location_id,recorded_at,id);
CREATE INDEX database_records_transaction_idx ON audit.database_records(transaction_id);
CREATE TABLE audit.capture_policies (
 id uuid PRIMARY KEY DEFAULT uuidv7(), table_name text NOT NULL, field_path text NOT NULL, policy_version integer NOT NULL,
 classification text NOT NULL, capture_mode text NOT NULL CHECK(capture_mode IN ('value','masked','changed_only','protected_reference')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(table_name,field_path,policy_version)
);
INSERT INTO audit.capture_policies(table_name,field_path,policy_version,classification,capture_mode) VALUES
 ('*','*',1,'protected','changed_only'),('*','status',1,'workflow','value'),('*','state',1,'workflow','value'),('*','revision',1,'workflow','value'),('*','lifecycle_state',1,'workflow','value');
CREATE TABLE audit.archive_manifests (
 id uuid PRIMARY KEY DEFAULT uuidv7(), created_at timestamptz NOT NULL DEFAULT now(), practice_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 object_reference text NOT NULL, storage_version text NOT NULL, record_count bigint NOT NULL CHECK(record_count>=0), canonicalization_version text NOT NULL,
 digest_algorithm text NOT NULL DEFAULT 'sha256', digest text NOT NULL, signing_key_reference text, verification_status text NOT NULL DEFAULT 'pending', verified_at timestamptz, retention_lock_reference text
);
CREATE TABLE audit.retention_assignments (
 id uuid PRIMARY KEY DEFAULT uuidv7(), event_id uuid REFERENCES audit.events(id), batch_id uuid REFERENCES audit.archive_manifests(id),
 classification text NOT NULL, policy_version text NOT NULL, retention_anchor timestamptz NOT NULL, retain_until timestamptz,
 manual_review boolean NOT NULL DEFAULT true, approval_event_id uuid REFERENCES audit.events(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK(event_id IS NOT NULL OR batch_id IS NOT NULL)
);
CREATE TABLE audit.hold_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(), hold_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('placed','released')),
 target_event_id uuid REFERENCES audit.events(id), resource_type text, resource_id text, batch_id uuid REFERENCES audit.archive_manifests(id),
 practice_id uuid, starts_at timestamptz, ends_at timestamptz, reason_reference text NOT NULL, authority_actor_id text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(), releases_event_id uuid REFERENCES audit.hold_events(id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM careiq_clinical_runtime;
GRANT USAGE ON SCHEMA audit TO careiq_clinical_runtime,careiq_audit_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO careiq_audit_reader;
-- No audit reader receives cross-tenant access by mere role membership.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','database_records','archive_manifests','hold_events'] LOOP
  EXECUTE format('ALTER TABLE audit.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY audit_reader_scope ON audit.%I FOR SELECT TO careiq_audit_reader USING(practice_id=public.careiq_context_uuid(''app.practice_id''))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['event_resources','changes','retention_assignments'] LOOP
  EXECUTE format('ALTER TABLE audit.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY audit_reader_event_scope ON audit.%I FOR SELECT TO careiq_audit_reader USING(EXISTS(SELECT 1 FROM audit.events e WHERE e.id=event_id AND e.practice_id=public.careiq_context_uuid(''app.practice_id'')))',t);
 END LOOP;
END $$;
CREATE FUNCTION public.careiq_reject_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_WORKFLOW_FACT' USING ERRCODE='23514'; END $$;
CREATE FUNCTION public.careiq_published_template_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF OLD.state IN ('published','retired') AND (TG_OP='DELETE' OR (to_jsonb(OLD)-ARRAY['state','revision','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','revision','updated_at']) OR NEW.state NOT IN ('published','retired')) THEN RAISE EXCEPTION 'PUBLISHED_TEMPLATE_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE FUNCTION public.careiq_published_rule_set_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF OLD.published_at IS NOT NULL AND (TG_OP='DELETE' OR (to_jsonb(OLD)-ARRAY['active','revision','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['active','revision','updated_at'])) THEN RAISE EXCEPTION 'PUBLISHED_RULE_SET_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE FUNCTION public.careiq_published_rule_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE target uuid; BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.rule_set_id ELSE NEW.rule_set_id END;
 IF EXISTS(SELECT 1 FROM public.requirement_rule_sets WHERE id=target AND published_at IS NOT NULL) OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.requirement_rule_sets WHERE id=OLD.rule_set_id AND published_at IS NOT NULL)) THEN RAISE EXCEPTION 'PUBLISHED_RULE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
CREATE FUNCTION public.careiq_terminal_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF OLD.state<>'running' THEN RAISE EXCEPTION 'TERMINAL_JOB_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='audit' LOOP
 EXECUTE format('CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit.%I FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable()',t);
 END LOOP;
END $$;
CREATE FUNCTION audit.capture_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before_row jsonb; after_row jsonb; row_data jsonb; changed text[]; safe_fields text[]:=ARRAY['status','state','lifecycle_state','revision','scheduled_at','ends_at','provider_id','visit_type_id','active','required','review_required','signature_required','decision','revoked_at','archived_at','expires_at','due_at']; tx uuid; event_uuid uuid; before_safe jsonb; after_safe jsonb; row_practice uuid; row_location uuid;
BEGIN
 before_row:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 after_row:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' AND before_row=after_row THEN RETURN NEW; END IF;
 row_data:=CASE WHEN TG_OP='DELETE' THEN before_row ELSE after_row END;
 SELECT array_agg(key ORDER BY key) INTO changed FROM (SELECT key FROM jsonb_object_keys(before_row||after_row) AS key WHERE (before_row->key) IS DISTINCT FROM (after_row->key)) f;
 tx:=public.careiq_context_uuid('app.transaction_id');
 IF tx IS NULL THEN tx:=uuidv7(); PERFORM set_config('app.transaction_id',tx::text,true); END IF;
 row_practice:=NULLIF(row_data->>'practice_id','')::uuid; row_location:=NULLIF(row_data->>'location_id','')::uuid;
 IF TG_TABLE_NAME='practices' THEN row_practice:=(row_data->>'id')::uuid; END IF;
 event_uuid:=public.careiq_context_uuid('app.audit_event_id');
 IF event_uuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM audit.events WHERE id=event_uuid AND practice_id IS NOT DISTINCT FROM row_practice AND (location_id IS NULL OR location_id IS NOT DISTINCT FROM row_location)) THEN event_uuid:=NULL; END IF;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO before_safe FROM jsonb_each(before_row) WHERE key=ANY(safe_fields) AND key=ANY(changed);
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO after_safe FROM jsonb_each(after_row) WHERE key=ANY(safe_fields) AND key=ANY(changed);
 INSERT INTO audit.database_records(schema_name,table_name,operation,row_key,practice_id,location_id,revision_before,revision_after,changed_fields,before_evidence,after_evidence,transaction_id,application_event_id,actor_context,authenticated_login,execution_role)
 VALUES(TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_OP,jsonb_strip_nulls(jsonb_build_object('id',row_data->'id','practiceId',row_data->'practice_id','locationId',row_data->'location_id','userId',CASE WHEN row_data ? 'id' THEN NULL ELSE row_data->'user_id' END)),row_practice,row_location,(before_row->>'revision')::bigint,(after_row->>'revision')::bigint,COALESCE(changed,'{}'),before_safe,after_safe,tx,event_uuid,NULLIF(current_setting('app.actor_user_id',true),''),session_user,COALESCE(NULLIF(current_setting('role',true),'none'),session_user));
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION audit.capture_mutation() FROM PUBLIC;
CREATE FUNCTION audit.record_event(payload jsonb,resources jsonb DEFAULT '[]'::jsonb,changes jsonb DEFAULT '[]'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id'); actor text:=NULLIF(current_setting('app.actor_user_id',true),''); event_uuid uuid:=uuidv7(); tx uuid; entry jsonb; ordinal integer:=0; field text; meta jsonb:=COALESCE(payload->'metadata','{}'::jsonb); outcome_value text:=COALESCE(payload->>'outcome','succeeded'); scope_value text; patient_context jsonb;
BEGIN
 IF jsonb_typeof(payload)<>'object' OR octet_length(payload::text)>32768 OR jsonb_typeof(resources)<>'array' OR jsonb_array_length(resources)>501 OR jsonb_typeof(changes)<>'array' OR jsonb_array_length(changes)>100 THEN RAISE EXCEPTION 'INVALID_AUDIT_EVENT' USING ERRCODE='22023'; END IF;
 patient_context:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),current_setting('app.patient_is_session',true)='true');
 IF actor IS NULL THEN
  IF outcome_value IN ('accepted','succeeded') OR COALESCE(payload->>'actorType','anonymous')<>'anonymous' THEN RAISE EXCEPTION 'AUDIT_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
  p:=NULL; l:=NULL;
 END IF;
 IF patient_context IS NOT NULL THEN p:=(patient_context->>'practice_id')::uuid; l:=(patient_context->>'location_id')::uuid; actor:=COALESCE(patient_context->>'session_id',patient_context->>'grant_id'); END IF;
 IF outcome_value IN ('accepted','succeeded') AND (patient_context IS NULL AND (p IS NULL OR l IS NULL OR NOT public.careiq_clinical_scope(p,l))) THEN RAISE EXCEPTION 'AUDIT_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 -- Failed/denied commands may retain a verified practice only after scope denial. Do not trust a claimed location.
 IF patient_context IS NULL AND l IS NOT NULL AND (p IS NULL OR NOT public.careiq_clinical_scope(p,l)) THEN l:=NULL; END IF;
 IF patient_context IS NULL AND p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.practices pr JOIN public.practice_member_access m ON m.practice_id=pr.id WHERE pr.id=p AND m.user_id=actor AND m.status='active') THEN p:=NULL; l:=NULL; END IF;
 scope_value:=CASE WHEN p IS NULL THEN 'platform' WHEN l IS NULL THEN 'practice' ELSE 'location' END;
 IF jsonb_typeof(meta)<>'object' OR octet_length(meta::text)>8192 THEN RAISE EXCEPTION 'INVALID_AUDIT_METADATA' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT jsonb_object_keys(meta) LOOP
 IF field<>ALL(ARRAY['count','resourceCount','fromState','toState','reasonCode','policyVersion','revision','previousRevision','attempt','purpose','channel','failureCode','verificationMethod','assurance','byteCount','sourceHash','outputHash','consentHash','templateVersionId','documentVersionId','requirementId','requestId','packetId','observer','result','code','operation','resultState']) THEN RAISE EXCEPTION 'AUDIT_METADATA_FIELD_NOT_ALLOWED' USING ERRCODE='22023'; END IF;
 END LOOP;
 tx:=public.careiq_context_uuid('app.transaction_id'); IF tx IS NULL THEN tx:=uuidv7(); PERFORM set_config('app.transaction_id',tx::text,true); END IF;
 INSERT INTO audit.events(id,scope_kind,practice_id,location_id,actor_type,actor_id,initiating_actor_type,initiating_actor_id,executor_id,channel,action,entity_type,entity_id,outcome,reason_code,request_id,operation_id,workflow_id,causation_event_id,transaction_id,authorization_context,metadata)
 VALUES(event_uuid,scope_value,p,l,CASE WHEN patient_context IS NOT NULL THEN 'patient_session' WHEN actor IS NULL THEN 'anonymous' ELSE COALESCE(payload->>'actorType','user') END,actor,payload->>'initiatingActorType',payload->>'initiatingActorId',payload->>'executorId',COALESCE(payload->>'channel','api'),payload->>'action',payload->>'entityType',payload->>'entityId',outcome_value,payload->>'reasonCode',NULLIF(payload->>'requestId','')::uuid,NULLIF(payload->>'operationId','')::uuid,NULLIF(payload->>'workflowId','')::uuid,NULLIF(payload->>'causationEventId','')::uuid,tx,COALESCE(payload->'authorization','{}'::jsonb),meta);
 FOR entry IN SELECT value FROM jsonb_array_elements(resources) LOOP
 IF p IS NULL OR l IS NULL THEN RAISE EXCEPTION 'UNVERIFIED_AUDIT_RESOURCE_SCOPE' USING ERRCODE='42501'; END IF;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,ordinal,entry->>'resourceType',entry->>'resourceId',COALESCE(entry->>'relationship','affected'),p,l,NULLIF(entry->>'patientId','')::uuid); ordinal:=ordinal+1;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(changes) LOOP
 -- Patient names, answers, content, notes and bearer values use changed-only capture.
 IF COALESCE(entry->>'captureMode','changed_only')='value' AND (entry->>'fieldPath')<>ALL(ARRAY['status','state','lifecycleState','revision','scheduledAt','endsAt','providerId','visitTypeId','assigneeUserId','dueAt','priority','decision','active','required','reviewRequired','signatureRequired']) THEN RAISE EXCEPTION 'AUDIT_VALUE_CAPTURE_DENIED' USING ERRCODE='22023'; END IF;
 INSERT INTO audit.changes(event_id,resource_type,resource_id,field_path,capture_mode,before_value,after_value,protected_reference) VALUES(event_uuid,entry->>'resourceType',entry->>'resourceId',entry->>'fieldPath',COALESCE(entry->>'captureMode','changed_only'),CASE WHEN entry->>'captureMode'='value' THEN entry->'before' END,CASE WHEN entry->>'captureMode'='value' THEN entry->'after' END,entry->>'protectedReference');
 END LOOP;
 PERFORM set_config('app.audit_event_id',event_uuid::text,true); RETURN event_uuid;
END $$;
REVOKE ALL ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) TO careiq_clinical_runtime;
CREATE FUNCTION audit.activity(patient_filter uuid DEFAULT NULL,appointment_filter uuid DEFAULT NULL,document_filter uuid DEFAULT NULL,result_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,occurred_at timestamptz,action text,entity_type text,entity_id text,outcome text,actor_type text,actor_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id');
BEGIN
 IF result_limit<1 OR result_limit>101 OR l IS NULL OR NOT public.careiq_clinical_scope(p,l) THEN RAISE EXCEPTION 'ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.recorded_at,e.action::text,e.entity_type,e.entity_id,e.outcome,e.actor_type,e.actor_id FROM audit.events e
 WHERE e.practice_id=p AND e.location_id=l AND e.outcome IN ('accepted','succeeded') AND e.action = ANY(ARRAY['patients.create','patients.update','patients.archive','patients.restore','appointments.create','appointments.update','appointments.reschedule','appointments.status','appointments.cancel','requirements.waive','requirements.unwaive','requirements.evidence.select','documents.upload.reserve','documents.upload.complete','documents.review','documents.archive','documents.restore','requests.create','requests.cancel','requests.remind','prepared_documents.create','prepared_documents.update','prepared_documents.prepare','signatures.complete','signatures.decline','work_items.update'])
 AND (patient_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.patient_id=patient_filter))
 AND (appointment_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='appointment' AND r.resource_id=appointment_filter::text))
 AND (document_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='document' AND r.resource_id=document_filter::text))
 AND (before_time IS NULL OR (e.recorded_at,e.id)<(before_time,before_id)) ORDER BY e.recorded_at DESC,e.id DESC LIMIT result_limit;
END $$;
REVOKE ALL ON FUNCTION audit.activity(uuid,uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.activity(uuid,uuid,uuid,integer,timestamptz,uuid) TO careiq_clinical_runtime;
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.patients FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.practice_member_access FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.location_assignments FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.practice_invitations FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.practice_onboarding FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.practices FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.providers FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.visit_types FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_types FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.requirement_rule_sets FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.requirement_rules FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.practice_asset_objects FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.template_versions FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.provider_webhook_receipts FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.provider_locations FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.provider_availability_rules FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.provider_availability_exceptions FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.visit_requirements FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_versions FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.upload_sessions FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_reviews FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.requirement_evidence FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.prepared_documents FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_requests FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_request_items FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.patient_access_grants FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.patient_sessions FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.signature_packets FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.signature_fields FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.signature_events FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_access_grants FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.file_access_observations FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_retention FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.document_holds FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.workflow_operations FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.workflow_request_keys FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.job_runs FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.file_scan_runs FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.delivery_attempts FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.work_items FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.document_versions FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.document_reviews FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.signature_events FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.file_access_observations FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.file_scan_runs FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_immutable BEFORE UPDATE OR DELETE ON public.provider_webhook_receipts FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
--> statement-breakpoint
CREATE TRIGGER workflow_template_immutable BEFORE UPDATE OR DELETE ON public.template_versions FOR EACH ROW EXECUTE FUNCTION public.careiq_published_template_guard();
CREATE TRIGGER workflow_rule_set_immutable BEFORE UPDATE OR DELETE ON public.requirement_rule_sets FOR EACH ROW EXECUTE FUNCTION public.careiq_published_rule_set_guard();
CREATE TRIGGER workflow_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.requirement_rules FOR EACH ROW EXECUTE FUNCTION public.careiq_published_rule_guard();
CREATE TRIGGER workflow_job_terminal BEFORE UPDATE OR DELETE ON public.job_runs FOR EACH ROW EXECUTE FUNCTION public.careiq_terminal_job_guard();
--> statement-breakpoint
ALTER TABLE public.document_reviews ADD CONSTRAINT document_reviews_audit_event_id_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.signature_events ADD CONSTRAINT signature_events_audit_event_id_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.document_access_grants ADD CONSTRAINT document_access_grants_issuing_audit_event_id_fk FOREIGN KEY(issuing_audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.file_access_observations ADD CONSTRAINT file_access_observations_audit_event_id_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.file_scan_runs ADD CONSTRAINT file_scan_runs_audit_event_id_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_audit_event_id_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.workflow_operations ADD CONSTRAINT workflow_operations_causation_event_id_fk FOREIGN KEY(causation_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_causation_event_id_fk FOREIGN KEY(causation_event_id) REFERENCES audit.events(id);
