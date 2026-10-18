-- Forward-only repair: nullable notification record and explicit request/scope checks.
CREATE OR REPLACE FUNCTION public.careiq_publish_completed_paperwork(request_uuid uuid,version_uuid uuid,is_signed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.document_requests%ROWTYPE;v record;g public.patient_portal_grants%ROWTYPE;l public.paperwork_library_items%ROWTYPE;n public.paperwork_notifications%ROWTYPE;a jsonb;allowed boolean;notify boolean;failure text;notify_state text;event_uuid uuid;
BEGIN
 SELECT * INTO r FROM public.document_requests WHERE id=request_uuid FOR UPDATE;
 IF NOT FOUND OR r.state NOT IN ('open','completed') THEN RAISE EXCEPTION 'PAPERWORK_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 a:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 allowed:=COALESCE(public.careiq_clinical_scope(r.practice_id,r.location_id) AND r.location_id=public.careiq_context_uuid('app.location_id'),false);
 IF NOT allowed AND (a IS NULL OR (a->>'request_id')::uuid<>r.id OR (a->>'patient_id')::uuid<>r.patient_id OR (a->>'practice_id')::uuid<>r.practice_id OR (a->>'location_id')::uuid<>r.location_id) THEN RAISE EXCEPTION 'PAPERWORK_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT dv.*,d.title,f.storage_key,f.status AS file_status,f.sha256 AS file_hash,f.verified_at FROM public.document_versions dv JOIN public.documents d ON d.id=dv.document_id AND d.patient_id=dv.patient_id AND d.practice_id=dv.practice_id AND d.location_id=dv.location_id JOIN public.file_objects f ON f.id=dv.file_object_id AND f.patient_id=dv.patient_id AND f.practice_id=dv.practice_id AND f.location_id=dv.location_id WHERE dv.id=version_uuid AND dv.patient_id=r.patient_id AND dv.practice_id=r.practice_id AND dv.location_id=r.location_id AND dv.request_id=r.id INTO v;
 IF NOT FOUND OR v.file_status<>'available' OR v.file_hash IS DISTINCT FROM v.content_hash OR v.verified_at IS NULL THEN RAISE EXCEPTION 'PAPERWORK_OUTPUT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 IF is_signed THEN
  IF NOT EXISTS(SELECT 1 FROM public.signature_packets s JOIN public.file_objects f ON f.id=s.evidence_object_id AND f.patient_id=s.patient_id AND f.practice_id=s.practice_id AND f.location_id=s.location_id WHERE s.request_id=r.id AND s.state='completed' AND s.output_version_id=v.id AND f.status='available' AND f.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'REQUIRED_SIGNATURE_INCOMPLETE' USING ERRCODE='23514'; END IF;
 ELSE
  IF r.purpose<>'form_completion' OR r.form_completion_policy<>'form_only' OR NOT EXISTS(SELECT 1 FROM public.document_request_items i JOIN public.prepared_documents p ON p.id=i.prepared_document_id AND p.patient_id=i.patient_id AND p.practice_id=i.practice_id AND p.location_id=i.location_id WHERE i.request_id=r.id AND p.state='ready' AND p.rendered_source_version_id=v.id AND i.fulfilled_version_id=v.id) THEN RAISE EXCEPTION 'FORM_SUBMISSION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO public.paperwork_library_items(practice_id,location_id,patient_id,request_id,document_version_id,document_id,file_object_id,content_hash,title,version_number,signed,completed_at) VALUES(r.practice_id,r.location_id,r.patient_id,r.id,v.id,v.document_id,v.file_object_id,v.content_hash,v.title,v.version_number,is_signed,COALESCE(v.completed_at,now())) ON CONFLICT(document_version_id) DO NOTHING;
 SELECT * INTO l FROM public.paperwork_library_items WHERE document_version_id=v.id;
 notify:=COALESCE((SELECT (tv.form_schema->'delivery'->>'emailCopy')::boolean FROM public.template_versions tv WHERE tv.id=v.template_version_id),false);
 IF notify THEN
  SELECT pg.* INTO g FROM public.patient_portal_grants pg WHERE pg.practice_id=r.practice_id AND pg.location_id=r.location_id AND pg.patient_id=r.patient_id AND pg.revoked_at IS NULL AND pg.expires_at>now() ORDER BY pg.verified_at DESC,pg.id DESC LIMIT 1;
  IF NOT FOUND THEN failure:='PORTAL_ACCESS_NOT_VERIFIED';notify_state:='needs_attention';
  ELSIF NOT g.paperwork_email_enabled OR g.verified_email IS NULL OR g.email_verified_at IS NULL THEN failure:='EMAIL_PERMISSION_UNAVAILABLE';notify_state:='suppressed';
  ELSE failure:='DELIVERY_PROVIDER_UNAVAILABLE';notify_state:='needs_attention';END IF;
  INSERT INTO public.paperwork_notifications(practice_id,location_id,patient_id,request_id,library_item_id,recipient_grant_id,document_version_id,state,failure_code,dedupe_key) VALUES(r.practice_id,r.location_id,r.patient_id,r.id,l.id,g.id,v.id,notify_state,failure,'paperwork-completed:'||l.id::text) ON CONFLICT(library_item_id) DO NOTHING;
  SELECT * INTO n FROM public.paperwork_notifications WHERE library_item_id=l.id;
  INSERT INTO public.outbox_events(practice_id,location_id,patient_request_id,event_type,aggregate_id,aggregate_revision,payload,last_failure_code) SELECT r.practice_id,r.location_id,r.id,'paperwork.notification.requested',n.id,1,jsonb_build_object('notificationId',n.id,'libraryItemId',l.id),n.failure_code WHERE NOT EXISTS(SELECT 1 FROM public.outbox_events o WHERE o.event_type='paperwork.notification.requested' AND o.aggregate_id=n.id);
  IF n.state='needs_attention' THEN INSERT INTO public.work_items(practice_id,location_id,patient_id,appointment_id,request_id,kind,assignee_user_id,due_at) VALUES(r.practice_id,r.location_id,r.patient_id,r.appointment_id,r.id,'delivery_follow_up',r.assignee_user_id,r.due_at) ON CONFLICT(practice_id,location_id,request_id,kind) WHERE kind='delivery_follow_up' AND state IN ('open','in_progress') DO NOTHING;END IF;
 END IF;
 event_uuid:=audit.record_event(jsonb_build_object('action','paperwork.library.published','entityType','paperwork_library_item','entityId',l.id,'metadata',jsonb_build_object('documentVersionId',v.id,'resultState',COALESCE(n.state,'not_requested'))),jsonb_build_array(jsonb_build_object('resourceType','document_version','resourceId',v.id,'patientId',r.patient_id),jsonb_build_object('resourceType','request','resourceId',r.id,'patientId',r.patient_id)));
 RETURN jsonb_build_object('libraryItemId',l.id,'documentVersionId',v.id,'signed',l.signed,'notificationState',COALESCE(n.state,'not_requested'),'failureCode',n.failure_code);
END $$;
REVOKE ALL ON FUNCTION public.careiq_publish_completed_paperwork(uuid,uuid,boolean) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.careiq_publish_completed_paperwork(uuid,uuid,boolean) TO careiq_clinical_runtime;
