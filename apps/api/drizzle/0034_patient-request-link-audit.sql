-- Forward-only audit vocabulary correction. Authorization predicates and receipt payloads are unchanged.
-- The verified joined request purpose selects the new v2 link mechanism; historical evidence is never rewritten.
-- Complete transport retries disclose only the original receipt after authenticating the same live session.
CREATE OR REPLACE FUNCTION public.careiq_patient_completion_receipt(token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt jsonb; session_row record; tx uuid; event_uuid uuid;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT s.id,s.practice_id,s.location_id,s.patient_id,s.request_id,r.purpose AS request_purpose INTO session_row FROM public.patient_sessions s
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
 VALUES('location',session_row.practice_id,session_row.location_id,'patient_session',session_row.id::text,'signatures.completion.receipt_access','request',session_row.request_id::text,'succeeded',(receipt->>'operationId')::uuid,tx,jsonb_build_object('verificationMethod',CASE WHEN session_row.request_purpose='form_completion' THEN 'patient_request_link' ELSE 'email_link' END,'assurance','link_possession')) RETURNING id INTO event_uuid;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'request',session_row.request_id::text,'primary',session_row.practice_id,session_row.location_id,session_row.patient_id);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_completion_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_completion_receipt(text) TO careiq_clinical_runtime;

--> statement-breakpoint
-- A completed form returns only its original safe freeze receipt to the same live session.
CREATE OR REPLACE FUNCTION public.careiq_patient_command_receipt(token_hash_value text,request_key_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt jsonb; verified record; event_uuid uuid; tx uuid;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' OR request_key_value IS NULL OR length(request_key_value)>128 THEN RETURN NULL; END IF;
 SELECT s.id AS session_id,s.practice_id,s.location_id,s.patient_id,s.request_id,r.purpose AS request_purpose,k.operation,k.request_hash,k.response INTO verified
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
 VALUES('location',verified.practice_id,verified.location_id,'patient_session',verified.session_id::text,'patient_commands.receipt_access','request',verified.request_id::text,'succeeded',tx,jsonb_build_object('verificationMethod',CASE WHEN verified.request_purpose='form_completion' THEN 'patient_request_link' ELSE 'email_link' END,'assurance','link_possession')) RETURNING id INTO event_uuid;
 INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'request',verified.request_id::text,'primary',verified.practice_id,verified.location_id,verified.patient_id);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_command_receipt(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_command_receipt(text,text) TO careiq_clinical_runtime;
