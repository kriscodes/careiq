-- Correct patient actor resolution before requiring a staff actor. Keep audit and PHI grants append-only.
CREATE OR REPLACE FUNCTION audit.record_event(payload jsonb,resources jsonb DEFAULT '[]'::jsonb,changes jsonb DEFAULT '[]'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id'); actor text:=NULLIF(current_setting('app.actor_user_id',true),''); event_uuid uuid:=uuidv7(); tx uuid; entry jsonb; ordinal integer:=0; field text; meta jsonb:=COALESCE(payload->'metadata','{}'::jsonb); outcome_value text:=COALESCE(payload->>'outcome','succeeded'); scope_value text; patient_context jsonb;
BEGIN
 IF jsonb_typeof(payload)<>'object' OR octet_length(payload::text)>32768 OR jsonb_typeof(resources)<>'array' OR jsonb_array_length(resources)>501 OR jsonb_typeof(changes)<>'array' OR jsonb_array_length(changes)>100 THEN RAISE EXCEPTION 'INVALID_AUDIT_EVENT' USING ERRCODE='22023'; END IF;
 patient_context:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),current_setting('app.patient_is_session',true)='true');
 IF actor IS NULL AND patient_context IS NULL THEN
  IF outcome_value IN ('accepted','succeeded') OR COALESCE(payload->>'actorType','anonymous')<>'anonymous' THEN RAISE EXCEPTION 'AUDIT_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
  p:=NULL; l:=NULL;
 END IF;
 IF patient_context IS NOT NULL THEN p:=(patient_context->>'practice_id')::uuid; l:=(patient_context->>'location_id')::uuid; actor:=COALESCE(patient_context->>'session_id',patient_context->>'grant_id'); END IF;
 IF outcome_value IN ('accepted','succeeded') AND (patient_context IS NULL AND (p IS NULL OR l IS NULL OR NOT public.careiq_clinical_scope(p,l))) THEN RAISE EXCEPTION 'AUDIT_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 -- Failed/denied commands may retain a verified practice only after scope denial. Do not trust a claimed location.
 IF patient_context IS NULL AND l IS NOT NULL AND (p IS NULL OR NOT public.careiq_clinical_scope(p,l)) THEN l:=NULL; END IF;
 IF patient_context IS NULL AND p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.practices pr JOIN public.practice_member_access m ON m.practice_id=pr.id WHERE pr.id=p AND m.user_id=actor AND m.status='active') THEN p:=NULL; l:=NULL; END IF;
 scope_value:=CASE WHEN p IS NULL THEN 'platform' WHEN l IS NULL THEN 'practice' ELSE 'location' END;
 IF jsonb_typeof(meta)<>'object' OR octet_length(meta::text)>8192 THEN RAISE EXCEPTION 'INVALID_AUDIT_METADATA' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT jsonb_object_keys(meta) LOOP
 IF field<>ALL(ARRAY['count','resourceCount','fromState','toState','reasonCode','policyVersion','revision','previousRevision','attempt','purpose','channel','failureCode','verificationMethod','assurance','byteCount','sourceHash','outputHash','consentHash','templateVersionId','documentVersionId','requirementId','requestId','packetId','observer','result','code','operation','resultState']) THEN RAISE EXCEPTION 'AUDIT_METADATA_FIELD_NOT_ALLOWED' USING ERRCODE='22023'; END IF;
 END LOOP;
 tx:=public.careiq_context_uuid('app.transaction_id'); IF tx IS NULL THEN tx:=uuidv7(); PERFORM set_config('app.transaction_id',tx::text,true); END IF;
 INSERT INTO audit.events(id,scope_kind,practice_id,location_id,actor_type,actor_id,initiating_actor_type,initiating_actor_id,executor_id,channel,action,entity_type,entity_id,outcome,reason_code,request_id,operation_id,workflow_id,causation_event_id,transaction_id,authorization_context,metadata)
 VALUES(event_uuid,scope_value,p,l,CASE WHEN patient_context IS NOT NULL THEN 'patient_session' WHEN actor IS NULL THEN 'anonymous' ELSE COALESCE(payload->>'actorType','user') END,actor,payload->>'initiatingActorType',payload->>'initiatingActorId',payload->>'executorId',COALESCE(payload->>'channel','api'),payload->>'action',payload->>'entityType',payload->>'entityId',outcome_value,payload->>'reasonCode',NULLIF(payload->>'requestId','')::uuid,NULLIF(payload->>'operationId','')::uuid,NULLIF(payload->>'workflowId','')::uuid,NULLIF(payload->>'causationEventId','')::uuid,tx,COALESCE(payload->'authorization','{}'::jsonb),meta);
 FOR entry IN SELECT value FROM jsonb_array_elements(resources) LOOP
 IF p IS NULL OR l IS NULL THEN RAISE EXCEPTION 'UNVERIFIED_AUDIT_RESOURCE_SCOPE' USING ERRCODE='42501'; END IF;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,ordinal,entry->>'resourceType',entry->>'resourceId',COALESCE(entry->>'relationship','affected'),p,l,NULLIF(entry->>'patientId','')::uuid); ordinal:=ordinal+1;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(changes) LOOP
 -- Patient names, answers, content, notes and bearer values use changed-only capture.
 IF COALESCE(entry->>'captureMode','changed_only')='value' AND (entry->>'fieldPath')<>ALL(ARRAY['status','state','lifecycleState','revision','scheduledAt','endsAt','providerId','visitTypeId','assigneeUserId','dueAt','priority','decision','active','required','reviewRequired','signatureRequired','waiver']) THEN RAISE EXCEPTION 'AUDIT_VALUE_CAPTURE_DENIED' USING ERRCODE='22023'; END IF;
 INSERT INTO audit.changes(event_id,resource_type,resource_id,field_path,capture_mode,before_value,after_value,protected_reference) VALUES(event_uuid,entry->>'resourceType',entry->>'resourceId',entry->>'fieldPath',COALESCE(entry->>'captureMode','changed_only'),CASE WHEN entry->>'captureMode'='value' THEN entry->'before' END,CASE WHEN entry->>'captureMode'='value' THEN entry->'after' END,entry->>'protectedReference');
 END LOOP;
 PERFORM set_config('app.audit_event_id',event_uuid::text,true); RETURN event_uuid;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit.activity(patient_filter uuid DEFAULT NULL,appointment_filter uuid DEFAULT NULL,document_filter uuid DEFAULT NULL,result_limit integer DEFAULT 50,before_time timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,occurred_at timestamptz,action text,entity_type text,entity_id text,outcome text,actor_type text,actor_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id');
BEGIN
 IF result_limit<1 OR result_limit>101 OR l IS NULL OR NOT public.careiq_clinical_scope(p,l) THEN RAISE EXCEPTION 'ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.recorded_at,e.action::text,e.entity_type,e.entity_id,e.outcome,e.actor_type,e.actor_id FROM audit.events e
 WHERE e.practice_id=p AND e.location_id=l AND e.outcome IN ('accepted','succeeded') AND e.action = ANY(ARRAY['patients.create','patients.update','patients.archive','patients.restore','appointments.create','appointments.update','appointments.reschedule','appointments.status','appointments.cancel','requirements.waive','requirements.unwaive','requirements.evidence.select','documents.upload.reserve','documents.upload.complete','documents.review','documents.archive','documents.restore','requests.create','requests.cancel','requests.remind','prepared_documents.create','prepared_documents.update','prepared_documents.prepare','signatures.complete','signatures.decline','work_items.update','appointments.create.details','appointments.update.details','appointments.cancellation','requirements.waiver.granted','requirements.waiver.revoked','requirements.evidence','requirements.reconciliation','documents.review.corrected','documents.review.decided','requests.reminder','signatures.completed','patient_requests.declined','prepared-documents.create','prepared-documents.update','prepared-documents.prepare'])
 AND (patient_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.patient_id=patient_filter))
 AND (appointment_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='appointment' AND r.resource_id=appointment_filter::text))
 AND (document_filter IS NULL OR EXISTS(SELECT 1 FROM audit.event_resources r WHERE r.event_id=e.id AND r.resource_type='document' AND r.resource_id=document_filter::text))
 AND (before_time IS NULL OR (e.recorded_at,e.id)<(before_time,before_id)) ORDER BY e.recorded_at DESC,e.id DESC LIMIT result_limit;
END $$;

--> statement-breakpoint
-- PostgreSQL row locks require UPDATE on at least one column. Immutable guards reject any actual change.
GRANT UPDATE(id) ON public.document_versions,public.document_reviews TO careiq_clinical_runtime;
