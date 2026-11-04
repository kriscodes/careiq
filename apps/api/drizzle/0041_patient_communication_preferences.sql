-- Portal preferences use the verified account/grant boundary; they cannot create identity or edit a destination.
CREATE TABLE public.portal_communication_profiles (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,grant_id uuid NOT NULL UNIQUE,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(grant_id,patient_id,practice_id,location_id) REFERENCES public.patient_portal_grants(id,patient_id,practice_id,location_id)
);
CREATE INDEX portal_communication_profile_patient ON public.portal_communication_profiles(practice_id,location_id,patient_id);
ALTER TABLE public.portal_communication_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_communication_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_scope ON public.portal_communication_profiles FOR SELECT USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid('app.location_id'));
REVOKE ALL ON public.portal_communication_profiles FROM PUBLIC;
GRANT SELECT ON public.portal_communication_profiles TO careiq_clinical_runtime;
CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.portal_communication_profiles FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation();
--> statement-breakpoint
CREATE TABLE public.portal_communication_request_keys (
 profile_id uuid NOT NULL REFERENCES public.portal_communication_profiles(id),request_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(profile_id,request_key)
);
ALTER TABLE public.portal_communication_request_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_communication_request_keys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_communication_request_keys FROM PUBLIC,careiq_clinical_runtime;
--> statement-breakpoint
CREATE FUNCTION public.careiq_communication_profile_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.portal_communication_profiles SET revision=revision+1,updated_at=now() WHERE practice_id=NEW.practice_id AND location_id=NEW.location_id AND patient_id=NEW.patient_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.careiq_communication_profile_changed() FROM PUBLIC;
CREATE TRIGGER communication_permission_profile_changed AFTER INSERT ON public.communication_permission_events FOR EACH ROW EXECUTE FUNCTION public.careiq_communication_profile_changed();
CREATE TRIGGER communication_endpoint_profile_changed AFTER INSERT OR UPDATE ON public.communication_endpoints FOR EACH ROW EXECUTE FUNCTION public.careiq_communication_profile_changed();
--> statement-breakpoint
CREATE FUNCTION public.careiq_portal_communication_choices(grant_value uuid DEFAULT NULL,choices_value jsonb DEFAULT NULL,expected_revision bigint DEFAULT NULL,email_account text DEFAULT '',sms_account text DEFAULT '',retry_key uuid DEFAULT NULL,request_fingerprint text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE subject text:=NULLIF(current_setting('app.portal_subject',true),'');session_value text:=NULLIF(current_setting('app.portal_session',true),'');g record;profile record;e record;choice jsonb;purpose_value text;enabled_value boolean;result jsonb:='[]'::jsonb;endpoints jsonb;preferences jsonb;blocked boolean;event_uuid uuid;tx uuid:=uuidv7();seen text[]:='{}';choice_key text;existing_allowed boolean;previous record;
BEGIN
 IF subject IS NULL OR subject !~ '^user_[A-Za-z0-9]+$' OR session_value IS NULL OR session_value !~ '^sess_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'PORTAL_AUTHENTICATION_REQUIRED' USING ERRCODE='42501';END IF;
 IF choices_value IS NOT NULL AND (grant_value IS NULL OR expected_revision IS NULL OR jsonb_typeof(choices_value)<>'array' OR jsonb_array_length(choices_value)>60) THEN RAISE EXCEPTION 'INVALID_COMMUNICATION_CHOICES' USING ERRCODE='22023';END IF;
 PERFORM set_config('app.transaction_id',tx::text,true);
 FOR g IN SELECT pg.*,pr.name AS practice_name,loc.name AS location_name FROM public.patient_portal_grants pg JOIN public.practices pr ON pr.id=pg.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=pg.location_id AND loc.practice_id=pg.practice_id AND loc.status='active' JOIN public.patients pt ON pt.id=pg.patient_id AND pt.practice_id=pg.practice_id AND pt.location_id=pg.location_id WHERE pg.clerk_user_id=subject AND pg.relationship='self' AND pg.revoked_at IS NULL AND pg.expires_at>clock_timestamp() AND pt.archived_at IS NULL AND public.careiq_adult_self_eligible_at(pt.date_of_birth,loc.time_zone,clock_timestamp()) AND (grant_value IS NULL OR pg.id=grant_value) ORDER BY pg.id LIMIT 20 FOR SHARE OF pg,pt LOOP
  INSERT INTO public.portal_communication_profiles(practice_id,location_id,patient_id,grant_id) VALUES(g.practice_id,g.location_id,g.patient_id,g.id) ON CONFLICT(grant_id) DO NOTHING;
  SELECT * INTO profile FROM public.portal_communication_profiles WHERE grant_id=g.id FOR UPDATE;
  IF choices_value IS NOT NULL THEN
   IF retry_key IS NULL OR request_fingerprint IS NULL OR request_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_COMMUNICATION_RETRY' USING ERRCODE='22023';END IF;
   SELECT * INTO previous FROM public.portal_communication_request_keys WHERE profile_id=profile.id AND request_key=retry_key;
   IF FOUND THEN
    IF previous.request_hash<>request_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='23514';END IF;
    RETURN previous.response;
   END IF;
   IF profile.revision<>expected_revision THEN RAISE EXCEPTION 'COMMUNICATION_REVISION_CONFLICT' USING ERRCODE='40001';END IF;
   FOR choice IN SELECT value FROM jsonb_array_elements(choices_value) LOOP
    IF jsonb_typeof(choice)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(choice))<>3 OR NOT(choice ?& ARRAY['endpointId','purpose','allowed']) OR jsonb_typeof(choice->'allowed')<>'boolean' OR jsonb_typeof(choice->'endpointId') IS DISTINCT FROM 'string' OR jsonb_typeof(choice->'purpose') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_COMMUNICATION_CHOICES' USING ERRCODE='22023';END IF;
    purpose_value:=choice->>'purpose';enabled_value:=(choice->>'allowed')::boolean;choice_key:=(choice->>'endpointId')||':'||purpose_value;
    IF purpose_value IS NULL OR purpose_value NOT IN ('request','reminder','paperwork') OR choice_key=ANY(seen) THEN RAISE EXCEPTION 'INVALID_COMMUNICATION_CHOICES' USING ERRCODE='22023';END IF;
    seen:=array_append(seen,choice_key);
    SELECT * INTO e FROM public.communication_endpoints WHERE id=(choice->>'endpointId')::uuid AND patient_id=g.patient_id AND practice_id=g.practice_id AND location_id=g.location_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'COMMUNICATION_ENDPOINT_UNAVAILABLE' USING ERRCODE='42501';END IF;
    SELECT EXISTS(SELECT 1 FROM public.destination_suppressions s WHERE s.channel=e.channel AND s.address_fingerprint=e.address_fingerprint AND s.provider_account=CASE WHEN e.channel='email' THEN email_account ELSE sms_account END AND (s.reason_code<>'OPT_OUT' OR NOT EXISTS(SELECT 1 FROM public.destination_suppression_releases released WHERE released.provider_account=s.provider_account AND released.channel=s.channel AND released.address_fingerprint=s.address_fingerprint AND released.created_at>s.created_at))) INTO blocked;
    IF enabled_value AND blocked THEN RAISE EXCEPTION 'PROVIDER_OPTOUT_ACTIVE' USING ERRCODE='23514';END IF;
    IF enabled_value AND purpose_value='paperwork' AND e.channel='email' AND (NOT g.paperwork_email_enabled OR g.email_verified_at IS NULL OR lower(g.verified_email) IS DISTINCT FROM lower(e.address)) THEN RAISE EXCEPTION 'PAPERWORK_PERMISSION_UNAVAILABLE' USING ERRCODE='23514';END IF;
    SELECT allowed INTO existing_allowed FROM public.communication_permission_events WHERE endpoint_id=e.id AND purpose=purpose_value ORDER BY created_at DESC,id DESC LIMIT 1;
    IF COALESCE(existing_allowed,false) IS DISTINCT FROM enabled_value THEN
     INSERT INTO public.communication_permission_events(practice_id,location_id,patient_id,endpoint_id,purpose,allowed,source,actor_user_id,verification_reference) VALUES(g.practice_id,g.location_id,g.patient_id,e.id,purpose_value,enabled_value,'patient_portal',subject,'authenticated portal preference');
    END IF;
   END LOOP;
   UPDATE public.portal_communication_profiles SET revision=revision+1,updated_at=now() WHERE id=profile.id;
  END IF;
  endpoints:='[]'::jsonb;
  FOR e IN SELECT * FROM public.communication_endpoints WHERE patient_id=g.patient_id AND practice_id=g.practice_id AND location_id=g.location_id AND status='active' ORDER BY channel,id LOOP
   SELECT EXISTS(SELECT 1 FROM public.destination_suppressions s WHERE s.channel=e.channel AND s.address_fingerprint=e.address_fingerprint AND s.provider_account=CASE WHEN e.channel='email' THEN email_account ELSE sms_account END AND (s.reason_code<>'OPT_OUT' OR NOT EXISTS(SELECT 1 FROM public.destination_suppression_releases released WHERE released.provider_account=s.provider_account AND released.channel=s.channel AND released.address_fingerprint=s.address_fingerprint AND released.created_at>s.created_at))) INTO blocked;
   preferences:='{}'::jsonb;
   FOREACH purpose_value IN ARRAY ARRAY['request','reminder','paperwork'] LOOP
    SELECT allowed INTO existing_allowed FROM public.communication_permission_events WHERE endpoint_id=e.id AND purpose=purpose_value ORDER BY created_at DESC,id DESC LIMIT 1;
    preferences:=preferences||jsonb_build_object(purpose_value,COALESCE(existing_allowed,false));
   END LOOP;
   endpoints:=endpoints||jsonb_build_array(jsonb_build_object('id',e.id,'channel',e.channel,'masked',CASE WHEN e.channel='email' THEN left(e.address,1)||'•••@'||split_part(e.address,'@',2) ELSE '••• ••• '||right(e.address,4) END,'suppressed',blocked,'choices',preferences,'paperworkEligible',e.channel='sms' OR (g.paperwork_email_enabled AND g.email_verified_at IS NOT NULL AND lower(g.verified_email)=lower(e.address))));
  END LOOP;
  SELECT * INTO profile FROM public.portal_communication_profiles WHERE grant_id=g.id;
  INSERT INTO audit.events(scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,entity_id,outcome,transaction_id,authorization_context) VALUES('location',g.practice_id,g.location_id,'user',subject,CASE WHEN choices_value IS NULL THEN 'communications.portal.preferences.read' ELSE 'communications.portal.preferences.changed' END,'portal_communication_profile',profile.id::text,'succeeded',tx,jsonb_build_object('verificationMethod','authenticated_account','sessionId',session_value)) RETURNING id INTO event_uuid;
  INSERT INTO audit.event_resources(event_id,ordinal,resource_type,resource_id,relationship,practice_id,location_id,patient_id) VALUES(event_uuid,0,'patient',g.patient_id::text,'primary',g.practice_id,g.location_id,g.patient_id);
  result:=result||jsonb_build_array(jsonb_build_object('grantId',g.id,'revision',profile.revision,'practiceName',g.practice_name,'locationName',g.location_name,'endpoints',endpoints));
  IF choices_value IS NOT NULL THEN INSERT INTO public.portal_communication_request_keys(profile_id,request_key,request_hash,response) VALUES(profile.id,retry_key,request_fingerprint,result);END IF;
 END LOOP;
 IF grant_value IS NOT NULL AND jsonb_array_length(result)=0 THEN RAISE EXCEPTION 'COMMUNICATION_PROFILE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text) TO careiq_clinical_runtime;

