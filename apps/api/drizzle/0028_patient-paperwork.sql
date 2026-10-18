-- Patient-completed forms, explicit portal binding, exact-copy library and notification intents.
-- No delivery provider is activated by this migration.
ALTER TABLE public.document_requests DROP CONSTRAINT document_requests_purpose_check;
ALTER TABLE public.document_requests ADD CONSTRAINT document_requests_purpose_check CHECK(purpose IN ('collection','signature','replacement','form_completion'));
ALTER TABLE public.document_requests ADD COLUMN form_completion_policy text;
ALTER TABLE public.document_requests ADD CONSTRAINT document_requests_form_policy_check CHECK((purpose='form_completion' AND form_completion_policy IS NOT NULL AND form_completion_policy IN ('form_only','form_then_sign')) OR (purpose<>'form_completion' AND form_completion_policy IS NULL));
ALTER TABLE public.document_request_items ALTER COLUMN requirement_id DROP NOT NULL;
ALTER TABLE public.document_request_items ADD COLUMN prepared_document_id uuid;
ALTER TABLE public.document_request_items ADD CONSTRAINT request_item_prepared_scope_fk FOREIGN KEY(prepared_document_id,patient_id,practice_id,location_id) REFERENCES public.prepared_documents(id,patient_id,practice_id,location_id);
CREATE UNIQUE INDEX request_item_prepared_unique ON public.document_request_items(prepared_document_id) WHERE prepared_document_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.careiq_form_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record; p record;
BEGIN
 IF TG_TABLE_NAME='document_requests' THEN
  IF TG_OP='UPDATE' AND (OLD.purpose,OLD.form_completion_policy,OLD.patient_id,OLD.practice_id,OLD.location_id) IS DISTINCT FROM (NEW.purpose,NEW.form_completion_policy,NEW.patient_id,NEW.practice_id,NEW.location_id) THEN RAISE EXCEPTION 'REQUEST_POLICY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO r FROM public.document_requests WHERE id=NEW.request_id;
  IF NEW.requirement_id IS NULL AND r.purpose<>'form_completion' OR r.purpose='form_completion' AND NEW.prepared_document_id IS NULL OR r.purpose<>'form_completion' AND NEW.prepared_document_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_FORM_REQUEST_ITEM' USING ERRCODE='23514'; END IF;
  IF NEW.prepared_document_id IS NOT NULL THEN
   SELECT * INTO p FROM public.prepared_documents WHERE id=NEW.prepared_document_id AND patient_id=NEW.patient_id AND practice_id=NEW.practice_id AND location_id=NEW.location_id;
   IF NOT FOUND OR p.requirement_id IS DISTINCT FROM NEW.requirement_id THEN RAISE EXCEPTION 'INVALID_FORM_REQUEST_DRAFT' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM public.document_request_items i WHERE i.request_id=NEW.request_id AND i.id<>NEW.id) THEN RAISE EXCEPTION 'SINGLE_FORM_REQUEST_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.request_id,OLD.prepared_document_id,OLD.requirement_id,OLD.patient_id,OLD.practice_id,OLD.location_id) IS DISTINCT FROM (NEW.request_id,NEW.prepared_document_id,NEW.requirement_id,NEW.patient_id,NEW.practice_id,NEW.location_id) THEN RAISE EXCEPTION 'REQUEST_ITEM_BINDING_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_form_request_guard BEFORE UPDATE ON public.document_requests FOR EACH ROW EXECUTE FUNCTION public.careiq_form_request_guard();
