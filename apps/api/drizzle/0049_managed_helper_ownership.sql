-- Local repair approved after review of docs/managed-owner-repair-proposal.md.
-- These private owners repair forced-RLS helper execution without changing old
-- function bodies, table ownership, ordinary runtime grants, or historical SQL.
-- Every runtime entry point retains its existing authorization checks. The release
-- verifier pins bodies, owners, role attributes, memberships, ACLs and policies.

CREATE ROLE careiq_token_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE careiq_portal_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE careiq_patient_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE careiq_patient_audit_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE careiq_suppression_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT careiq_token_lookup,
  careiq_portal_operator,
  careiq_patient_operator,
  careiq_patient_audit_writer,
  careiq_suppression_reader TO CURRENT_USER WITH INHERIT TRUE,
  SET TRUE;

-- Exact grants for careiq_token_lookup; no role inherits another helper.
GRANT USAGE ON SCHEMA public TO careiq_token_lookup;
GRANT USAGE ON SCHEMA audit TO careiq_token_lookup;
GRANT INSERT ON audit.event_resources TO careiq_token_lookup;
GRANT INSERT ON audit.events TO careiq_token_lookup;
GRANT SELECT ON public.workflow_operations TO careiq_token_lookup;
GRANT SELECT ON public.workflow_request_keys TO careiq_token_lookup;
GRANT SELECT(id) ON audit.events TO careiq_token_lookup;
GRANT SELECT(expires_at, id, location_id, patient_id, practice_id, purpose, revision, state) ON public.document_requests TO careiq_token_lookup;
GRANT SELECT(id, practice_id, status) ON public.locations TO careiq_token_lookup;
GRANT SELECT(consumed_at,
  expires_at,
  id,
  location_id,
  patient_id,
  practice_id,
  request_id,
  revoked_at,
  token_hash) ON public.patient_access_grants TO careiq_token_lookup;
GRANT SELECT(expires_at,
  grant_id,
  id,
  location_id,
  patient_id,
  practice_id,
  request_id,
  request_revision,
  revoked_at,
  token_hash) ON public.patient_sessions TO careiq_token_lookup;
GRANT SELECT(id, status) ON public.practices TO careiq_token_lookup;

-- Exact grants for careiq_portal_operator; no role inherits another helper.
GRANT USAGE ON SCHEMA public TO careiq_portal_operator;
GRANT USAGE ON SCHEMA audit TO careiq_portal_operator;
GRANT INSERT ON audit.event_resources TO careiq_portal_operator;
GRANT INSERT ON audit.events TO careiq_portal_operator;
GRANT SELECT ON public.communication_endpoints TO careiq_portal_operator;
GRANT INSERT, SELECT ON public.communication_permission_events TO careiq_portal_operator;
GRANT SELECT ON public.destination_suppression_releases TO careiq_portal_operator;
GRANT SELECT ON public.destination_suppressions TO careiq_portal_operator;
GRANT SELECT ON public.location_assignments TO careiq_portal_operator;
GRANT SELECT ON public.locations TO careiq_portal_operator;
GRANT SELECT ON public.paperwork_library_items TO careiq_portal_operator;
GRANT SELECT ON public.patient_portal_grants TO careiq_portal_operator;
GRANT INSERT, SELECT ON public.portal_communication_profiles TO careiq_portal_operator;
GRANT INSERT, SELECT ON public.portal_communication_request_keys TO careiq_portal_operator;
GRANT SELECT ON public.practice_member_access TO careiq_portal_operator;
GRANT SELECT ON public.practices TO careiq_portal_operator;
GRANT SELECT(id) ON audit.events TO careiq_portal_operator;
GRANT UPDATE(id) ON public.communication_endpoints TO careiq_portal_operator;
GRANT SELECT(detected_media_type,
  id,
  location_id,
  original_filename,
  patient_id,
  practice_id,
  sha256,
  status,
  storage_key) ON public.file_objects TO careiq_portal_operator;
GRANT UPDATE(id) ON public.patient_portal_grants TO careiq_portal_operator;
GRANT SELECT(archived_at, date_of_birth, id, location_id, practice_id) ON public.patients TO careiq_portal_operator;
GRANT UPDATE(id) ON public.patients TO careiq_portal_operator;
GRANT UPDATE(revision, updated_at) ON public.portal_communication_profiles TO careiq_portal_operator;

