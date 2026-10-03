-- After migration 0015, run as an authorized operator with -v runtime_role=actual_api_login.
-- This grants only group membership; it never creates credentials or modifies existing roles.
-- Run grant-marketing-submitter.sql separately for the same login when enabling marketing.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('careiq.runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime_name text := current_setting('careiq.runtime_role');
  runtime_record record;
  reachable_record record;
  protected_table text;
  protected_column text;
  schema_owner oid;
  database_owner oid;
BEGIN
  SELECT * INTO runtime_record FROM pg_roles WHERE rolname = runtime_name;
  IF NOT FOUND OR NOT runtime_record.rolcanlogin THEN
    RAISE EXCEPTION 'Configured runtime role must be an existing login';
  END IF;
  SELECT nspowner INTO schema_owner FROM pg_namespace WHERE nspname = 'public';
  SELECT datdba INTO database_owner FROM pg_database WHERE datname = current_database();
  EXECUTE format('GRANT careiq_clinical_runtime TO %I', runtime_name);
  FOR reachable_record IN
    SELECT * FROM pg_roles WHERE oid = runtime_record.oid OR pg_has_role(runtime_record.oid, oid, 'MEMBER')
  LOOP
    IF reachable_record.rolsuper OR reachable_record.rolbypassrls OR reachable_record.rolcreaterole
       OR reachable_record.rolcreatedb OR reachable_record.rolreplication
       OR reachable_record.rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_read_all_data', 'pg_write_all_data')
       OR pg_has_role(reachable_record.oid, schema_owner, 'MEMBER')
       OR pg_has_role(reachable_record.oid, database_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'Runtime role must not have privileged or owning role membership';
    END IF;
    FOREACH protected_table IN ARRAY ARRAY['practices', 'patients', 'appointments', 'clinical_request_keys', 'clinical_audit_events']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I', protected_table)::regclass AND pg_has_role(reachable_record.oid, relowner, 'MEMBER')) THEN
        RAISE EXCEPTION 'Runtime role must not own clinical tables or have owner membership';
      END IF;
      IF has_table_privilege(reachable_record.oid, format('public.%I', protected_table), 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
        RAISE EXCEPTION 'Runtime role has excessive clinical table privileges';
      END IF;
      FOR protected_column IN
        SELECT attname FROM pg_attribute WHERE attrelid = format('public.%I', protected_table)::regclass AND attnum > 0 AND NOT attisdropped
      LOOP
        IF has_column_privilege(reachable_record.oid, format('public.%I', protected_table), protected_column, 'UPDATE, REFERENCES')
           OR (protected_table = 'clinical_audit_events' AND has_column_privilege(reachable_record.oid, 'public.clinical_audit_events', protected_column, 'SELECT')) THEN
          RAISE EXCEPTION 'Runtime role can read audit data or modify protected clinical columns';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH protected_table IN ARRAY ARRAY['practices', 'patients', 'appointments', 'clinical_request_keys']
  LOOP
    IF NOT has_table_privilege(runtime_record.oid, format('public.%I', protected_table), 'SELECT')
       OR NOT has_table_privilege(runtime_record.oid, format('public.%I', protected_table), 'INSERT') THEN
      RAISE EXCEPTION 'Runtime role must inherit clinical SELECT and INSERT privileges';
    END IF;
  END LOOP;
  IF NOT has_table_privilege(runtime_record.oid, 'public.clinical_audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'Runtime role must inherit append-only clinical audit access';
  END IF;
END $$;
COMMIT;
