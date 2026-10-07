-- Run only as an authorized database administrator after migration 0014.
-- psql "$OPERATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -v runtime_role=actual_api_role \
--   -f apps/api/src/db/grant-marketing-submitter.sql
-- This file changes only membership in the marketing submission group.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('careiq.runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime_name text := current_setting('careiq.runtime_role');
  runtime_record record;
  reachable_record record;
  table_owner oid;
  schema_owner oid;
  database_owner oid;
  column_name text;
BEGIN
  SELECT * INTO runtime_record FROM pg_roles WHERE rolname = runtime_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configured runtime database role does not exist'; END IF;
  SELECT relowner INTO table_owner FROM pg_class WHERE oid = 'public.marketing_interview_requests'::regclass;
  SELECT nspowner INTO schema_owner FROM pg_namespace WHERE nspname = 'public';
  SELECT datdba INTO database_owner FROM pg_database WHERE datname = current_database();
  IF runtime_record.rolsuper OR runtime_record.rolbypassrls OR runtime_record.rolcreaterole
     OR runtime_record.rolcreatedb OR runtime_record.rolreplication
     OR pg_has_role(runtime_record.oid, table_owner, 'MEMBER')
     OR pg_has_role(runtime_record.oid, schema_owner, 'MEMBER')
     OR pg_has_role(runtime_record.oid, database_owner, 'MEMBER') THEN
    RAISE EXCEPTION 'Runtime role must not be privileged or own the marketing table, public schema, or database, including through membership';
  END IF;

  EXECUTE format('GRANT careiq_marketing_submitter TO %I', runtime_name);

  IF NOT has_table_privilege(runtime_record.oid, 'public.marketing_interview_requests', 'INSERT')
     OR NOT has_column_privilege(runtime_record.oid, 'public.marketing_interview_requests', 'submission_key', 'SELECT') THEN
    RAISE EXCEPTION 'Runtime role must inherit INSERT and SELECT(submission_key) privileges';
  END IF;
  -- Effective privileges and SET alone miss ADMIN OPTION memberships whose
  -- holder can enable INHERIT/SET later. Conservatively audit every transitive
  -- membership, including memberships currently marked NOINHERIT and NOSET.
  FOR reachable_record IN
    SELECT * FROM pg_roles
    WHERE oid = runtime_record.oid OR pg_has_role(runtime_record.oid, oid, 'MEMBER')
  LOOP
    -- These predefined roles can bypass table ACLs through server files or OS
    -- commands. Read-only monitoring roles are not blanket-rejected here.
    IF reachable_record.rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program') THEN
      RAISE EXCEPTION 'Runtime role has server file or program role membership; resolve membership before launch';
    END IF;
    IF reachable_record.rolsuper OR reachable_record.rolbypassrls OR reachable_record.rolcreaterole
       OR reachable_record.rolcreatedb OR reachable_record.rolreplication
       OR pg_has_role(reachable_record.oid, table_owner, 'MEMBER')
       OR pg_has_role(reachable_record.oid, schema_owner, 'MEMBER')
       OR pg_has_role(reachable_record.oid, database_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'Runtime role is a member of a privileged or owning role; resolve membership before launch';
    END IF;
    IF has_table_privilege(reachable_record.oid, 'public.marketing_interview_requests', 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION 'Runtime role has unexpected privileges on marketing requests; resolve grants before launch';
    END IF;
    FOR column_name IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = 'public.marketing_interview_requests'::regclass
        AND attnum > 0 AND NOT attisdropped
    LOOP
      IF has_column_privilege(reachable_record.oid, 'public.marketing_interview_requests', column_name, 'UPDATE, REFERENCES')
         OR (column_name <> 'submission_key' AND has_column_privilege(reachable_record.oid, 'public.marketing_interview_requests', column_name, 'SELECT')) THEN
        RAISE EXCEPTION 'Runtime role can read or modify protected marketing request columns; resolve grants before launch';
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