--> statement-breakpoint
-- Explicit SMS paperwork permission creates a notice independently of the frozen email-copy choice.
CREATE OR REPLACE FUNCTION public.careiq_publish_completed_paperwork(request_uuid uuid,version_uuid uuid,is_signed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.document_requests%ROWTYPE;v record;g public.patient_portal_grants%ROWTYPE;l public.paperwork_library_items%ROWTYPE;n public.paperwork_notifications%ROWTYPE;a jsonb;allowed boolean;notify boolean;notify_sms boolean;notify_email boolean;failure text;notify_state text;event_uuid uuid;
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
 notify_sms:=EXISTS(SELECT 1 FROM public.communication_endpoints ep WHERE ep.practice_id=r.practice_id AND ep.location_id=r.location_id AND ep.patient_id=r.patient_id AND ep.status='active' AND ep.channel='sms' AND COALESCE((SELECT allowed FROM public.communication_permission_events pe WHERE pe.endpoint_id=ep.id AND pe.purpose='paperwork' ORDER BY pe.created_at DESC,pe.id DESC LIMIT 1),false));
 notify_email:=COALESCE((SELECT (tv.form_schema->'delivery'->>'emailCopy')::boolean FROM public.template_versions tv WHERE tv.id=v.template_version_id),false);
 notify:=notify_email OR notify_sms;
 IF notify THEN
  SELECT pg.* INTO g FROM public.patient_portal_grants pg WHERE pg.practice_id=r.practice_id AND pg.location_id=r.location_id AND pg.patient_id=r.patient_id AND pg.revoked_at IS NULL AND pg.expires_at>now() ORDER BY pg.verified_at DESC,pg.id DESC LIMIT 1;
  IF NOT FOUND THEN failure:='PORTAL_ACCESS_NOT_VERIFIED';notify_state:='needs_attention';
  ELSIF (NOT g.paperwork_email_enabled OR g.verified_email IS NULL OR g.email_verified_at IS NULL) AND NOT notify_sms THEN failure:='EMAIL_PERMISSION_UNAVAILABLE';notify_state:='suppressed';
  ELSE failure:='DELIVERY_PROVIDER_UNAVAILABLE';notify_state:='needs_attention';END IF;
  INSERT INTO public.paperwork_notifications(practice_id,location_id,patient_id,request_id,library_item_id,recipient_grant_id,document_version_id,channel,state,failure_code,dedupe_key) VALUES(r.practice_id,r.location_id,r.patient_id,r.id,l.id,g.id,v.id,CASE WHEN notify_email THEN 'email' ELSE 'sms' END,notify_state,failure,'paperwork-completed:'||l.id::text) ON CONFLICT(library_item_id) DO NOTHING;
  SELECT * INTO n FROM public.paperwork_notifications WHERE library_item_id=l.id;
  INSERT INTO public.outbox_events(practice_id,location_id,patient_request_id,event_type,aggregate_id,aggregate_revision,payload,last_failure_code) SELECT r.practice_id,r.location_id,r.id,'paperwork.notification.requested',n.id,1,jsonb_build_object('notificationId',n.id,'libraryItemId',l.id),n.failure_code WHERE NOT EXISTS(SELECT 1 FROM public.outbox_events o WHERE o.event_type='paperwork.notification.requested' AND o.aggregate_id=n.id);
  IF n.state='needs_attention' THEN INSERT INTO public.work_items(practice_id,location_id,patient_id,appointment_id,request_id,kind,assignee_user_id,due_at) VALUES(r.practice_id,r.location_id,r.patient_id,r.appointment_id,r.id,'delivery_follow_up',r.assignee_user_id,r.due_at) ON CONFLICT(practice_id,location_id,request_id,kind) WHERE kind='delivery_follow_up' AND state IN ('open','in_progress') DO NOTHING;END IF;
 END IF;
 event_uuid:=audit.record_event(jsonb_build_object('action','paperwork.library.published','entityType','paperwork_library_item','entityId',l.id,'metadata',jsonb_build_object('documentVersionId',v.id,'resultState',COALESCE(n.state,'not_requested'))),jsonb_build_array(jsonb_build_object('resourceType','document_version','resourceId',v.id,'patientId',r.patient_id),jsonb_build_object('resourceType','request','resourceId',r.id,'patientId',r.patient_id)));
 RETURN jsonb_build_object('libraryItemId',l.id,'documentVersionId',v.id,'signed',l.signed,'notificationState',COALESCE(n.state,'not_requested'),'failureCode',n.failure_code);
END $$;