-- Exact grants for careiq_patient_operator; no role inherits another helper.
GRANT USAGE ON SCHEMA public TO careiq_patient_operator;
GRANT USAGE ON SCHEMA audit TO careiq_patient_operator;
GRANT SELECT ON public.appointments TO careiq_patient_operator;
GRANT SELECT ON public.communication_endpoints TO careiq_patient_operator;
GRANT SELECT ON public.communication_permission_events TO careiq_patient_operator;
GRANT SELECT, UPDATE ON public.document_request_items TO careiq_patient_operator;
GRANT SELECT, UPDATE ON public.document_requests TO careiq_patient_operator;
GRANT SELECT ON public.document_reviews TO careiq_patient_operator;
GRANT SELECT ON public.document_versions TO careiq_patient_operator;
GRANT SELECT ON public.location_assignments TO careiq_patient_operator;
GRANT SELECT ON public.locations TO careiq_patient_operator;
GRANT INSERT, SELECT ON public.outbox_events TO careiq_patient_operator;
GRANT INSERT, SELECT ON public.paperwork_library_items TO careiq_patient_operator;
GRANT INSERT, SELECT ON public.paperwork_notifications TO careiq_patient_operator;
GRANT SELECT ON public.patient_portal_grants TO careiq_patient_operator;
GRANT SELECT ON public.practice_member_access TO careiq_patient_operator;
GRANT SELECT ON public.practices TO careiq_patient_operator;
GRANT SELECT ON public.prepared_documents TO careiq_patient_operator;
GRANT INSERT, SELECT, UPDATE ON public.requirement_evidence TO careiq_patient_operator;
GRANT SELECT ON public.signature_packets TO careiq_patient_operator;
GRANT SELECT, UPDATE ON public.visit_requirements TO careiq_patient_operator;
GRANT INSERT, SELECT, UPDATE ON public.work_items TO careiq_patient_operator;
GRANT SELECT(archived_at, document_type_id, id, location_id, patient_id, practice_id, title) ON public.documents TO careiq_patient_operator;
GRANT SELECT(id,
  location_id,
  patient_id,
  practice_id,
  sha256,
  status,
  storage_key,
  verified_at) ON public.file_objects TO careiq_patient_operator;
GRANT SELECT(archived_at, date_of_birth, id, location_id, practice_id) ON public.patients TO careiq_patient_operator;
GRANT UPDATE(id) ON public.patients TO careiq_patient_operator;
GRANT SELECT(form_schema, id, practice_id, schema_version) ON public.template_versions TO careiq_patient_operator;

-- Exact grants for careiq_patient_audit_writer; no role inherits another helper.
GRANT USAGE ON SCHEMA public TO careiq_patient_audit_writer;
GRANT USAGE ON SCHEMA audit TO careiq_patient_audit_writer;
GRANT INSERT ON audit.changes TO careiq_patient_audit_writer;
GRANT INSERT ON audit.event_resources TO careiq_patient_audit_writer;
GRANT INSERT ON audit.events TO careiq_patient_audit_writer;
GRANT SELECT ON public.location_assignments TO careiq_patient_audit_writer;
GRANT SELECT ON public.locations TO careiq_patient_audit_writer;
GRANT SELECT ON public.practice_member_access TO careiq_patient_audit_writer;
GRANT SELECT ON public.practices TO careiq_patient_audit_writer;
GRANT SELECT(id, location_id, practice_id) ON public.patients TO careiq_patient_audit_writer;

-- Exact grants for careiq_suppression_reader; no role inherits another helper.
GRANT USAGE ON SCHEMA public TO careiq_suppression_reader;
GRANT SELECT ON public.destination_suppression_releases TO careiq_suppression_reader;
GRANT SELECT ON public.destination_suppressions TO careiq_suppression_reader;
GRANT SELECT ON public.location_assignments TO careiq_suppression_reader;
GRANT SELECT ON public.locations TO careiq_suppression_reader;
GRANT SELECT ON public.practice_member_access TO careiq_suppression_reader;
GRANT SELECT ON public.practices TO careiq_suppression_reader;

