-- Patient delivery is disabled in the application until explicitly configured. Historical attempts remain intact.
ALTER TABLE public.document_requests ADD COLUMN delivery_generation integer NOT NULL DEFAULT 1 CHECK(delivery_generation>0);
--> statement-breakpoint
CREATE TABLE public.communication_endpoints (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','sms')),address text NOT NULL,address_fingerprint text NOT NULL CHECK(address_fingerprint ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','invalid','replaced')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 verified_at timestamptz NOT NULL DEFAULT now(),verification_reference text NOT NULL CHECK(length(btrim(verification_reference)) BETWEEN 1 AND 500),verified_by_actor_id text NOT NULL,
 locale text NOT NULL DEFAULT 'en' CHECK(locale='en'),time_zone text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(id,patient_id,practice_id,location_id),FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES public.patients(id,practice_id,location_id),
 CHECK((channel='email' AND length(address)<=254 AND address ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') OR (channel='sms' AND address ~ '^[+][1-9][0-9]{7,14}$'))
);
CREATE UNIQUE INDEX communication_endpoint_current_channel ON public.communication_endpoints(practice_id,location_id,patient_id,channel) WHERE status='active';
CREATE UNIQUE INDEX communication_endpoint_active_unique ON public.communication_endpoints(practice_id,location_id,patient_id,channel,address_fingerprint) WHERE status='active';
--> statement-breakpoint
CREATE TABLE public.communication_permission_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,endpoint_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('request','reminder','paperwork')),allowed boolean NOT NULL,source text NOT NULL CHECK(source IN ('staff_verified','patient_portal','provider_opt_out')),actor_user_id text NOT NULL,
 verification_reference text NOT NULL CHECK(length(btrim(verification_reference)) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(endpoint_id,patient_id,practice_id,location_id) REFERENCES public.communication_endpoints(id,patient_id,practice_id,location_id)
);
CREATE INDEX communication_permission_latest ON public.communication_permission_events(endpoint_id,purpose,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE public.delivery_intents (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,request_id uuid NOT NULL,
 endpoint_id uuid,endpoint_version integer,request_generation integer NOT NULL,purpose text NOT NULL CHECK(purpose IN ('initial','reminder','reissue','paperwork_ready','paperwork_resend')),
 channel text NOT NULL CHECK(channel IN ('email','sms')),address_fingerprint text,masked_destination text NOT NULL,
 paperwork_notification_id uuid,library_item_id uuid,document_version_id uuid,recipient_grant_id uuid,
 due_at_snapshot timestamptz,template_version text NOT NULL DEFAULT 'en-v1',logical_key text NOT NULL UNIQUE,automatic boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','scheduled','submitting','accepted','delivered','retry_waiting','failed','unknown','suppressed','cancelled')),
 failure_code text,scheduled_at timestamptz NOT NULL DEFAULT now(),not_after timestamptz NOT NULL,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 lease_token uuid,lease_expires_at timestamptz,provider_id text,provider_account text,provider_message_id text,external_key text NOT NULL UNIQUE,sealed_request_link text,
 next_reconciliation_at timestamptz,reconciliation_count integer NOT NULL DEFAULT 0 CHECK(reconciliation_count BETWEEN 0 AND 5),created_by_actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(id,patient_id,practice_id,location_id),
 FOREIGN KEY(request_id,patient_id,practice_id,location_id) REFERENCES public.document_requests(id,patient_id,practice_id,location_id),
 FOREIGN KEY(endpoint_id,patient_id,practice_id,location_id) REFERENCES public.communication_endpoints(id,patient_id,practice_id,location_id),
 FOREIGN KEY(paperwork_notification_id,patient_id,practice_id,location_id) REFERENCES public.paperwork_notifications(id,patient_id,practice_id,location_id),
 FOREIGN KEY(library_item_id,patient_id,practice_id,location_id) REFERENCES public.paperwork_library_items(id,patient_id,practice_id,location_id),
 FOREIGN KEY(document_version_id,patient_id,practice_id,location_id) REFERENCES public.document_versions(id,patient_id,practice_id,location_id),
 FOREIGN KEY(recipient_grant_id,patient_id,practice_id,location_id) REFERENCES public.patient_portal_grants(id,patient_id,practice_id,location_id),
 CHECK((purpose IN ('paperwork_ready','paperwork_resend'))=(paperwork_notification_id IS NOT NULL AND library_item_id IS NOT NULL AND document_version_id IS NOT NULL AND recipient_grant_id IS NOT NULL))
);
CREATE INDEX delivery_intent_pending ON public.delivery_intents(practice_id,location_id,scheduled_at,id) WHERE state IN ('queued','scheduled','retry_waiting','submitting','unknown','accepted');
CREATE INDEX delivery_intent_recent ON public.delivery_intents(practice_id,location_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX delivery_intent_provider_message ON public.delivery_intents(provider_id,provider_account,provider_message_id) WHERE provider_message_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.delivery_attempts ADD COLUMN intent_id uuid,ADD COLUMN external_key text,ADD COLUMN provider_account text,ADD COLUMN render_hash text;
ALTER TABLE public.delivery_attempts ADD CONSTRAINT delivery_attempt_intent_scope_fk FOREIGN KEY(intent_id,patient_id,practice_id,location_id) REFERENCES public.delivery_intents(id,patient_id,practice_id,location_id);
ALTER TABLE public.delivery_attempts DROP CONSTRAINT delivery_attempts_purpose_check;
ALTER TABLE public.delivery_attempts ADD CONSTRAINT delivery_attempts_purpose_check CHECK(purpose IN ('initial','reminder','reissue','paperwork_ready','paperwork_resend'));
ALTER TABLE public.paperwork_notifications DROP CONSTRAINT paperwork_notifications_provider_id_check;
-- PostgreSQL may name a table check after its sole referenced column. Resolve the
-- reviewed legacy expression instead of trusting schema-authored metadata names.
DO $$ DECLARE legacy_constraint text; BEGIN
 SELECT conname INTO STRICT legacy_constraint FROM pg_constraint
 WHERE conrelid='public.paperwork_notifications'::regclass AND contype='c'
 AND regexp_replace(pg_get_expr(conbin,conrelid),'[[:space:]()]','','g')='state<>ALLARRAY[''accepted''::text,''delivered''::text,''unknown''::text]';
 EXECUTE format('ALTER TABLE public.paperwork_notifications DROP CONSTRAINT %I',legacy_constraint);
END $$;
ALTER TABLE public.paperwork_notifications DROP CONSTRAINT paperwork_notifications_channel_check;
ALTER TABLE public.paperwork_notifications ADD CONSTRAINT paperwork_notifications_channel_check CHECK(channel IN ('email','sms'));
--> statement-breakpoint
CREATE TABLE public.delivery_attempt_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,patient_id uuid NOT NULL,intent_id uuid NOT NULL,attempt_id uuid,
 event_type text NOT NULL CHECK(event_type IN ('call_started','accepted','delivered','retry','failed','unknown','bounce','complaint','suppressed','cancelled','reconciled')),
 provider_event_id text,provider_message_id text,safe_code text,occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(intent_id,patient_id,practice_id,location_id) REFERENCES public.delivery_intents(id,patient_id,practice_id,location_id),
 FOREIGN KEY(attempt_id,patient_id,practice_id,location_id) REFERENCES public.delivery_attempts(id,patient_id,practice_id,location_id)
);
--> statement-breakpoint
CREATE TABLE public.delivery_callback_receipts (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,provider text NOT NULL,provider_account text NOT NULL,event_id text NOT NULL,body_hash text NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
 intent_id uuid NOT NULL,patient_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_account,event_id),FOREIGN KEY(intent_id,patient_id,practice_id,location_id) REFERENCES public.delivery_intents(id,patient_id,practice_id,location_id)
);
--> statement-breakpoint
CREATE TABLE public.destination_suppressions (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN ('email','sms')),provider_account text NOT NULL,address_fingerprint text NOT NULL CHECK(address_fingerprint ~ '^[0-9a-f]{64}$'),
 reason_code text NOT NULL CHECK(reason_code IN ('OPT_OUT','BOUNCE','COMPLAINT','INVALID_DESTINATION')),source_event_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT destination_suppressions_fact_unique UNIQUE(provider_account,channel,address_fingerprint,reason_code,source_event_id)
);
CREATE INDEX destination_suppression_lookup ON public.destination_suppressions(provider_account,channel,address_fingerprint);
--> statement-breakpoint
CREATE TABLE public.destination_suppression_releases (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,channel text NOT NULL CHECK(channel='sms'),provider_account text NOT NULL,address_fingerprint text NOT NULL CHECK(address_fingerprint ~ '^[0-9a-f]{64}$'),source_event_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT destination_suppression_release_unique UNIQUE(provider_account,channel,address_fingerprint,source_event_id)
);
CREATE INDEX destination_suppression_release_lookup ON public.destination_suppression_releases(provider_account,channel,address_fingerprint,created_at DESC);
--> statement-breakpoint
CREATE TABLE public.patient_reminder_policies (
 id uuid PRIMARY KEY DEFAULT uuidv7(),practice_id uuid NOT NULL,location_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,slots_hours integer[] NOT NULL DEFAULT ARRAY[48,24],
 window_start integer NOT NULL DEFAULT 9 CHECK(window_start BETWEEN 0 AND 22),window_end integer NOT NULL DEFAULT 18 CHECK(window_end BETWEEN 1 AND 23 AND window_end>window_start),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(practice_id,location_id),FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id),CHECK(cardinality(slots_hours) BETWEEN 1 AND 2 AND slots_hours <@ ARRAY[48,24])
);
--> statement-breakpoint
CREATE FUNCTION public.careiq_delivery_fact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAINED_DELIVERY_FACT' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME IN ('communication_permission_events','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases') THEN RAISE EXCEPTION 'APPEND_ONLY_DELIVERY_FACT' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='communication_endpoints' THEN IF (NEW.id,NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.channel,NEW.address,NEW.address_fingerprint,NEW.version,NEW.verified_at,NEW.verification_reference,NEW.verified_by_actor_id) IS DISTINCT FROM (OLD.id,OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.channel,OLD.address,OLD.address_fingerprint,OLD.version,OLD.verified_at,OLD.verification_reference,OLD.verified_by_actor_id) THEN RAISE EXCEPTION 'VERIFIED_ENDPOINT_IMMUTABLE' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='delivery_intents' THEN IF (NEW.id,NEW.practice_id,NEW.location_id,NEW.patient_id,NEW.request_id,NEW.endpoint_id,NEW.endpoint_version,NEW.request_generation,NEW.purpose,NEW.channel,NEW.address_fingerprint,NEW.masked_destination,NEW.paperwork_notification_id,NEW.library_item_id,NEW.document_version_id,NEW.recipient_grant_id,NEW.due_at_snapshot,NEW.template_version,NEW.logical_key,NEW.automatic,NEW.external_key) IS DISTINCT FROM (OLD.id,OLD.practice_id,OLD.location_id,OLD.patient_id,OLD.request_id,OLD.endpoint_id,OLD.endpoint_version,OLD.request_generation,OLD.purpose,OLD.channel,OLD.address_fingerprint,OLD.masked_destination,OLD.paperwork_notification_id,OLD.library_item_id,OLD.document_version_id,OLD.recipient_grant_id,OLD.due_at_snapshot,OLD.template_version,OLD.logical_key,OLD.automatic,OLD.external_key) THEN RAISE EXCEPTION 'DELIVERY_TARGET_IMMUTABLE' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['communication_endpoints','communication_permission_events','delivery_intents','delivery_attempt_events','delivery_callback_receipts','destination_suppressions','destination_suppression_releases','patient_reminder_policies'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY workflow_scope ON public.%I USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id'')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id''))',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO careiq_clinical_runtime',t);
 EXECUTE format('CREATE TRIGGER workflow_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation()',t);
 EXECUTE format('CREATE TRIGGER retained_delivery_fact BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.careiq_delivery_fact_guard()',t);