CREATE TRIGGER workflow_form_request_item_guard BEFORE INSERT OR UPDATE ON public.document_request_items FOR EACH ROW EXECUTE FUNCTION public.careiq_form_request_guard();
--> statement-breakpoint
CREATE TABLE public.patient_portal_grants (
 id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL, location_id uuid NOT NULL, patient_id uuid NOT NULL,
 clerk_user_id text NOT NULL CHECK(clerk_user_id ~ '^user_[A-Za-z0-9]+$'), relationship text NOT NULL DEFAULT 'self' CHECK(relationship='self'),
 verification_method text NOT NULL CHECK(verification_method='staff_in_person'), verification_reference text NOT NULL CHECK(length(btrim(verification_reference)) BETWEEN 1 AND 500), verified_by_actor_id text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(),
 verified_email text CHECK(verified_email IS NULL OR (length(verified_email)<=254 AND verified_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
 email_verified_at timestamptz, paperwork_email_enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, revocation_reason_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK((verified_email IS NULL)=(email_verified_at IS NULL)), CHECK(NOT paperwork_email_enabled OR verified_email IS NOT NULL), CHECK(expires_at>verified_at),
 UNIQUE(id,patient_id,practice_id,location_id),
 FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id),FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id)
);
CREATE UNIQUE INDEX patient_portal_live_subject_unique ON public.patient_portal_grants(practice_id,location_id,patient_id,clerk_user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX patient_portal_live_patient_unique ON public.patient_portal_grants(practice_id,location_id,patient_id) WHERE revoked_at IS NULL;
CREATE INDEX patient_portal_subject_idx ON public.patient_portal_grants(clerk_user_id,expires_at) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE public.paperwork_library_items (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,request_id uuid NOT NULL,
 document_version_id uuid NOT NULL,document_id uuid NOT NULL,file_object_id uuid NOT NULL,content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 title text NOT NULL,version_number integer NOT NULL CHECK(version_number>0),signed boolean NOT NULL,
 release_state text NOT NULL DEFAULT 'released' CHECK(release_state IN ('released','restricted','voided','superseded')),release_reason_code text,
 completed_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(document_version_id),UNIQUE(id,patient_id,practice_id,location_id),
 FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id),
 FOREIGN KEY(document_version_id,document_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,document_id,patient_id,practice_id,location_id),
 FOREIGN KEY(file_object_id,patient_id,practice_id,location_id) REFERENCES public.file_objects(id,patient_id,practice_id,location_id)
);
CREATE INDEX paperwork_library_patient_idx ON public.paperwork_library_items(practice_id,location_id,patient_id,completed_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE public.paperwork_notifications (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,request_id uuid NOT NULL,library_item_id uuid NOT NULL,
 recipient_grant_id uuid,document_version_id uuid NOT NULL,channel text NOT NULL DEFAULT 'email' CHECK(channel='email'),
 state text NOT NULL CHECK(state IN ('pending','needs_attention','suppressed','accepted','delivered','unknown')),failure_code text,
 provider_id text NOT NULL DEFAULT 'unconfigured' CHECK(provider_id='unconfigured'),dedupe_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(library_item_id),UNIQUE(id,patient_id,practice_id,location_id),
 FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id),
 FOREIGN KEY(library_item_id,patient_id,practice_id,location_id) REFERENCES public.paperwork_library_items(id,patient_id,practice_id,location_id),
 FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id),
 FOREIGN KEY(recipient_grant_id,patient_id,practice_id,location_id) REFERENCES public.patient_portal_grants(id,patient_id,practice_id,location_id),
 CHECK(state NOT IN ('accepted','delivered','unknown'))
);
--> statement-breakpoint
CREATE FUNCTION public.careiq_paperwork_fact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_PAPERWORK_FACT' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='paperwork_library_items' THEN
  IF (NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.request_id,NEW.document_version_id,NEW.document_id,NEW.file_object_id,NEW.content_hash,NEW.title,NEW.version_number,NEW.signed,NEW.completed_at) IS DISTINCT FROM (OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.request_id,OLD.document_version_id,OLD.document_id,OLD.file_object_id,OLD.content_hash,OLD.title,OLD.version_number,OLD.signed,OLD.completed_at) THEN RAISE EXCEPTION 'EXACT_PAPERWORK_COPY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW.release_state<>OLD.release_state AND NULLIF(btrim(NEW.release_reason_code),'') IS NULL THEN RAISE EXCEPTION 'RELEASE_REASON_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='patient_portal_grants' THEN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'PORTAL_GRANT_REVOCATION_FINAL' USING ERRCODE='23514'; END IF;
  IF NEW.revoked_at IS NOT NULL AND NULLIF(btrim(NEW.revocation_reason_code),'') IS NULL THEN RAISE EXCEPTION 'PORTAL_REVOCATION_REASON_REQUIRED' USING ERRCODE='23514'; END IF;
  IF (NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.clerk_user_id,NEW.relationship,NEW.verification_method,NEW.verification_reference,NEW.verified_by_actor_id,NEW.verified_at,NEW.expires_at,NEW.verified_email,NEW.email_verified_at) IS DISTINCT FROM (OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.clerk_user_id,OLD.relationship,OLD.verification_method,OLD.verification_reference,OLD.verified_by_actor_id,OLD.verified_at,OLD.expires_at,OLD.verified_email,OLD.email_verified_at) THEN RAISE EXCEPTION 'VERIFIED_PORTAL_BINDING_IMMUTABLE' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.request_id,NEW.library_item_id,NEW.document_version_id,NEW.dedupe_key) IS DISTINCT FROM (OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.request_id,OLD.library_item_id,OLD.document_version_id,OLD.dedupe_key) THEN RAISE EXCEPTION 'NOTIFICATION_TARGET_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['patient_portal_grants','paperwork_library_items','paperwork_notifications'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY workflow_scope ON public.%I USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id'')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id''))',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO careiq_clinical_runtime',t);
 EXECUTE format('CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation()',t);
 EXECUTE format('CREATE TRIGGER workflow_paperwork_fact_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.careiq_paperwork_fact_guard()',t);
