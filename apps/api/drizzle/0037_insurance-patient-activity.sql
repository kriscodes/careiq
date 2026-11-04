-- Preserve the existing tenant-scoped safe staff projection and include only
-- successful insurance business actions carrying patient/appointment resources.
-- Protected reads, denials, replay/acceptance and audit access remain excluded.
CREATE OR REPLACE FUNCTION audit.activity(patient_filter uuid DEFAULT NULL,appointment_filter uuid DEFAULT NULL,document_filter uuid DEFAULT NULL,result_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,occurred_at timestamptz,action text,entity_type text,entity_id text,outcome text,actor_type text,actor_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id');
BEGIN
 IF result_limit<1 OR result_limit>101 OR l IS NULL OR NOT public.careiq_clinical_scope(p,l) THEN RAISE EXCEPTION 'ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.recorded_at,e.action::text,e.entity_type,e.entity_id,e.outcome,e.actor_type,e.actor_id FROM audit.events e
 WHERE e.practice_id=p AND e.location_id=l AND e.outcome IN ('accepted','succeeded') AND e.action = ANY(ARRAY['patients.create','patients.update','patients.archive','patients.restore','appointments.create','appointments.update','appointments.reschedule','appointments.status','appointments.cancel','requirements.waive','requirements.unwaive','requirements.evidence.select','documents.upload.reserve','documents.upload.complete','documents.review','documents.archive','documents.restore','requests.create','requests.cancel','requests.remind','prepared_documents.create','prepared_documents.update','prepared_documents.prepare','signatures.complete','signatures.decline','work_items.update','appointments.create.details','appointments.update.details','appointments.cancellation','requirements.waiver.granted','requirements.waiver.revoked','requirements.evidence','requirements.reconciliation','documents.review.corrected','documents.review.decided','requests.reminder','signatures.completed','patient_requests.declined','patient_requests.item.fulfilled','prepared-documents.create','prepared-documents.update','prepared-documents.prepare','insurance.case.created','insurance.coverage.revised','insurance.evidence.recorded','insurance.evidence.corrected','insurance.follow_up.revised'])
 AND (patient_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.patient_id=patient_filter))
 AND (appointment_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='appointment' AND r.resource_id=appointment_filter::text))
 AND (document_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='document' AND r.resource_id=document_filter::text))
 AND (before_time IS NULL OR (e.recorded_at,e.id)<(before_time,before_id)) ORDER BY e.recorded_at DESC,e.id DESC LIMIT result_limit;
END $$;
