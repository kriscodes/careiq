CREATE TABLE "onboarding_drafts" (
	"actor_user_id" text PRIMARY KEY NOT NULL,
	"practice_name" text DEFAULT '' NOT NULL,
	"location_name" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_drafts_actor_check" CHECK (length(btrim("onboarding_drafts"."actor_user_id")) BETWEEN 1 AND 256),
	CONSTRAINT "onboarding_drafts_practice_name_check" CHECK (length("onboarding_drafts"."practice_name") <= 120),
	CONSTRAINT "onboarding_drafts_location_name_check" CHECK (length("onboarding_drafts"."location_name") <= 120),
	CONSTRAINT "onboarding_drafts_time_zone_check" CHECK (length("onboarding_drafts"."time_zone") <= 80),
	CONSTRAINT "onboarding_drafts_address_check" CHECK (length("onboarding_drafts"."address") <= 500),
	CONSTRAINT "onboarding_drafts_step_check" CHECK ("onboarding_drafts"."step" IN (1,2,3))
);
--> statement-breakpoint
-- Nonclinical drafts are scoped to their verified actor, never to a requested practice.
ALTER TABLE onboarding_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_draft_actor ON onboarding_drafts
  USING (actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''))
  WITH CHECK (actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''));
DO $$ DECLARE grantee record; BEGIN
  FOR grantee IN SELECT DISTINCT r.rolname FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE c.oid='onboarding_drafts'::regclass AND a.grantee<>c.relowner LOOP
    EXECUTE format('REVOKE ALL ON onboarding_drafts FROM %I',grantee.rolname);
  END LOOP;
END $$;
REVOKE ALL ON onboarding_drafts FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON onboarding_drafts TO careiq_clinical_runtime;
