CREATE TABLE "marketing_interview_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"role" varchar(32) NOT NULL,
	"practice_name" varchar(160),
	"submission_key" uuid NOT NULL,
	"source" varchar(32) DEFAULT 'marketing_homepage' NOT NULL,
	"privacy_notice_version" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_interview_requests_submission_key_unique" UNIQUE("submission_key"),
	CONSTRAINT "marketing_interview_requests_name_nonempty" CHECK (length(btrim("marketing_interview_requests"."name")) > 0),
	CONSTRAINT "marketing_interview_requests_email_nonempty" CHECK (length(btrim("marketing_interview_requests"."email")) > 0),
	CONSTRAINT "marketing_interview_requests_role_valid" CHECK ("marketing_interview_requests"."role" IN ('practice_owner', 'practice_manager', 'administrative_staff', 'provider', 'other')),
	CONSTRAINT "marketing_interview_requests_source_valid" CHECK ("marketing_interview_requests"."source" = 'marketing_homepage'),
	CONSTRAINT "marketing_interview_requests_notice_nonempty" CHECK (length(btrim("marketing_interview_requests"."privacy_notice_version")) > 0),
	CONSTRAINT "marketing_interview_requests_key_v4" CHECK (substring("marketing_interview_requests"."submission_key"::text from 15 for 1) = '4' AND substring("marketing_interview_requests"."submission_key"::text from 20 for 1) IN ('8', '9', 'a', 'b'))
);
--> statement-breakpoint
-- Do not inherit broad table grants from the migration owner's default ACLs.
-- Only this newly created table is affected; existing tenant grants/RLS stay intact.
REVOKE ALL PRIVILEGES ON TABLE "marketing_interview_requests" FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT roles.rolname
    FROM pg_class AS relations
    CROSS JOIN LATERAL aclexplode(relations.relacl) AS grants
    JOIN pg_roles AS roles ON roles.oid = grants.grantee
    WHERE relations.oid = 'public.marketing_interview_requests'::regclass
      AND grants.grantee <> relations.relowner
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.marketing_interview_requests FROM %I', granted_role.rolname);
  END LOOP;
END $$;
--> statement-breakpoint
-- A migration administrator with CREATEROLE provisions the narrowly scoped group.
-- Runtime membership is an explicit operator step; no deployed role name is guessed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careiq_marketing_submitter') THEN
    CREATE ROLE careiq_marketing_submitter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'careiq_marketing_submitter'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'careiq_marketing_submitter')
  ) THEN
    RAISE EXCEPTION 'Existing careiq_marketing_submitter role must be a non-privileged standalone NOLOGIN group';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO careiq_marketing_submitter;
--> statement-breakpoint
-- Drizzle includes DEFAULT columns in INSERT. No contact-data SELECT is granted.
GRANT INSERT ON TABLE "marketing_interview_requests" TO careiq_marketing_submitter;
--> statement-breakpoint
-- PostgreSQL requires SELECT on the named ON CONFLICT target, even without RETURNING.
GRANT SELECT ("submission_key") ON TABLE "marketing_interview_requests" TO careiq_marketing_submitter;
