-- One location-calendar eligibility rule for adult self-service access and patient-only signing.
-- The deterministic function is private: runtime callers cannot choose an authority evaluation time.
CREATE FUNCTION public.careiq_adult_self_eligible_at(birth_date date,zone_value text,checked_at timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(birth_date IS NOT NULL AND zone_value IS NOT NULL AND checked_at IS NOT NULL
  AND birth_date<=(checked_at AT TIME ZONE zone_value)::date-interval '18 years'
  AND birth_date>(checked_at AT TIME ZONE zone_value)::date-interval '130 years',false)
$$;
REVOKE ALL ON FUNCTION public.careiq_adult_self_eligible_at(date,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careiq_adult_self_eligible_at(date,text,timestamptz) FROM careiq_clinical_runtime;
--> statement-breakpoint
-- The staff API receives a boolean, never a birthday or a caller-controlled evaluation clock.
CREATE FUNCTION public.careiq_patient_adult_self_eligible(patient_uuid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE practice_uuid uuid:=public.careiq_context_uuid('app.practice_id');location_uuid uuid:=public.careiq_context_uuid('app.location_id');patient_row record;
BEGIN
 IF practice_uuid IS NULL OR location_uuid IS NULL OR NOT COALESCE(public.careiq_clinical_scope(practice_uuid,location_uuid),false) THEN RETURN false;END IF;
 SELECT pt.date_of_birth,pt.archived_at,loc.time_zone INTO patient_row FROM public.patients pt
 JOIN public.practices pr ON pr.id=pt.practice_id AND pr.status='active'
 JOIN public.locations loc ON loc.id=pt.location_id AND loc.practice_id=pt.practice_id AND loc.status='active'
 WHERE pt.id=patient_uuid AND pt.practice_id=practice_uuid AND pt.location_id=location_uuid FOR SHARE OF pt;
 IF NOT FOUND OR patient_row.archived_at IS NOT NULL THEN RETURN false;END IF;
 RETURN public.careiq_adult_self_eligible_at(patient_row.date_of_birth,patient_row.time_zone,clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_adult_self_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_patient_adult_self_eligible(uuid) TO careiq_clinical_runtime;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.careiq_portal_paperwork(item_uuid uuid DEFAULT NULL,content_access boolean DEFAULT false,before_completed_at timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE subject text:=NULLIF(current_setting('app.portal_subject',true),'');session_value text:=NULLIF(current_setting('app.portal_session',true),''); result jsonb;entry record;event_uuid uuid;tx uuid;
BEGIN
 IF subject IS NULL OR subject !~ '^user_[A-Za-z0-9]+$' OR session_value IS NULL OR session_value !~ '^sess_[A-Za-z0-9]+$' OR content_access AND item_uuid IS NULL THEN RAISE EXCEPTION 'PORTAL_AUTHENTICATION_REQUIRED' USING ERRCODE='42501';END IF;
 IF (before_completed_at IS NULL)<>(before_id IS NULL) OR content_access AND before_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PAPERWORK_CURSOR' USING ERRCODE='22023';END IF;
 tx:=uuidv7();PERFORM set_config('app.transaction_id',tx::text,true);
 result:='[]'::jsonb;
 FOR entry IN SELECT l.*,f.storage_key,f.detected_media_type,f.original_filename,f.sha256,f.status AS file_status FROM public.paperwork_library_items l JOIN public.file_objects f ON f.id=l.file_object_id AND f.patient_id=l.patient_id AND f.practice_id=l.practice_id AND f.location_id=l.location_id JOIN public.practices pr ON pr.id=l.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=l.location_id AND loc.practice_id=l.practice_id AND loc.status='active' WHERE l.release_state<>'restricted' AND (NOT content_access OR l.release_state='released') AND (item_uuid IS NULL OR l.id=item_uuid) AND (before_completed_at IS NULL OR (l.completed_at,l.id)<(before_completed_at,before_id)) AND EXISTS(SELECT 1 FROM public.patients pt WHERE pt.id=l.patient_id AND pt.practice_id=l.practice_id AND pt.location_id=l.location_id AND pt.archived_at IS NULL AND public.careiq_adult_self_eligible_at(pt.date_of_birth,loc.time_zone,clock_timestamp())) AND EXISTS(SELECT 1 FROM public.patient_portal_grants g WHERE g.clerk_user_id=subject AND g.patient_id=l.patient_id AND g.practice_id=l.practice_id AND g.location_id=l.location_id AND g.relationship='self' AND g.revoked_at IS NULL AND g.expires_at>now()) ORDER BY l.completed_at DESC,l.id DESC LIMIT 101 LOOP
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
CREATE OR REPLACE FUNCTION public.careiq_form_signer_authorized(request_uuid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record;a jsonb;allowed boolean;patient_row record;
BEGIN
 SELECT req.*,loc.time_zone INTO r FROM public.document_requests req JOIN public.practices pr ON pr.id=req.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=req.location_id AND loc.practice_id=req.practice_id AND loc.status='active'
 WHERE req.id=request_uuid AND req.purpose='form_completion' AND req.form_completion_policy='form_then_sign' AND req.state='open' AND req.expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN false;END IF;
 allowed:=COALESCE(public.careiq_clinical_scope(r.practice_id,r.location_id) AND r.location_id=public.careiq_context_uuid('app.location_id'),false);
 a:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 IF NOT allowed AND (a IS NULL OR (a->>'request_id')::uuid<>r.id OR (a->>'patient_id')::uuid<>r.patient_id OR (a->>'practice_id')::uuid<>r.practice_id OR (a->>'location_id')::uuid<>r.location_id) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.document_request_items i JOIN public.prepared_documents p ON p.id=i.prepared_document_id AND p.patient_id=i.patient_id AND p.practice_id=i.practice_id AND p.location_id=i.location_id JOIN public.template_versions tv ON tv.id=p.template_version_id AND tv.practice_id=p.practice_id WHERE i.request_id=r.id AND i.patient_id=r.patient_id AND i.practice_id=r.practice_id AND i.location_id=r.location_id AND tv.schema_version=2 AND tv.form_schema->>'completionPolicy'='form_then_sign' AND tv.form_schema->'signing'->'roles'=jsonb_build_array(jsonb_build_object('key','patient','label',tv.form_schema->'signing'->'roles'->0->>'label','required',true))) THEN RETURN false;END IF;
 -- The lock is held through the caller's completion transaction; DOB/archive updates cannot race it.
 SELECT pt.date_of_birth,pt.archived_at INTO patient_row FROM public.patients pt WHERE pt.id=r.patient_id AND pt.practice_id=r.practice_id AND pt.location_id=r.location_id FOR SHARE;
 IF NOT FOUND OR patient_row.archived_at IS NOT NULL OR patient_row.date_of_birth IS NULL THEN RETURN false;END IF;
 RETURN public.careiq_adult_self_eligible_at(patient_row.date_of_birth,r.time_zone,clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.careiq_form_signer_authorized(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_form_signer_authorized(uuid) TO careiq_clinical_runtime;
