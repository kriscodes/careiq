-- Complete transport retries disclose only the original receipt after authenticating the same live session.
CREATE FUNCTION public.careiq_patient_completion_receipt(token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt jsonb; session_row record; tx uuid; event_uuid uuid;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT s.id,s.practice_id,s.location_id,s.patient_id,s.request_id INTO session_row FROM public.patient_sessions s
 JOIN public.patient_access_grants g ON g.id=s.grant_id AND g.request_id=s.request_id AND g.patient_id=s.patient_id AND g.practice_id=s.practice_id AND g.location_id=s.location_id
 JOIN public.document_requests r ON r.id=s.request_id AND r.patient_id=s.patient_id AND r.practice_id=s.practice_id AND r.location_id=s.location_id
 JOIN public.practices p ON p.id=s.practice_id JOIN public.locations l ON l.id=s.location_id AND l.practice_id=s.practice_id
 WHERE s.token_hash=token_hash_value AND s.revoked_at IS NULL AND s.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND r.state='completed' AND p.status='active' AND l.status='active';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('requestId',o.patient_request_id,'operationId',o.id,'documentVersionId',o.result_id,'packetId',o.target_id,'state','completed','commandFingerprint',o.command_fingerprint) INTO receipt
 FROM public.workflow_operations o WHERE o.patient_request_id=session_row.request_id AND o.practice_id=session_row.practice_id AND o.location_id=session_row.location_id AND o.operation_type='signature_completion' AND o.initiating_actor_type='patient_session' AND o.initiating_actor_id=session_row.id::text AND o.state='succeeded';
 IF receipt IS NULL THEN RETURN NULL; END IF;
 tx:=public.careiq_context_uuid('app.transaction_id'); IF tx IS NULL THEN tx:=uuidv7(); PERFORM set_config('app.transaction_id',tx::text,true); END IF;
 INSERT INTO audit.events(scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,entity_id,outcome,operation_id,transaction_id,authorization_context)
 VALUES('location',session_row.practice_id,session_row.location_id,'patient_session',session_row.id::text,'signatures.completion.receipt_access','request',session_row.request_id::text,'succeeded',(receipt->>'operationId')::uuid,tx,'{"verificationMethod":"email_link","assurance":"link_possession"}'::jsonb) RETURNING id INTO event_uuid;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'request',session_row.request_id::text,'primary',session_row.practice_id,session_row.location_id,session_row.patient_id);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_completion_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_completion_receipt(text) TO careiq_clinical_runtime;
