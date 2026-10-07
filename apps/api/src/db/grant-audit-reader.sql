-- Authorized operator only, after migration 0016; pass -v audit_reader_role=dedicated_audit_login.
-- Never use the API runtime login. No credentials are created or modified.
-- Reviews require BEGIN READ ONLY; SELECT set_config('app.practice_id', '<approved practice UUID>', true);
-- SELECT ... FROM clinical_audit_events ORDER BY occurred_at DESC LIMIT 100; COMMIT;
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('careiq.audit_reader_role', :'audit_reader_role', true);
DO $$
DECLARE reviewer record; related record; table_owner oid; schema_owner oid; database_owner oid; protected_table text;
BEGIN
  SELECT * INTO reviewer FROM pg_roles WHERE rolname = current_setting('careiq.audit_reader_role');
  IF NOT FOUND OR NOT reviewer.rolcanlogin THEN RAISE EXCEPTION 'Audit reviewer must be an existing dedicated login'; END IF;
  SELECT relowner INTO table_owner FROM pg_class WHERE oid = 'public.clinical_audit_events'::regclass;
  SELECT nspowner INTO schema_owner FROM pg_namespace WHERE nspname = 'public';
  SELECT datdba INTO database_owner FROM pg_database WHERE datname = current_database();
  EXECUTE format('GRANT careiq_audit_reader TO %I', reviewer.rolname);
  FOR related IN SELECT * FROM pg_roles WHERE oid = reviewer.oid OR pg_has_role(reviewer.oid, oid, 'MEMBER')
  LOOP
    IF related.rolsuper OR related.rolbypassrls OR related.rolcreaterole OR related.rolcreatedb OR related.rolreplication
       OR related.rolname IN ('careiq_clinical_runtime', 'careiq_marketing_submitter', 'pg_read_all_data', 'pg_write_all_data', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
       OR pg_has_role(related.oid, table_owner, 'MEMBER') OR pg_has_role(related.oid, schema_owner, 'MEMBER') OR pg_has_role(related.oid, database_owner, 'MEMBER')
       OR has_table_privilege(related.oid, 'public.clinical_audit_events', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege(related.oid, 'public.practice_admin_events', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION 'Audit reviewer must be separate from runtime and privileged roles and have read-only audit access';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid IN ('public.clinical_audit_events'::regclass,'public.practice_admin_events'::regclass) AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege(related.oid, attrelid, attname, 'INSERT, UPDATE, REFERENCES')
    ) THEN RAISE EXCEPTION 'Audit reviewer must not have audit write column privileges'; END IF;
    FOREACH protected_table IN ARRAY ARRAY['practices', 'patients', 'appointments', 'clinical_request_keys', 'marketing_interview_requests','locations','practice_member_access','location_assignments','practice_invitations','practice_invitation_attempts','practice_onboarding','practice_provider_events']
    LOOP
      IF has_table_privilege(related.oid, format('public.%I', protected_table), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         OR EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I', protected_table)::regclass AND pg_has_role(related.oid, relowner, 'MEMBER'))
         OR EXISTS (
           SELECT 1 FROM pg_attribute WHERE attrelid = format('public.%I', protected_table)::regclass AND attnum > 0 AND NOT attisdropped
           AND has_column_privilege(related.oid, format('public.%I', protected_table), attname, 'SELECT, INSERT, UPDATE, REFERENCES')
         ) THEN
        RAISE EXCEPTION 'Dedicated audit reviewer must not have clinical or marketing table access';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege(reviewer.oid, 'public.clinical_audit_events', 'SELECT') THEN
    RAISE EXCEPTION 'Audit reviewer must inherit audit SELECT access';
  END IF;
END $$;
COMMIT;
