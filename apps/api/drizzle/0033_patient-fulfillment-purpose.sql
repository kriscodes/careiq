-- Patient collection helpers cannot bypass the dedicated immutable form-completion workflow.
CREATE OR REPLACE FUNCTION public.careiq_patient_fulfill_item(item_id_value uuid,version_id_value uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE access_data jsonb; item_row record; requirement_row record; candidate record; request_row record; event_uuid uuid; valid_candidate boolean; head_review uuid;
BEGIN
 access_data:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 IF access_data IS NULL THEN RAISE EXCEPTION 'PATIENT_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO request_row FROM public.document_requests WHERE id=(access_data->>'request_id')::uuid AND practice_id=(access_data->>'practice_id')::uuid AND location_id=(access_data->>'location_id')::uuid FOR UPDATE;
 IF request_row.state<>'open' OR request_row.expires_at<=now() THEN RAISE EXCEPTION 'PATIENT_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF request_row.purpose NOT IN ('collection','replacement') THEN RAISE EXCEPTION 'PATIENT_REQUEST_PURPOSE_UNSUPPORTED' USING ERRCODE='23514'; END IF;
 SELECT * INTO item_row FROM public.document_request_items WHERE id=item_id_value AND request_id=request_row.id AND patient_id=request_row.patient_id AND practice_id=request_row.practice_id AND location_id=request_row.location_id FOR UPDATE;
 IF NOT FOUND OR (item_row.state<>'open' AND item_row.fulfilled_version_id IS DISTINCT FROM version_id_value) THEN RAISE EXCEPTION 'REQUEST_ITEM_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT v.*,d.document_type_id,d.archived_at,f.status AS file_status INTO candidate FROM public.document_versions v JOIN public.documents d ON d.id=v.document_id AND d.patient_id=v.patient_id AND d.practice_id=v.practice_id AND d.location_id=v.location_id JOIN public.file_objects f ON f.id=v.file_object_id AND f.patient_id=v.patient_id AND f.practice_id=v.practice_id AND f.location_id=v.location_id WHERE v.id=version_id_value AND v.patient_id=request_row.patient_id AND v.practice_id=request_row.practice_id AND v.location_id=request_row.location_id;
 IF NOT FOUND OR candidate.document_type_id<>item_row.document_type_id OR candidate.archived_at IS NOT NULL OR candidate.file_status<>'available' OR (candidate.request_id IS DISTINCT FROM request_row.id AND NOT EXISTS(SELECT 1 FROM public.signature_packets s WHERE s.request_id=request_row.id AND s.state='completed' AND s.output_version_id=version_id_value)) THEN RAISE EXCEPTION 'REQUEST_ITEM_VERSION_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 event_uuid:=audit.record_event(jsonb_build_object('action','patient_requests.item.fulfilled','entityType','request_item','entityId',item_row.id,'actorType','patient_session','metadata',jsonb_build_object('documentVersionId',version_id_value,'requirementId',item_row.requirement_id)),jsonb_build_array(jsonb_build_object('resourceType','request','resourceId',request_row.id,'relationship','primary','patientId',request_row.patient_id),jsonb_build_object('resourceType','document_version','resourceId',version_id_value,'relationship','evidence','patientId',request_row.patient_id)));
 UPDATE public.document_request_items SET fulfilled_version_id=version_id_value,state='fulfilled',is_open=false,revision=revision+1,updated_at=now() WHERE id=item_row.id;
 SELECT r.*,a.scheduled_at INTO requirement_row FROM public.visit_requirements r JOIN public.appointments a ON a.id=r.appointment_id AND a.patient_id=r.patient_id AND a.practice_id=r.practice_id AND a.location_id=r.location_id WHERE r.id=item_row.requirement_id AND r.patient_id=request_row.patient_id AND r.practice_id=request_row.practice_id AND r.location_id=request_row.location_id FOR UPDATE OF r;
 IF requirement_row.lifecycle_state='active' THEN
  valid_candidate:=(requirement_row.required_template_version_id IS NULL OR requirement_row.required_template_version_id=candidate.template_version_id)
   AND (requirement_row.maximum_age_days IS NULL OR COALESCE(candidate.completed_at,candidate.received_at)>=requirement_row.scheduled_at-make_interval(days=>requirement_row.maximum_age_days))
   AND (NOT requirement_row.signature_required OR EXISTS(SELECT 1 FROM public.signature_packets s WHERE s.output_version_id=version_id_value AND s.state='completed'));
  IF valid_candidate THEN
   UPDATE public.work_items SET state='completed',completed_at=now(),completion_reason_code='request_received',revision=revision+1,updated_at=now() WHERE requirement_id=requirement_row.id AND kind IN ('collect','replace') AND state IN ('open','in_progress');
   IF requirement_row.review_required THEN
    INSERT INTO public.work_items(practice_id,location_id,patient_id,appointment_id,requirement_id,kind,due_at) VALUES(request_row.practice_id,request_row.location_id,request_row.patient_id,requirement_row.appointment_id,requirement_row.id,'review',requirement_row.due_at)
    ON CONFLICT(practice_id,location_id,requirement_id,kind) WHERE requirement_id IS NOT NULL AND state IN ('open','in_progress') DO UPDATE SET due_at=EXCLUDED.due_at,revision=work_items.revision+1,updated_at=now();
   ELSE
    UPDATE public.requirement_evidence SET revoked_at=now(),revocation_reason_code='request_received',revision=revision+1,updated_at=now() WHERE requirement_id=requirement_row.id AND revoked_at IS NULL;
    INSERT INTO public.requirement_evidence(practice_id,location_id,patient_id,requirement_id,document_version_id,linked_by_actor_id) VALUES(request_row.practice_id,request_row.location_id,request_row.patient_id,requirement_row.id,version_id_value,access_data->>'session_id');
    UPDATE public.visit_requirements SET revision=revision+1,updated_at=now() WHERE id=requirement_row.id;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',item_row.id,'requestId',request_row.id,'documentVersionId',version_id_value,'state','fulfilled');
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_fulfill_item(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_fulfill_item(uuid,uuid) TO careiq_clinical_runtime;
