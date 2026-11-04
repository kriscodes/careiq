ALTER TABLE "insurance_evidence" ADD COLUMN "scheduled_at_snapshot" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insurance_evidence" ADD CONSTRAINT "insurance_evidence_active_benefits_check" CHECK ("insurance_evidence"."outcome"='active' OR ("insurance_evidence"."copay_cents" IS NULL AND "insurance_evidence"."deductible_remaining_cents" IS NULL AND "insurance_evidence"."coinsurance_percent" IS NULL)) NOT VALID;
--> statement-breakpoint
-- Historical evidence is never rewritten. Missing appointment snapshots require recheck.
-- This guard also prevents selecting an observation for a policy that was corrected later.
CREATE OR REPLACE FUNCTION public.careiq_insurance_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.appointment_id,NEW.created_by_actor_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.appointment_id,OLD.created_by_actor_id,OLD.created_at) THEN RAISE EXCEPTION 'INSURANCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'INSURANCE_REVISION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.assignee_user_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) THEN
  PERFORM m.user_id FROM public.practice_member_access m JOIN public.location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=NEW.practice_id AND m.user_id=NEW.assignee_user_id AND a.location_id=NEW.location_id AND m.status='active' AND a.active FOR SHARE OF m,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSURANCE_ASSIGNEE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.current_evidence_id IS NOT NULL THEN
  PERFORM id FROM public.insurance_evidence WHERE id=NEW.current_evidence_id AND case_id=NEW.id AND practice_id=NEW.practice_id AND location_id=NEW.location_id AND outcome=NEW.state AND payer_name_snapshot=NEW.payer_name AND member_id_snapshot IS NOT DISTINCT FROM NEW.member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSURANCE_CURRENT_EVIDENCE_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.careiq_insurance_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_case public.insurance_cases%ROWTYPE; appointment_time timestamptz;
BEGIN
 SELECT * INTO current_case FROM public.insurance_cases c WHERE c.id=NEW.case_id AND c.patient_id=NEW.patient_id AND c.appointment_id=NEW.appointment_id AND c.practice_id=NEW.practice_id AND c.location_id=NEW.location_id FOR SHARE;
 IF NOT FOUND OR NEW.payer_name_snapshot IS DISTINCT FROM current_case.payer_name OR NEW.member_id_snapshot IS DISTINCT FROM current_case.member_id THEN RAISE EXCEPTION 'INSURANCE_EVIDENCE_POLICY_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT scheduled_at INTO appointment_time FROM public.appointments WHERE id=NEW.appointment_id AND patient_id=NEW.patient_id AND practice_id=NEW.practice_id AND location_id=NEW.location_id FOR SHARE;
 IF NOT FOUND OR NEW.scheduled_at_snapshot IS NULL OR NEW.scheduled_at_snapshot IS DISTINCT FROM appointment_time THEN RAISE EXCEPTION 'INSURANCE_EVIDENCE_APPOINTMENT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NEW.supersedes_evidence_id IS NOT NULL AND NEW.supersedes_evidence_id IS DISTINCT FROM current_case.current_evidence_id THEN RAISE EXCEPTION 'INSURANCE_EVIDENCE_NOT_CURRENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_insurance_evidence_guard() FROM PUBLIC;
CREATE TRIGGER insurance_evidence_guard BEFORE INSERT ON public.insurance_evidence FOR EACH ROW EXECUTE FUNCTION public.careiq_insurance_evidence_guard();
