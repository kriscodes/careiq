-- A completed form returns only its original safe freeze receipt to the same live session.
CREATE OR REPLACE FUNCTION public.careiq_patient_command_receipt(token_hash_value text,request_key_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt jsonb; verified record; event_uuid uuid; tx uuid;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' OR request_key_value IS NULL OR length(request_key_value)>128 THEN RETURN NULL; END IF;
 SELECT s.id AS session_id,s.practice_id,s.location_id,s.patient_id,s.request_id,k.operation,k.request_hash,k.response INTO verified
 FROM public.patient_sessions s JOIN public.patient_access_grants g ON g.id=s.grant_id AND g.request_id=s.request_id AND g.patient_id=s.patient_id AND g.practice_id=s.practice_id AND g.location_id=s.location_id
 JOIN public.document_requests r ON r.id=s.request_id AND r.patient_id=s.patient_id AND r.practice_id=s.practice_id AND r.location_id=s.location_id
 JOIN public.workflow_request_keys k ON k.practice_id=s.practice_id AND k.location_id=s.location_id AND k.actor_user_id=s.id::text AND k.target_id=s.request_id::text
 JOIN public.practices p ON p.id=s.practice_id JOIN public.locations l ON l.id=s.location_id AND l.practice_id=s.practice_id
 WHERE s.token_hash=token_hash_value AND s.revoked_at IS NULL AND s.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND r.state IN ('completed','declined') AND p.status='active' AND l.status='active' AND k.request_key=request_key_value
 AND k.operation IN ('patient_upload.completion','patient_requests.decline','patient_forms.freeze');
 IF NOT FOUND THEN RETURN NULL; END IF;
 receipt:=jsonb_build_object('sessionId',verified.session_id,'requestId',verified.request_id,'operation',verified.operation,'requestHash',verified.request_hash,'response',verified.response);
 tx:=public.careiq_context_uuid('app.transaction_id'); IF tx IS NULL THEN tx:=uuidv7(); PERFORM set_config('app.transaction_id',tx::text,true); END IF;
 INSERT INTO audit.events(scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,entity_id,outcome,transaction_id,authorization_context)
 VALUES('location',verified.practice_id,verified.location_id,'patient_session',verified.session_id::text,'patient_commands.receipt_access','request',verified.request_id::text,'succeeded',tx,'{"verificationMethod":"email_link","assurance":"link_possession"}'::jsonb) RETURNING id INTO event_uuid;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'request',verified.request_id::text,'primary',verified.practice_id,verified.location_id,verified.patient_id);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_command_receipt(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_command_receipt(text,text) TO careiq_clinical_runtime;

--> statement-breakpoint
-- Keep retained history visible, while current release permission gates every byte transfer.
CREATE OR REPLACE FUNCTION public.careiq_portal_paperwork(item_uuid uuid DEFAULT NULL,content_access boolean DEFAULT false,before_completed_at timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE subject text:=NULLIF(current_setting('app.portal_subject',true),'');session_value text:=NULLIF(current_setting('app.portal_session',true),''); result jsonb;entry record;event_uuid uuid;tx uuid;
BEGIN
 IF subject IS NULL OR subject !~ '^user_[A-Za-z0-9]+$' OR session_value IS NULL OR session_value !~ '^sess_[A-Za-z0-9]+$' OR content_access AND item_uuid IS NULL THEN RAISE EXCEPTION 'PORTAL_AUTHENTICATION_REQUIRED' USING ERRCODE='42501';END IF;
 IF (before_completed_at IS NULL)<>(before_id IS NULL) OR content_access AND before_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PAPERWORK_CURSOR' USING ERRCODE='22023';END IF;
 tx:=uuidv7();PERFORM set_config('app.transaction_id',tx::text,true);
 result:='[]'::jsonb;
 FOR entry IN SELECT l.*,f.storage_key,f.detected_media_type,f.original_filename,f.sha256,f.status AS file_status FROM public.paperwork_library_items l JOIN public.file_objects f ON f.id=l.file_object_id AND f.patient_id=l.patient_id AND f.practice_id=l.practice_id AND f.location_id=l.location_id JOIN public.practices pr ON pr.id=l.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=l.location_id AND loc.practice_id=l.practice_id AND loc.status='active' WHERE l.release_state<>'restricted' AND (NOT content_access OR l.release_state='released') AND (item_uuid IS NULL OR l.id=item_uuid) AND (before_completed_at IS NULL OR (l.completed_at,l.id)<(before_completed_at,before_id)) AND EXISTS(SELECT 1 FROM public.patients pt WHERE pt.id=l.patient_id AND pt.practice_id=l.practice_id AND pt.location_id=l.location_id AND pt.archived_at IS NULL AND pt.date_of_birth IS NOT NULL AND pt.date_of_birth<=current_date-interval '18 years') AND EXISTS(SELECT 1 FROM public.patient_portal_grants g WHERE g.clerk_user_id=subject AND g.patient_id=l.patient_id AND g.practice_id=l.practice_id AND g.location_id=l.location_id AND g.relationship='self' AND g.revoked_at IS NULL AND g.expires_at>now()) ORDER BY l.completed_at DESC,l.id DESC LIMIT 101 LOOP
  INSERT INTO audit.events(scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,entity_id,outcome,transaction_id,authorization_context) VALUES('location',entry.practice_id,entry.location_id,'user',subject,CASE WHEN content_access THEN 'paperwork.portal.copy_access_authorized' ELSE 'paperwork.portal.list_item' END,'paperwork_library_item',entry.id::text,'succeeded',tx,jsonb_build_object('verificationMethod','authenticated_account','assurance','staff_verified_binding','sessionId',session_value)) RETURNING id INTO event_uuid;
  INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'document_version',entry.document_version_id::text,'primary',entry.practice_id,entry.location_id,entry.patient_id);
  result:=result||jsonb_build_array(jsonb_build_object('id',entry.id,'documentVersionId',entry.document_version_id,'title',entry.title,'versionNumber',entry.version_number,'signed',entry.signed,'completedAt',entry.completed_at,'cursorTime',entry.completed_at::text,'releaseState',entry.release_state,'sha256',entry.content_hash)||CASE WHEN content_access THEN jsonb_build_object('storageKey',entry.storage_key,'contentType',entry.detected_media_type,'filename',entry.original_filename,'fileStatus',entry.file_status,'storedHash',entry.sha256) ELSE '{}'::jsonb END);
 END LOOP;
 IF item_uuid IS NULL AND jsonb_array_length(result)=0 THEN INSERT INTO audit.events(scope_kind,actor_type,actor_id,action,entity_type,outcome,transaction_id,authorization_context) VALUES('platform','user',subject,'paperwork.portal.empty_list','paperwork_library','succeeded',tx,jsonb_build_object('verificationMethod','authenticated_account','sessionId',session_value));END IF;
 IF item_uuid IS NOT NULL AND jsonb_array_length(result)=0 THEN RAISE EXCEPTION 'PAPERWORK_COPY_NOT_FOUND' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamptz,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.careiq_portal_paperwork(uuid,boolean,timestamptz,uuid) TO careiq_clinical_runtime;

--> statement-breakpoint
-- After rollback, capture authenticated account denials without a claimed patient/entity scope.
CREATE FUNCTION public.careiq_record_portal_failure(reason_value text,request_value uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE subject text:=NULLIF(current_setting('app.portal_subject',true),'');session_value text:=NULLIF(current_setting('app.portal_session',true),'');event_uuid uuid;tx uuid:=uuidv7();
BEGIN
 IF subject IS NULL OR subject !~ '^user_[A-Za-z0-9]+$' OR session_value IS NULL OR session_value !~ '^sess_[A-Za-z0-9]+$' OR reason_value IS NULL OR reason_value !~ '^[A-Z][A-Z0-9_]{0,79}$' THEN RAISE EXCEPTION 'INVALID_PORTAL_AUDIT_CONTEXT' USING ERRCODE='42501';END IF;
 INSERT INTO audit.events(scope_kind,actor_type,actor_id,action,entity_type,outcome,reason_code,request_id,transaction_id,authorization_context)
 VALUES('platform','user',subject,'paperwork.portal.request.failed','http_request','denied',reason_value,request_value,tx,jsonb_build_object('verificationMethod','authenticated_account','sessionId',session_value)) RETURNING id INTO event_uuid;
 RETURN event_uuid;
END $$;
REVOKE ALL ON FUNCTION public.careiq_record_portal_failure(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_record_portal_failure(text,uuid) TO careiq_clinical_runtime;
