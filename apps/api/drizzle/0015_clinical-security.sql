CREATE TABLE "clinical_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" varchar(32) NOT NULL,
	"resource_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_audit_events_actor_valid" CHECK (length(btrim("clinical_audit_events"."actor_user_id")) BETWEEN 1 AND 256),
	CONSTRAINT "clinical_audit_events_action_valid" CHECK ("clinical_audit_events"."action" IN ('patients.create', 'patients.read', 'patients.list', 'appointments.create', 'appointments.read', 'appointments.list'))
);
--> statement-breakpoint
CREATE TABLE "clinical_request_keys" (
	"practice_id" uuid NOT NULL,
	"operation" varchar(32) NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_request_keys_practice_id_operation_request_key_pk" PRIMARY KEY("practice_id","operation","request_key"),
	CONSTRAINT "clinical_request_keys_operation_valid" CHECK ("clinical_request_keys"."operation" IN ('patients.create', 'appointments.create')),
	CONSTRAINT "clinical_request_keys_hash_valid" CHECK ("clinical_request_keys"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "clinical_request_keys_key_v4" CHECK (substring("clinical_request_keys"."request_key"::text from 15 for 1) = '4' AND substring("clinical_request_keys"."request_key"::text from 20 for 1) IN ('8', '9', 'a', 'b'))
);
--> statement-breakpoint
ALTER TABLE "clinical_audit_events" ADD CONSTRAINT "clinical_audit_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_request_keys" ADD CONSTRAINT "clinical_request_keys_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_audit_events_practice_time_idx" ON "clinical_audit_events" USING btree ("practice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "appointments_practice_schedule_idx" ON "appointments" USING btree ("practice_id","scheduled_at","id");--> statement-breakpoint
CREATE INDEX "patients_practice_name_idx" ON "patients" USING btree ("practice_id","last_name","first_name","id");
--> statement-breakpoint
ALTER TABLE clinical_request_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_request_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_request_keys_select ON clinical_request_keys FOR SELECT
USING (practice_id = NULLIF(current_setting('app.practice_id', true), '')::uuid);
CREATE POLICY clinical_request_keys_insert ON clinical_request_keys FOR INSERT
WITH CHECK (practice_id = NULLIF(current_setting('app.practice_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE clinical_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_audit_events_insert ON clinical_audit_events FOR INSERT
WITH CHECK (practice_id = NULLIF(current_setting('app.practice_id', true), '')::uuid);
--> statement-breakpoint
-- Remove inherited default grants from these new tables only.
REVOKE ALL PRIVILEGES ON clinical_request_keys, clinical_audit_events FROM PUBLIC;
DO $$
DECLARE inherited_grant record;
BEGIN
  FOR inherited_grant IN
    SELECT DISTINCT relations.relname, roles.rolname
    FROM pg_class AS relations
    CROSS JOIN LATERAL aclexplode(relations.relacl) AS grants
    JOIN pg_roles AS roles ON roles.oid = grants.grantee
    WHERE relations.oid IN ('public.clinical_request_keys'::regclass, 'public.clinical_audit_events'::regclass)
      AND grants.grantee <> relations.relowner
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', inherited_grant.relname, inherited_grant.rolname);
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careiq_clinical_runtime') THEN
    CREATE ROLE careiq_clinical_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'careiq_clinical_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'careiq_clinical_runtime')
  ) THEN
    RAISE EXCEPTION 'Existing careiq_clinical_runtime must be a non-privileged standalone NOLOGIN group';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO careiq_clinical_runtime;
GRANT SELECT, INSERT ON practices, patients, appointments, clinical_request_keys TO careiq_clinical_runtime;
GRANT INSERT ON clinical_audit_events TO careiq_clinical_runtime;
--> statement-breakpoint
-- Audit review is a separate, explicitly assigned capability, never a runtime grant.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careiq_audit_reader') THEN
    CREATE ROLE careiq_audit_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'careiq_audit_reader'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'careiq_audit_reader')
  ) THEN
    RAISE EXCEPTION 'Existing careiq_audit_reader must be a non-privileged standalone NOLOGIN group';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO careiq_audit_reader;
GRANT SELECT ON clinical_audit_events TO careiq_audit_reader;
CREATE POLICY clinical_audit_events_review ON clinical_audit_events FOR SELECT TO careiq_audit_reader
USING (practice_id = NULLIF(current_setting('app.practice_id', true), '')::uuid);
