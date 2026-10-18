CREATE TABLE "form_change_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"request_id" uuid,
	"proposed_value" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "form_change_candidates_id_scope_key" UNIQUE("id","patient_id","practice_id","location_id"),
	CONSTRAINT "form_change_candidates_source_key" UNIQUE("submission_id","binding_id"),
	CONSTRAINT "form_change_candidates_state_check" CHECK (state IN('pending','accepted','rejected','conflicted') AND revision>0)
);
--> statement-breakpoint
ALTER TABLE "form_change_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_change_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"destination_revision" bigint,
	"decided_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_change_decisions_decision_check" CHECK (decision IN('accepted','rejected') AND length(reason_code) BETWEEN 1 AND 80 AND (destination_revision IS NULL OR destination_revision>0))
);
--> statement-breakpoint
ALTER TABLE "form_change_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"prepared_document_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"request_id" uuid,
	"document_version_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"active_field_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruleset_version" text NOT NULL,
	"schema_hash" text NOT NULL,
	"answers_hash" text NOT NULL,
	"locale" text NOT NULL,
	"submitted_by_actor_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submissions_id_scope_key" UNIQUE("id","patient_id","practice_id","location_id"),
	CONSTRAINT "form_submissions_prepared_key" UNIQUE("prepared_document_id"),
	CONSTRAINT "form_submissions_source_check" CHECK (schema_version IN(1,2) AND jsonb_typeof(answers)='object' AND octet_length(answers::text)<=131072 AND jsonb_typeof(active_field_keys)='array' AND schema_hash ~ '^[0-9a-f]{64}$' AND answers_hash ~ '^[0-9a-f]{64}$' AND locale IN('en','es'))
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "template_field_bindings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"destination" text NOT NULL,
	"review_required" boolean DEFAULT true NOT NULL,
	"normalization_version" text DEFAULT 'careiq-demographics-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_field_bindings_id_practice_key" UNIQUE("id","practice_id"),
	CONSTRAINT "template_field_bindings_field_key" UNIQUE("template_version_id","field_key"),
	CONSTRAINT "template_field_bindings_destination_check" CHECK (destination IN('patient.preferredName','patient.email','patient.phone','patient.dateOfBirth') AND review_required)
);
--> statement-breakpoint
ALTER TABLE "template_field_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "template_publication_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"draft_revision" bigint NOT NULL,
	"schema_hash" text NOT NULL,
	"ruleset_version" text NOT NULL,
	"results" jsonb NOT NULL,
	"checked_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_publication_checks_result_check" CHECK (draft_revision>0 AND schema_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(results)='object')
);
--> statement-breakpoint
ALTER TABLE "template_publication_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "form_schema" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "form_change_candidates" ADD CONSTRAINT "form_change_candidates_submission_fk" FOREIGN KEY ("submission_id","patient_id","practice_id","location_id") REFERENCES "public"."form_submissions"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_change_candidates" ADD CONSTRAINT "form_change_candidates_binding_fk" FOREIGN KEY ("binding_id","practice_id") REFERENCES "public"."template_field_bindings"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_change_candidates" ADD CONSTRAINT "form_change_candidates_request_fk" FOREIGN KEY ("request_id","patient_id","practice_id","location_id") REFERENCES "public"."document_requests"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_change_decisions" ADD CONSTRAINT "form_change_decisions_candidate_fk" FOREIGN KEY ("candidate_id","patient_id","practice_id","location_id") REFERENCES "public"."form_change_candidates"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_prepared_fk" FOREIGN KEY ("prepared_document_id","patient_id","practice_id","location_id") REFERENCES "public"."prepared_documents"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_version_fk" FOREIGN KEY ("template_version_id","practice_id") REFERENCES "public"."template_versions"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_output_fk" FOREIGN KEY ("document_version_id","patient_id","practice_id","location_id") REFERENCES "public"."document_versions"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_request_fk" FOREIGN KEY ("request_id","patient_id","practice_id","location_id") REFERENCES "public"."document_requests"("id","patient_id","practice_id","location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_field_bindings" ADD CONSTRAINT "template_field_bindings_version_fk" FOREIGN KEY ("template_version_id","practice_id") REFERENCES "public"."template_versions"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_publication_checks" ADD CONSTRAINT "template_publication_checks_version_fk" FOREIGN KEY ("template_version_id","practice_id") REFERENCES "public"."template_versions"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_change_candidates_pending_idx" ON "form_change_candidates" USING btree ("practice_id","location_id","patient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "form_submissions_patient_idx" ON "form_submissions" USING btree ("practice_id","location_id","patient_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_form_schema_check" CHECK ((jsonb_typeof(form_schema) = 'object'::text AND octet_length(form_schema::text)<=131072));--> statement-breakpoint
CREATE POLICY "workflow_scope" ON "form_change_candidates" AS PERMISSIVE FOR ALL TO public USING (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')) WITH CHECK (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id'));--> statement-breakpoint
CREATE POLICY "workflow_scope" ON "form_change_decisions" AS PERMISSIVE FOR ALL TO public USING (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')) WITH CHECK (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id'));--> statement-breakpoint
CREATE POLICY "workflow_scope" ON "form_submissions" AS PERMISSIVE FOR ALL TO public USING (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id')) WITH CHECK (careiq_clinical_scope(practice_id,location_id) AND location_id=careiq_context_uuid('app.location_id'));--> statement-breakpoint
CREATE POLICY "workflow_scope" ON "template_field_bindings" AS PERMISSIVE FOR ALL TO public USING (careiq_workflow_practice_scope(practice_id)) WITH CHECK (careiq_workflow_practice_scope(practice_id));--> statement-breakpoint
CREATE POLICY "workflow_scope" ON "template_publication_checks" AS PERMISSIVE FOR ALL TO public USING (careiq_workflow_practice_scope(practice_id)) WITH CHECK (careiq_workflow_practice_scope(practice_id));
--> statement-breakpoint
-- The generator only enables RLS. Runtime isolation also requires FORCE and least-privilege grants.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['form_submissions','template_publication_checks','template_field_bindings','form_change_candidates','form_change_decisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO careiq_clinical_runtime',t);
  EXECUTE format('CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['form_submissions','template_publication_checks','template_field_bindings','form_change_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER workflow_fact_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.careiq_reject_immutable()',t);
 END LOOP;
END $$;
GRANT UPDATE ON public.form_change_candidates TO careiq_clinical_runtime;

--> statement-breakpoint
CREATE FUNCTION public.careiq_form_candidate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'pending' OR (to_jsonb(OLD)-ARRAY['state','revision','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','revision','updated_at']) OR NEW.state NOT IN('accepted','rejected','conflicted') THEN RAISE EXCEPTION 'FORM_CHANGE_SOURCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_form_candidate_immutable BEFORE UPDATE OR DELETE ON public.form_change_candidates FOR EACH ROW EXECUTE FUNCTION public.careiq_form_candidate_guard();
CREATE FUNCTION public.careiq_prepared_frozen_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state='ready' THEN RAISE EXCEPTION 'FROZEN_PREPARED_DOCUMENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_prepared_frozen BEFORE UPDATE OR DELETE ON public.prepared_documents FOR EACH ROW EXECUTE FUNCTION public.careiq_prepared_frozen_guard();

--> statement-breakpoint
-- Scope agreement is a DB invariant even when privileged maintenance bypasses application validation.
CREATE FUNCTION public.careiq_form_submission_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.prepared_documents p JOIN public.template_versions t ON t.id=p.template_version_id AND t.practice_id=p.practice_id JOIN public.document_versions v ON v.id=NEW.document_version_id AND v.patient_id=p.patient_id AND v.practice_id=p.practice_id AND v.location_id=p.location_id WHERE p.id=NEW.prepared_document_id AND p.patient_id=NEW.patient_id AND p.practice_id=NEW.practice_id AND p.location_id=NEW.location_id AND p.template_version_id=NEW.template_version_id AND t.schema_version=NEW.schema_version AND t.content_hash=NEW.schema_hash AND v.template_version_id=t.id AND v.structured_answers=NEW.answers AND v.answers_schema_version=NEW.schema_version AND (NEW.request_id IS NULL OR v.request_id=NEW.request_id)) THEN RAISE EXCEPTION 'FORM_SUBMISSION_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_form_submission_guard() FROM PUBLIC;
CREATE TRIGGER workflow_form_submission_scope BEFORE INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.careiq_form_submission_guard();
CREATE FUNCTION public.careiq_form_binding_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.template_versions v WHERE v.id=NEW.template_version_id AND v.practice_id=NEW.practice_id AND v.state='draft' AND v.schema_version=2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.form_schema->'bindings') b WHERE b->>'fieldKey'=NEW.field_key AND b->>'destination'=NEW.destination AND b->>'reviewRequired'='true')) THEN RAISE EXCEPTION 'FORM_BINDING_NOT_AUTHORED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_form_binding_guard() FROM PUBLIC;
CREATE TRIGGER workflow_form_binding_scope BEFORE INSERT ON public.template_field_bindings FOR EACH ROW EXECUTE FUNCTION public.careiq_form_binding_guard();
CREATE FUNCTION public.careiq_form_candidate_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.form_submissions s JOIN public.template_field_bindings b ON b.id=NEW.binding_id AND b.template_version_id=s.template_version_id AND b.practice_id=s.practice_id WHERE s.id=NEW.submission_id AND s.patient_id=NEW.patient_id AND s.practice_id=NEW.practice_id AND s.location_id=NEW.location_id AND s.request_id IS NOT DISTINCT FROM NEW.request_id AND s.answers ? b.field_key AND s.answers->b.field_key IS NOT DISTINCT FROM NEW.proposed_value) THEN RAISE EXCEPTION 'FORM_CANDIDATE_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_form_candidate_source_guard() FROM PUBLIC;
CREATE TRIGGER workflow_form_candidate_source BEFORE INSERT ON public.form_change_candidates FOR EACH ROW EXECUTE FUNCTION public.careiq_form_candidate_source_guard();