--> statement-breakpoint
-- A final request transition removes public row visibility. This narrow command returns the receipt atomically.
CREATE FUNCTION public.careiq_patient_close_request(next_state text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE access_data jsonb; request_row record; result jsonb;
BEGIN
 IF next_state NOT IN ('completed','declined') THEN RAISE EXCEPTION 'INVALID_PATIENT_REQUEST_TRANSITION' USING ERRCODE='23514'; END IF;
 access_data:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 IF access_data IS NULL THEN RAISE EXCEPTION 'PATIENT_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO request_row FROM public.document_requests WHERE id=(access_data->>'request_id')::uuid AND practice_id=(access_data->>'practice_id')::uuid AND location_id=(access_data->>'location_id')::uuid FOR UPDATE;
 IF request_row.state<>'open' OR request_row.expires_at<=now() THEN RAISE EXCEPTION 'PATIENT_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF next_state='completed' AND (EXISTS(SELECT 1 FROM public.document_request_items i WHERE i.request_id=request_row.id AND i.state<>'fulfilled') OR (request_row.purpose='signature' AND NOT EXISTS(SELECT 1 FROM public.signature_packets s WHERE s.request_id=request_row.id AND s.state='completed' AND s.output_version_id IS NOT NULL AND s.evidence_object_id IS NOT NULL))) THEN RAISE EXCEPTION 'PATIENT_REQUEST_INCOMPLETE' USING ERRCODE='23514'; END IF;
 UPDATE public.document_requests SET state=next_state,completed_at=CASE WHEN next_state='completed' THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=request_row.id RETURNING jsonb_build_object('id',id,'state',state,'revision',revision) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_close_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_close_request(text) TO careiq_clinical_runtime;
--> statement-breakpoint
CREATE POLICY patient_scan_run_scope ON public.file_scan_runs USING(
 public.careiq_patient_scope('file_objects',(SELECT to_jsonb(f) FROM public.file_objects f WHERE f.id=file_object_id AND f.patient_id=file_scan_runs.patient_id AND f.practice_id=file_scan_runs.practice_id AND f.location_id=file_scan_runs.location_id))
) WITH CHECK(
 public.careiq_patient_scope('file_objects',(SELECT to_jsonb(f) FROM public.file_objects f WHERE f.id=file_object_id AND f.patient_id=file_scan_runs.patient_id AND f.practice_id=file_scan_runs.practice_id AND f.location_id=file_scan_runs.location_id))
);
CREATE POLICY patient_job_run_scope ON public.job_runs USING(
 public.careiq_patient_scope('workflow_operations',(SELECT to_jsonb(o) FROM public.workflow_operations o WHERE o.id=operation_id AND o.practice_id=job_runs.practice_id AND o.location_id=job_runs.location_id))
) WITH CHECK(
 public.careiq_patient_scope('workflow_operations',(SELECT to_jsonb(o) FROM public.workflow_operations o WHERE o.id=operation_id AND o.practice_id=job_runs.practice_id AND o.location_id=job_runs.location_id))
);
--> statement-breakpoint
-- Preserve the null-equality semantics in schema tools as a named unique constraint.
ALTER TABLE public.requirement_rules ADD CONSTRAINT requirement_rules_precedence_unique UNIQUE USING INDEX requirement_rules_precedence_unique;
-- One accepted signature-completion operation is the permanent business uniqueness boundary.
CREATE UNIQUE INDEX workflow_operations_signature_completion_unique ON public.workflow_operations(practice_id,location_id,patient_request_id) WHERE operation_type='signature_completion' AND state IN ('queued','running','succeeded');
--> statement-breakpoint
CREATE FUNCTION public.careiq_finalized_file_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF OLD.storage_version IS NOT NULL AND (NEW.storage_key,NEW.storage_version,NEW.actual_bytes,NEW.sha256,NEW.detected_media_type) IS DISTINCT FROM (OLD.storage_key,OLD.storage_version,OLD.actual_bytes,OLD.sha256,OLD.detected_media_type) THEN RAISE EXCEPTION 'FINALIZED_FILE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_file_integrity BEFORE UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION public.careiq_finalized_file_guard();

--> statement-breakpoint
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
 IF NULLIF(entry->>'patientId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.patients pt WHERE pt.id=(entry->>'patientId')::uuid AND pt.practice_id=p AND pt.location_id=l) THEN RAISE EXCEPTION 'AUDIT_PATIENT_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,ordinal,entry->>'resourceType',entry->>'resourceId',COALESCE(entry->>'relationship','affected'),p,l,NULLIF(entry->>'patientId','')::uuid); ordinal:=ordinal+1;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(changes) LOOP
 -- Patient names, answers, content, notes and bearer values use changed-only capture.
 IF COALESCE(entry->>'captureMode','changed_only')='value' AND (entry->>'fieldPath')<>ALL(ARRAY['status','state','lifecycleState','revision','scheduledAt','endsAt','providerId','visitTypeId','assigneeUserId','dueAt','priority','decision','active','required','reviewRequired','signatureRequired','waiver']) THEN RAISE EXCEPTION 'AUDIT_VALUE_CAPTURE_DENIED' USING ERRCODE='22023'; END IF;
 INSERT INTO audit.changes(event_id,resource_type,resource_id,field_path,capture_mode,before_value,after_value,protected_reference) VALUES(event_uuid,entry->>'resourceType',entry->>'resourceId',entry->>'fieldPath',COALESCE(entry->>'captureMode','changed_only'),CASE WHEN entry->>'captureMode'='value' THEN entry->'before' END,CASE WHEN entry->>'captureMode'='value' THEN entry->'after' END,entry->>'protectedReference');
 END LOOP;
 PERFORM set_config('app.audit_event_id',event_uuid::text,true); RETURN event_uuid;
END $$;