-- Only these 13 existing definitions change owner. Keep the prior owner able
-- to make internal helper calls, including later reviewed grant maintenance.
GRANT CREATE ON SCHEMA audit TO careiq_patient_audit_writer;
ALTER FUNCTION audit.record_event(jsonb,jsonb,jsonb) OWNER TO careiq_patient_audit_writer;
REVOKE ALL ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA audit FROM careiq_patient_audit_writer;
GRANT CREATE ON SCHEMA public TO careiq_patient_operator;
ALTER FUNCTION public.careiq_form_completion_guard() OWNER TO careiq_patient_operator;
REVOKE ALL ON FUNCTION public.careiq_form_completion_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_form_completion_guard() TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_patient_operator;
GRANT CREATE ON SCHEMA public TO careiq_patient_operator;
ALTER FUNCTION public.careiq_form_signer_authorized(uuid) OWNER TO careiq_patient_operator;
REVOKE ALL ON FUNCTION public.careiq_form_signer_authorized(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_form_signer_authorized(uuid) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_patient_operator;
GRANT CREATE ON SCHEMA public TO careiq_patient_operator;
ALTER FUNCTION public.careiq_patient_close_request(text) OWNER TO careiq_patient_operator;
REVOKE ALL ON FUNCTION public.careiq_patient_close_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_close_request(text) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_patient_operator;
GRANT CREATE ON SCHEMA public TO careiq_patient_operator;
ALTER FUNCTION public.careiq_patient_fulfill_item(uuid,uuid) OWNER TO careiq_patient_operator;
REVOKE ALL ON FUNCTION public.careiq_patient_fulfill_item(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_fulfill_item(uuid,uuid) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_patient_operator;
GRANT CREATE ON SCHEMA public TO careiq_patient_operator;
ALTER FUNCTION public.careiq_publish_completed_paperwork(uuid,uuid,boolean) OWNER TO careiq_patient_operator;
REVOKE ALL ON FUNCTION public.careiq_publish_completed_paperwork(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_publish_completed_paperwork(uuid,uuid,boolean) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_patient_operator;
GRANT CREATE ON SCHEMA public TO careiq_portal_operator;
ALTER FUNCTION public.careiq_communication_profile_changed() OWNER TO careiq_portal_operator;
REVOKE ALL ON FUNCTION public.careiq_communication_profile_changed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_communication_profile_changed() TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_portal_operator;
GRANT CREATE ON SCHEMA public TO careiq_portal_operator;
ALTER FUNCTION public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text) OWNER TO careiq_portal_operator;
REVOKE ALL ON FUNCTION public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_portal_operator;
GRANT CREATE ON SCHEMA public TO careiq_portal_operator;
ALTER FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid) OWNER TO careiq_portal_operator;
REVOKE ALL ON FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_portal_operator;
GRANT CREATE ON SCHEMA public TO careiq_suppression_reader;
ALTER FUNCTION public.careiq_delivery_destination_suppressed(text,text,text) OWNER TO careiq_suppression_reader;
REVOKE ALL ON FUNCTION public.careiq_delivery_destination_suppressed(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_delivery_destination_suppressed(text,text,text) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_suppression_reader;
GRANT CREATE ON SCHEMA public TO careiq_token_lookup;
ALTER FUNCTION public.careiq_patient_command_receipt(text,text) OWNER TO careiq_token_lookup;
REVOKE ALL ON FUNCTION public.careiq_patient_command_receipt(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_command_receipt(text,text) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_token_lookup;
GRANT CREATE ON SCHEMA public TO careiq_token_lookup;
ALTER FUNCTION public.careiq_patient_completion_receipt(text) OWNER TO careiq_token_lookup;
REVOKE ALL ON FUNCTION public.careiq_patient_completion_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_completion_receipt(text) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_token_lookup;
GRANT CREATE ON SCHEMA public TO careiq_token_lookup;
ALTER FUNCTION public.careiq_resolve_patient_access(text,boolean) OWNER TO careiq_token_lookup;
REVOKE ALL ON FUNCTION public.careiq_resolve_patient_access(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO CURRENT_USER WITH GRANT OPTION;
REVOKE CREATE ON SCHEMA public FROM careiq_token_lookup;

-- Nested calls are explicit because ownership transfer removes implicit
-- privileges held by the former owner. Trigger-only helpers remain private.
GRANT EXECUTE ON FUNCTION audit.capture_mutation() TO careiq_portal_operator;
GRANT EXECUTE ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) TO careiq_portal_operator;
GRANT EXECUTE ON FUNCTION public.careiq_adult_self_eligible_at(date,text,timestamp with time zone) TO careiq_portal_operator;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_portal_operator;
GRANT EXECUTE ON FUNCTION audit.record_event(jsonb,jsonb,jsonb) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_adult_self_eligible_at(date,text,timestamp with time zone) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_patient_form_scope(uuid) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_patient_scope(text,jsonb) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_workflow_practice_scope(uuid) TO careiq_patient_operator;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_patient_audit_writer;
GRANT EXECUTE ON FUNCTION public.careiq_resolve_patient_access(text,boolean) TO careiq_suppression_reader;

-- Bootstrap reads are available only while running the fixed helper bodies.
-- Direct runtime reads remain governed by their existing tenant policies.
-- The audit patient identity policy additionally binds token actors to one patient.
CREATE POLICY managed_receipt_resources_insert ON audit.event_resources
  FOR INSERT TO careiq_token_lookup
  WITH CHECK (true);
CREATE POLICY managed_receipt_audit_insert ON audit.events
  FOR INSERT TO careiq_token_lookup
  WITH CHECK (((actor_type = 'patient_session'::text)
    AND ((action)::text = ANY ((ARRAY['signatures.completion.receipt_access'::character varying, 'patient_commands.receipt_access'::character varying])::text[]))));
CREATE POLICY managed_receipt_audit_returning ON audit.events
  FOR SELECT TO careiq_token_lookup
  USING (((actor_type = 'patient_session'::text)
    AND ((action)::text = ANY ((ARRAY['signatures.completion.receipt_access'::character varying, 'patient_commands.receipt_access'::character varying])::text[]))));
CREATE POLICY managed_token_lookup ON public.document_requests
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_lookup ON public.locations
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_lookup ON public.patient_access_grants
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_lookup ON public.patient_sessions
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_lookup ON public.practices
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_receipts ON public.workflow_operations
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_token_receipts ON public.workflow_request_keys
  FOR SELECT TO careiq_token_lookup
  USING (true);
CREATE POLICY managed_portal_resources_insert ON audit.event_resources
  FOR INSERT TO careiq_portal_operator
  WITH CHECK (true);
CREATE POLICY managed_portal_audit_insert ON audit.events
  FOR INSERT TO careiq_portal_operator
  WITH CHECK (((actor_id = current_setting('app.portal_subject'::text, true))
    AND (actor_type = 'user'::text)));
CREATE POLICY managed_portal_audit_returning ON audit.events
  FOR SELECT TO careiq_portal_operator
  USING (((actor_id = current_setting('app.portal_subject'::text, true))
    AND (actor_type = 'user'::text)));
CREATE POLICY managed_portal_lock ON public.communication_endpoints
  FOR UPDATE TO careiq_portal_operator
  USING (true)
  WITH CHECK (false);
CREATE POLICY managed_portal_lock ON public.patient_portal_grants
  FOR UPDATE TO careiq_portal_operator
  USING (true)
  WITH CHECK (false);
CREATE POLICY managed_portal_lock ON public.patients
  FOR UPDATE TO careiq_portal_operator
  USING (true)
  WITH CHECK (false);
CREATE POLICY managed_portal_select ON public.communication_endpoints
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.communication_permission_events
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.destination_suppression_releases
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.destination_suppressions
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.file_objects
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.locations
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.paperwork_library_items
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.patient_portal_grants
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.patients
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.portal_communication_profiles
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.portal_communication_request_keys
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_select ON public.practices
  FOR SELECT TO careiq_portal_operator
  USING (true);
CREATE POLICY managed_portal_consent_insert ON public.communication_permission_events
  FOR INSERT TO careiq_portal_operator
  WITH CHECK (((source = 'patient_portal'::text)
    AND (actor_user_id = current_setting('app.portal_subject'::text, true))));
CREATE POLICY managed_portal_profile_insert ON public.portal_communication_profiles
  FOR INSERT TO careiq_portal_operator
  WITH CHECK ((EXISTS ( SELECT 1
      FROM patient_portal_grants g
      WHERE ((g.id = portal_communication_profiles.grant_id)
    AND (g.patient_id = portal_communication_profiles.patient_id)
    AND (g.practice_id = portal_communication_profiles.practice_id)
    AND (g.location_id = portal_communication_profiles.location_id)
    AND (g.clerk_user_id = current_setting('app.portal_subject'::text, true))
    AND (g.revoked_at IS NULL)
    AND (g.expires_at > now())))));
CREATE POLICY managed_portal_profile_update ON public.portal_communication_profiles
  FOR UPDATE TO careiq_portal_operator
  USING (true)
  WITH CHECK (true);
CREATE POLICY managed_portal_receipt_insert ON public.portal_communication_request_keys
  FOR INSERT TO careiq_portal_operator
  WITH CHECK (true);
CREATE POLICY managed_patient_select ON public.appointments
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.communication_endpoints
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.communication_permission_events
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.document_request_items
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.document_requests
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.document_reviews
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.document_versions
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.documents
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.file_objects
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.outbox_events
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.paperwork_library_items
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.paperwork_notifications
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.patient_portal_grants
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.patients
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.prepared_documents
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.requirement_evidence
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.signature_packets
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.template_versions
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.visit_requirements
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_select ON public.work_items
  FOR SELECT TO careiq_patient_operator
  USING (true);
CREATE POLICY managed_patient_write ON public.document_request_items
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_request_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = document_request_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = document_request_items.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_request_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = document_request_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = document_request_items.patient_id))))));
CREATE POLICY managed_patient_write ON public.document_requests
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_requests.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = document_requests.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = document_requests.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_requests.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = document_requests.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = document_requests.patient_id))))));
CREATE POLICY managed_patient_write ON public.outbox_events
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = outbox_events.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = outbox_events.location_id)
    AND (((access.access ->> 'request_id'::text))::uuid = outbox_events.patient_request_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = outbox_events.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = outbox_events.location_id)
    AND (((access.access ->> 'request_id'::text))::uuid = outbox_events.patient_request_id))))));