END LOOP;END $$;
REVOKE INSERT ON public.paperwork_library_items,public.paperwork_notifications FROM careiq_clinical_runtime;
--> statement-breakpoint
-- Exact draft authority; a null prepared/round is never treated as a wildcard.
CREATE FUNCTION public.careiq_patient_form_scope(prepared_id_value uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a jsonb; BEGIN
 a:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 RETURN a IS NOT NULL AND EXISTS(SELECT 1 FROM public.document_request_items i JOIN public.document_requests r ON r.id=i.request_id AND r.patient_id=i.patient_id AND r.practice_id=i.practice_id AND r.location_id=i.location_id WHERE i.prepared_document_id=prepared_id_value AND i.request_id=(a->>'request_id')::uuid AND i.patient_id=(a->>'patient_id')::uuid AND i.practice_id=(a->>'practice_id')::uuid AND i.location_id=(a->>'location_id')::uuid AND r.purpose='form_completion');
END $$;
REVOKE ALL ON FUNCTION public.careiq_patient_form_scope(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.careiq_patient_form_scope(uuid) TO careiq_clinical_runtime;
CREATE POLICY patient_form_scope ON public.prepared_documents USING(public.careiq_patient_form_scope(id)) WITH CHECK(public.careiq_patient_form_scope(id));
CREATE POLICY patient_form_version_read ON public.template_versions FOR SELECT USING(EXISTS(SELECT 1 FROM public.prepared_documents p WHERE p.template_version_id=template_versions.id AND p.practice_id=template_versions.practice_id AND public.careiq_patient_form_scope(p.id)));
CREATE POLICY patient_form_template_read ON public.document_templates FOR SELECT USING(EXISTS(SELECT 1 FROM public.template_versions v JOIN public.prepared_documents p ON p.template_version_id=v.id AND p.practice_id=v.practice_id WHERE v.template_id=document_templates.id AND v.practice_id=document_templates.practice_id AND public.careiq_patient_form_scope(p.id)));
CREATE POLICY patient_form_binding_read ON public.template_field_bindings FOR SELECT USING(EXISTS(SELECT 1 FROM public.prepared_documents p WHERE p.template_version_id=template_field_bindings.template_version_id AND p.practice_id=template_field_bindings.practice_id AND public.careiq_patient_form_scope(p.id)));
CREATE POLICY patient_form_submission_scope ON public.form_submissions USING(public.careiq_patient_form_scope(prepared_document_id) AND public.careiq_patient_scope('document_requests',jsonb_build_object('id',request_id,'practice_id',practice_id,'location_id',location_id,'patient_id',patient_id))) WITH CHECK(public.careiq_patient_form_scope(prepared_document_id) AND public.careiq_patient_scope('document_requests',jsonb_build_object('id',request_id,'practice_id',practice_id,'location_id',location_id,'patient_id',patient_id)));
CREATE POLICY patient_form_candidate_insert ON public.form_change_candidates FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM public.form_submissions s WHERE s.id=form_change_candidates.submission_id AND s.patient_id=form_change_candidates.patient_id AND s.practice_id=form_change_candidates.practice_id AND s.location_id=form_change_candidates.location_id AND public.careiq_patient_form_scope(s.prepared_document_id)));
--> statement-breakpoint
-- The publication helper is the only patient mutation path to the library/notification tables.
CREATE FUNCTION public.careiq_publish_completed_paperwork(request_uuid uuid,version_uuid uuid,is_signed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record;v record;g record;l record;n record;a jsonb;allowed boolean;notify boolean;failure text;notify_state text;event_uuid uuid;
BEGIN
 SELECT * INTO r FROM public.document_requests WHERE id=request_uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPERWORK_REQUEST_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 a:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 allowed:=public.careiq_clinical_scope(r.practice_id,r.location_id) AND r.location_id=public.careiq_context_uuid('app.location_id');
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
--> statement-breakpoint
-- Authenticated subject is set only from verified Clerk authentication, never email or HTTP body.
CREATE FUNCTION public.careiq_portal_paperwork(item_uuid uuid DEFAULT NULL,content_access boolean DEFAULT false,before_completed_at timestamptz DEFAULT NULL,before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE subject text:=NULLIF(current_setting('app.portal_subject',true),'');session_value text:=NULLIF(current_setting('app.portal_session',true),''); result jsonb;entry record;event_uuid uuid;tx uuid;
BEGIN
 IF subject IS NULL OR subject !~ '^user_[A-Za-z0-9]+$' OR session_value IS NULL OR session_value !~ '^sess_[A-Za-z0-9]+$' OR content_access AND item_uuid IS NULL THEN RAISE EXCEPTION 'PORTAL_AUTHENTICATION_REQUIRED' USING ERRCODE='42501';END IF;
 IF (before_completed_at IS NULL)<>(before_id IS NULL) OR content_access AND before_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PAPERWORK_CURSOR' USING ERRCODE='22023';END IF;
 tx:=uuidv7();PERFORM set_config('app.transaction_id',tx::text,true);
 result:='[]'::jsonb;
 FOR entry IN SELECT l.*,f.storage_key,f.detected_media_type,f.original_filename,f.sha256,f.status AS file_status FROM public.paperwork_library_items l JOIN public.file_objects f ON f.id=l.file_object_id AND f.patient_id=l.patient_id AND f.practice_id=l.practice_id AND f.location_id=l.location_id JOIN public.practices pr ON pr.id=l.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=l.location_id AND loc.practice_id=l.practice_id AND loc.status='active' WHERE l.release_state<>'restricted' AND (item_uuid IS NULL OR l.id=item_uuid) AND (before_completed_at IS NULL OR (l.completed_at,l.id)<(before_completed_at,before_id)) AND EXISTS(SELECT 1 FROM public.patients pt WHERE pt.id=l.patient_id AND pt.practice_id=l.practice_id AND pt.location_id=l.location_id AND pt.archived_at IS NULL AND pt.date_of_birth IS NOT NULL AND pt.date_of_birth<=current_date-interval '18 years') AND EXISTS(SELECT 1 FROM public.patient_portal_grants g WHERE g.clerk_user_id=subject AND g.patient_id=l.patient_id AND g.practice_id=l.practice_id AND g.location_id=l.location_id AND g.relationship='self' AND g.revoked_at IS NULL AND g.expires_at>now()) ORDER BY l.completed_at DESC,l.id DESC LIMIT 101 LOOP
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
CREATE FUNCTION public.careiq_form_completion_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NEW.purpose='form_completion' AND NEW.state='completed' AND OLD.state<>'completed' THEN
  IF NOT EXISTS(SELECT 1 FROM public.document_request_items i JOIN public.paperwork_library_items l ON l.document_version_id=i.fulfilled_version_id AND l.request_id=i.request_id AND l.patient_id=i.patient_id AND l.practice_id=i.practice_id AND l.location_id=i.location_id WHERE i.request_id=NEW.id AND i.state='fulfilled' AND l.signed=(NEW.form_completion_policy='form_then_sign')) OR EXISTS(SELECT 1 FROM public.document_request_items i WHERE i.request_id=NEW.id AND i.state<>'fulfilled') THEN RAISE EXCEPTION 'FORM_COMPLETION_NOT_DURABLE' USING ERRCODE='23514';END IF;
  IF NEW.form_completion_policy='form_then_sign' AND NOT EXISTS(SELECT 1 FROM public.signature_packets p WHERE p.request_id=NEW.id AND p.state='completed' AND p.output_version_id IS NOT NULL AND p.evidence_object_id IS NOT NULL) THEN RAISE EXCEPTION 'REQUIRED_SIGNATURE_INCOMPLETE' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_form_completion_guard BEFORE UPDATE ON public.document_requests FOR EACH ROW EXECUTE FUNCTION public.careiq_form_completion_guard();
