-- Persist the exact base document version that an upload is allowed to replace.
ALTER TABLE public.upload_sessions ADD COLUMN base_version_id uuid;
ALTER TABLE public.upload_sessions ADD CONSTRAINT upload_sessions_base_version_scope_fk
 FOREIGN KEY(base_version_id,document_id,patient_id,practice_id,location_id)
 REFERENCES public.document_versions(id,document_id,patient_id,practice_id,location_id);
--> statement-breakpoint
-- Terminal requests disclose only their own previously accepted safe command result to the same live session.
CREATE FUNCTION public.careiq_patient_command_receipt(token_hash_value text,request_key_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt jsonb; verified record; event_uuid uuid; tx uuid;
BEGIN
 IF token_hash_value IS NULL OR token_hash_value !~ '^[0-9a-f]{64}$' OR request_key_value IS NULL OR length(request_key_value)>128 THEN RETURN NULL; END IF;
 SELECT s.id AS session_id,s.practice_id,s.location_id,s.patient_id,s.request_id,k.operation,k.request_hash,k.response INTO verified
 FROM public.patient_sessions s JOIN public.patient_access_grants g ON g.id=s.grant_id AND g.request_id=s.request_id AND g.patient_id=s.patient_id AND g.practice_id=s.practice_id AND g.location_id=s.location_id
 JOIN public.document_requests r ON r.id=s.request_id AND r.patient_id=s.patient_id AND r.practice_id=s.practice_id AND r.location_id=s.location_id
 JOIN public.workflow_request_keys k ON k.practice_id=s.practice_id AND k.location_id=s.location_id AND k.actor_user_id=s.id::text AND k.target_id=s.request_id::text
 JOIN public.practices p ON p.id=s.practice_id JOIN public.locations l ON l.id=s.location_id AND l.practice_id=s.practice_id
 WHERE s.token_hash=token_hash_value AND s.revoked_at IS NULL AND s.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND r.state IN ('completed','declined') AND p.status='active' AND l.status='active' AND k.request_key=request_key_value
 AND k.operation IN ('patient_upload.completion','patient_requests.decline');
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