CREATE POLICY managed_patient_write ON public.paperwork_library_items
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_library_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = paperwork_library_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_library_items.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_library_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = paperwork_library_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_library_items.patient_id))))));
CREATE POLICY managed_patient_write ON public.paperwork_notifications
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_notifications.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = paperwork_notifications.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_notifications.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_notifications.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = paperwork_notifications.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_notifications.patient_id))))));
CREATE POLICY managed_patient_lock ON public.patients
  FOR UPDATE TO careiq_patient_operator
  USING (true)
  WITH CHECK (false);
CREATE POLICY managed_patient_write ON public.requirement_evidence
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = requirement_evidence.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = requirement_evidence.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = requirement_evidence.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = requirement_evidence.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = requirement_evidence.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = requirement_evidence.patient_id))))));
CREATE POLICY managed_patient_write ON public.visit_requirements
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = visit_requirements.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = visit_requirements.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = visit_requirements.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = visit_requirements.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = visit_requirements.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = visit_requirements.patient_id))))));
CREATE POLICY managed_patient_write ON public.work_items
  FOR ALL TO careiq_patient_operator
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = work_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = work_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = work_items.patient_id))))))
  WITH CHECK ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = work_items.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = work_items.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = work_items.patient_id))))));
CREATE POLICY managed_event_change_insert ON audit.changes
  FOR INSERT TO careiq_patient_audit_writer
  WITH CHECK (true);