END LOOP;END $$;
REVOKE UPDATE ON public.communication_permission_events,public.delivery_attempt_events,public.delivery_callback_receipts,public.destination_suppressions,public.destination_suppression_releases FROM careiq_clinical_runtime;
REVOKE ALL ON FUNCTION public.careiq_delivery_fact_guard() FROM PUBLIC;
--> statement-breakpoint
-- A provider opt-out applies to the sender/account destination, even when another patient uses the same address.
CREATE FUNCTION public.careiq_delivery_destination_suppressed(account_value text,channel_value text,fingerprint_value text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.careiq_clinical_scope(public.careiq_context_uuid('app.practice_id'),public.careiq_context_uuid('app.location_id')) AND EXISTS(SELECT 1 FROM public.destination_suppressions s WHERE s.provider_account=account_value AND s.channel=channel_value AND s.address_fingerprint=fingerprint_value AND (s.reason_code<>'OPT_OUT' OR NOT EXISTS(SELECT 1 FROM public.destination_suppression_releases r WHERE r.provider_account=s.provider_account AND r.channel=s.channel AND r.address_fingerprint=s.address_fingerprint AND r.created_at>s.created_at)))
$$;
REVOKE ALL ON FUNCTION public.careiq_delivery_destination_suppressed(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_delivery_destination_suppressed(text,text,text) TO careiq_clinical_runtime;
