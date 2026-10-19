CREATE TABLE "insurance_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"payer_name" text NOT NULL,
	"member_id" text,
	"assignee_user_id" text,
	"due_at" timestamp with time zone,
	"state" text DEFAULT 'unverified' NOT NULL,
	"current_evidence_id" uuid,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_cases_id_scope_key" UNIQUE("id","practice_id","location_id"),
	CONSTRAINT "insurance_cases_patient_appointment_scope_key" UNIQUE("id","patient_id","appointment_id","practice_id","location_id"),
	CONSTRAINT "insurance_cases_appointment_key" UNIQUE("appointment_id","practice_id","location_id"),
	CONSTRAINT "insurance_cases_payer_check" CHECK (length(btrim("insurance_cases"."payer_name")) BETWEEN 1 AND 120),
	CONSTRAINT "insurance_cases_member_check" CHECK ("insurance_cases"."member_id" IS NULL OR length(btrim("insurance_cases"."member_id")) BETWEEN 1 AND 120),
	CONSTRAINT "insurance_cases_state_check" CHECK ("insurance_cases"."state" IN ('unverified','active','inactive','needs_follow_up')),
	CONSTRAINT "insurance_cases_revision_check" CHECK ("insurance_cases"."revision">0),
	CONSTRAINT "insurance_cases_evidence_state_check" CHECK (("insurance_cases"."current_evidence_id" IS NULL AND "insurance_cases"."state"='unverified') OR ("insurance_cases"."current_evidence_id" IS NOT NULL AND "insurance_cases"."state"<>'unverified'))
);
--> statement-breakpoint
CREATE TABLE "insurance_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"payer_name_snapshot" text NOT NULL,
	"member_id_snapshot" text,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reference" text NOT NULL,
	"outcome" text NOT NULL,
	"copay_cents" integer,
	"deductible_remaining_cents" integer,
	"coinsurance_percent" integer,
	"reason_code" text NOT NULL,
	"supersedes_evidence_id" uuid,
	"created_by_actor_id" text NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_evidence_id_case_scope_key" UNIQUE("id","case_id","practice_id","location_id"),
	CONSTRAINT "insurance_evidence_supersedes_key" UNIQUE("supersedes_evidence_id"),
	CONSTRAINT "insurance_evidence_payer_snapshot_check" CHECK (length(btrim("insurance_evidence"."payer_name_snapshot")) BETWEEN 1 AND 120),
	CONSTRAINT "insurance_evidence_member_snapshot_check" CHECK ("insurance_evidence"."member_id_snapshot" IS NULL OR length(btrim("insurance_evidence"."member_id_snapshot")) BETWEEN 1 AND 120),
	CONSTRAINT "insurance_evidence_source_check" CHECK ("insurance_evidence"."source" IN ('payer_portal','phone','document')),
	CONSTRAINT "insurance_evidence_outcome_check" CHECK ("insurance_evidence"."outcome" IN ('active','inactive','needs_follow_up')),
	CONSTRAINT "insurance_evidence_reference_check" CHECK (length(btrim("insurance_evidence"."reference")) BETWEEN 1 AND 200),
	CONSTRAINT "insurance_evidence_reason_check" CHECK (("insurance_evidence"."reason_code"='correction' AND "insurance_evidence"."supersedes_evidence_id" IS NOT NULL) OR ("insurance_evidence"."reason_code"='manual_verification' AND "insurance_evidence"."supersedes_evidence_id" IS NULL)),
	CONSTRAINT "insurance_evidence_copay_check" CHECK ("insurance_evidence"."copay_cents" IS NULL OR "insurance_evidence"."copay_cents" BETWEEN 0 AND 100000000),
	CONSTRAINT "insurance_evidence_deductible_check" CHECK ("insurance_evidence"."deductible_remaining_cents" IS NULL OR "insurance_evidence"."deductible_remaining_cents" BETWEEN 0 AND 100000000),
	CONSTRAINT "insurance_evidence_coinsurance_check" CHECK ("insurance_evidence"."coinsurance_percent" IS NULL OR "insurance_evidence"."coinsurance_percent" BETWEEN 0 AND 100),
	CONSTRAINT "insurance_evidence_observed_check" CHECK ("insurance_evidence"."observed_at"<="insurance_evidence"."created_at"+interval '1 minute')
);
--> statement-breakpoint
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_location_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_appointment_fk" FOREIGN KEY ("appointment_id","patient_id","practice_id","location_id") REFERENCES "public"."appointments"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_assignee_fk" FOREIGN KEY ("practice_id","assignee_user_id") REFERENCES "public"."practice_member_access"("practice_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_current_evidence_fk" FOREIGN KEY ("current_evidence_id","id","practice_id","location_id") REFERENCES "public"."insurance_evidence"("id","case_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_evidence" ADD CONSTRAINT "insurance_evidence_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_evidence" ADD CONSTRAINT "insurance_evidence_case_fk" FOREIGN KEY ("case_id","patient_id","appointment_id","practice_id","location_id") REFERENCES "public"."insurance_cases"("id","patient_id","appointment_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_evidence" ADD CONSTRAINT "insurance_evidence_supersedes_fk" FOREIGN KEY ("supersedes_evidence_id","case_id","practice_id","location_id") REFERENCES "public"."insurance_evidence"("id","case_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insurance_cases_scope_updated_idx" ON "insurance_cases" USING btree ("practice_id","location_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "insurance_cases_follow_up_idx" ON "insurance_cases" USING btree ("practice_id","location_id","assignee_user_id","due_at","id");--> statement-breakpoint
CREATE INDEX "insurance_evidence_history_idx" ON "insurance_evidence" USING btree ("practice_id","location_id","case_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
-- Manual observations are clinical evidence. Only append and safe scoped reads are available.
ALTER TABLE public.insurance_evidence ADD CONSTRAINT insurance_evidence_audit_event_fk FOREIGN KEY(audit_event_id) REFERENCES audit.events(id);
--> statement-breakpoint
ALTER TABLE public.insurance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY insurance_location_scope ON public.insurance_cases USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id'));
REVOKE ALL ON public.insurance_cases FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.insurance_cases TO careiq_clinical_runtime;
--> statement-breakpoint
ALTER TABLE public.insurance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY insurance_location_scope ON public.insurance_evidence USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id'));
REVOKE ALL ON public.insurance_evidence FROM PUBLIC;
GRANT SELECT,INSERT ON public.insurance_evidence TO careiq_clinical_runtime;
--> statement-breakpoint
CREATE FUNCTION public.careiq_insurance_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.appointment_id,NEW.created_by_actor_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.appointment_id,OLD.created_by_actor_id,OLD.created_at) THEN RAISE EXCEPTION 'INSURANCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'INSURANCE_REVISION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.assignee_user_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) THEN
  PERFORM m.user_id FROM public.practice_member_access m JOIN public.location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=NEW.practice_id AND m.user_id=NEW.assignee_user_id AND a.location_id=NEW.location_id AND m.status='active' AND a.active FOR SHARE OF m,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSURANCE_ASSIGNEE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.current_evidence_id IS NOT NULL THEN
  PERFORM id FROM public.insurance_evidence WHERE id=NEW.current_evidence_id AND case_id=NEW.id AND practice_id=NEW.practice_id AND location_id=NEW.location_id AND outcome=NEW.state;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSURANCE_CURRENT_EVIDENCE_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_insurance_case_guard() FROM PUBLIC;
CREATE TRIGGER insurance_case_guard BEFORE INSERT OR UPDATE ON public.insurance_cases FOR EACH ROW EXECUTE FUNCTION public.careiq_insurance_case_guard();
--> statement-breakpoint
CREATE TRIGGER insurance_evidence_immutable BEFORE UPDATE OR DELETE ON public.insurance_evidence FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable();
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.insurance_cases FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.insurance_evidence FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
-- The clinical application cannot select raw audit tables. This deliberately narrow
-- projection exposes only actions and actors, without benefits, references or policy values.
CREATE FUNCTION audit.insurance_activity(case_filter uuid,result_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,occurred_at timestamptz,action text,entity_type text,entity_id text,outcome text,actor_type text,actor_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id');
BEGIN
 IF result_limit<1 OR result_limit>101 OR (before_time IS NULL)<>(before_id IS NULL) OR l IS NULL OR NOT public.careiq_clinical_scope(p,l) OR NOT EXISTS(SELECT 1 FROM public.insurance_cases c WHERE c.id=case_filter AND c.practice_id=p AND c.location_id=l) THEN RAISE EXCEPTION 'INSURANCE_ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.recorded_at,e.action::text,e.entity_type,e.entity_id,e.outcome,e.actor_type,e.actor_id FROM audit.events e WHERE e.practice_id=p AND e.location_id=l AND e.outcome='succeeded' AND e.action=ANY(ARRAY['insurance.case.created','insurance.coverage.revised','insurance.evidence.recorded','insurance.evidence.corrected','insurance.follow_up.revised']) AND EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='insurance_case' AND r.resource_id=case_filter::text AND r.practice_id=p AND r.location_id=l) AND (before_time IS NULL OR (e.recorded_at,e.id)<(before_time,before_id)) ORDER BY e.recorded_at DESC,e.id DESC LIMIT result_limit;
END $$;
REVOKE ALL ON FUNCTION audit.insurance_activity(uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.insurance_activity(uuid,integer,timestamptz,uuid) TO careiq_clinical_runtime;