CREATE POLICY managed_event_resource_insert ON audit.event_resources
  FOR INSERT TO careiq_patient_audit_writer
  WITH CHECK (true);
CREATE POLICY managed_event_insert ON audit.events
  FOR INSERT TO careiq_patient_audit_writer
  WITH CHECK (true);
CREATE POLICY managed_audit_patient_identity ON public.patients
  FOR SELECT TO careiq_patient_audit_writer
  USING ((COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
    OR (EXISTS ( SELECT 1
      FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
      WHERE ((((access.access ->> 'practice_id'::text))::uuid = patients.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = patients.location_id)
    AND (((access.access ->> 'patient_id'::text))::uuid = patients.id))))));
CREATE POLICY managed_suppression_release_read ON public.destination_suppression_releases
  FOR SELECT TO careiq_suppression_reader
  USING (true);
CREATE POLICY managed_suppression_read ON public.destination_suppressions
  FOR SELECT TO careiq_suppression_reader
  USING (true);

-- Administrative membership does not permit ordinary inheritance or SET ROLE.
GRANT careiq_token_lookup,
  careiq_portal_operator,
  careiq_patient_operator,
  careiq_patient_audit_writer,
  careiq_suppression_reader TO CURRENT_USER WITH INHERIT FALSE,
  SET FALSE;
