-- Staff alerts never confer record access. Ownership events commit with source work.
ALTER TABLE public.work_items ADD COLUMN notification_due_generation bigint NOT NULL DEFAULT 1 CHECK(notification_due_generation>0), ADD COLUMN notification_owner_generation bigint NOT NULL DEFAULT 1 CHECK(notification_owner_generation>0);
--> statement-breakpoint
CREATE TABLE public.staff_notification_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL, location_id uuid NOT NULL, work_item_id uuid NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN('assignment','ownership_changed','unassigned','overdue','escalated')),
 source_revision bigint NOT NULL, due_generation bigint NOT NULL, owner_generation bigint NOT NULL,
 previous_owner_id text, current_owner_id text, actor_user_id text, occurred_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 FOREIGN KEY(work_item_id,practice_id,location_id) REFERENCES public.work_items(id,practice_id,location_id),
 UNIQUE(id,practice_id,location_id), UNIQUE(work_item_id,event_kind,source_revision,due_generation,owner_generation)
);
CREATE UNIQUE INDEX staff_notification_due_once ON public.staff_notification_events(work_item_id,event_kind,due_generation,owner_generation) WHERE event_kind IN('overdue','escalated');
CREATE INDEX staff_notification_pending_idx ON public.staff_notification_events(practice_id,location_id,occurred_at,id) WHERE processed_at IS NULL;
--> statement-breakpoint
CREATE TABLE public.staff_notifications (
 id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL, location_id uuid NOT NULL, event_id uuid NOT NULL, work_item_id uuid NOT NULL,
 recipient_user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, archived_at timestamptz, snoozed_until timestamptz,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 email_state text NOT NULL DEFAULT 'off' CHECK(email_state IN('off','pending','submitting','accepted','delivered','retry','failed','unknown','suppressed')),
 email_external_key text NOT NULL DEFAULT uuidv7()::text, email_destination_hash text, email_attempt_count integer NOT NULL DEFAULT 0 CHECK(email_attempt_count BETWEEN 0 AND 5), email_next_at timestamptz, email_provider_message_id text, email_failure_code text,
 FOREIGN KEY(event_id,practice_id,location_id) REFERENCES public.staff_notification_events(id,practice_id,location_id),
 FOREIGN KEY(work_item_id,practice_id,location_id) REFERENCES public.work_items(id,practice_id,location_id),
 FOREIGN KEY(practice_id,recipient_user_id) REFERENCES public.practice_member_access(practice_id,user_id),
 UNIQUE(event_id,recipient_user_id), UNIQUE(email_external_key)
);
CREATE INDEX staff_notifications_inbox_idx ON public.staff_notifications(practice_id,location_id,recipient_user_id,created_at DESC,id DESC);
CREATE TABLE public.staff_notification_email_batches (
 id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL, location_id uuid NOT NULL, recipient_user_id text NOT NULL,
 member_ids uuid[] NOT NULL CHECK(cardinality(member_ids) BETWEEN 1 AND 1000), external_key text NOT NULL UNIQUE,
 destination_hash text NOT NULL, preference_revision bigint NOT NULL, state text NOT NULL CHECK(state IN('submitting','accepted','delivered','retry','failed','unknown','suppressed')),
 provider_message_id text, failure_code text, attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count BETWEEN 1 AND 5), next_at timestamptz, accepted_at timestamptz, delivered_at timestamptz, failed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id), FOREIGN KEY(practice_id,recipient_user_id) REFERENCES public.practice_member_access(practice_id,user_id)
);
CREATE INDEX staff_notification_email_recovery_idx ON public.staff_notification_email_batches(practice_id,location_id,recipient_user_id,state,next_at);
--> statement-breakpoint
CREATE TABLE public.staff_notification_snapshots (
 id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL, location_id uuid NOT NULL, recipient_user_id text NOT NULL,
 membership_id text NOT NULL, permission_hash text NOT NULL, filter text NOT NULL, member_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 CHECK(cardinality(member_ids)<=10000), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id)
);
CREATE INDEX staff_notification_snapshot_expiry_idx ON public.staff_notification_snapshots(practice_id,location_id,recipient_user_id,expires_at);
--> statement-breakpoint
CREATE TABLE public.staff_notification_preferences (
 practice_id uuid NOT NULL, location_id uuid NOT NULL, user_id text NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), locale text NOT NULL DEFAULT 'en' CHECK(locale IN('en','es')), confirmed_time_zone text,
 email_mode text NOT NULL DEFAULT 'off' CHECK(email_mode IN('off','immediate','digest')),
 assignment_email boolean NOT NULL DEFAULT true, overdue_email boolean NOT NULL DEFAULT true,
 quiet_start time NOT NULL DEFAULT '18:00', quiet_end time NOT NULL DEFAULT '08:00', digest_time time NOT NULL DEFAULT '08:30', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(practice_id,location_id,user_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id),
 FOREIGN KEY(practice_id,user_id) REFERENCES public.practice_member_access(practice_id,user_id)
);
CREATE TABLE public.staff_notification_policies (
 practice_id uuid NOT NULL, location_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 assignments_enabled boolean NOT NULL DEFAULT true, overdue_enabled boolean NOT NULL DEFAULT false, overdue_after_minutes integer NOT NULL DEFAULT 0 CHECK(overdue_after_minutes BETWEEN 0 AND 10080),
 escalation_enabled boolean NOT NULL DEFAULT false, escalation_business_minutes integer NOT NULL DEFAULT 480 CHECK(escalation_business_minutes BETWEEN 60 AND 10080),
 queue_user_ids text[] NOT NULL DEFAULT '{}', escalation_user_ids text[] NOT NULL DEFAULT '{}', holidays text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(queue_user_ids)<=50 AND cardinality(escalation_user_ids)<=50 AND cardinality(holidays)<=100),
 PRIMARY KEY(practice_id,location_id), FOREIGN KEY(location_id,practice_id) REFERENCES public.locations(id,practice_id)
);
--> statement-breakpoint
CREATE FUNCTION public.careiq_staff_work_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  NEW.notification_due_generation:=OLD.notification_due_generation + CASE WHEN NEW.due_at IS DISTINCT FROM OLD.due_at THEN 1 ELSE 0 END;
  NEW.notification_owner_generation:=OLD.notification_owner_generation + CASE WHEN NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id THEN 1 ELSE 0 END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_work_generation BEFORE UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION public.careiq_staff_work_generation();
CREATE FUNCTION public.careiq_staff_ownership_event() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE old_owner text; kind text; BEGIN
 IF TG_OP='UPDATE' THEN old_owner:=OLD.assignee_user_id; END IF;
 IF NEW.assignee_user_id IS NOT DISTINCT FROM old_owner THEN RETURN NEW; END IF;
 IF NEW.state NOT IN('open','in_progress') THEN RETURN NEW; END IF;
 kind:=CASE WHEN NEW.assignee_user_id IS NULL THEN 'unassigned' WHEN old_owner IS NULL THEN 'assignment' ELSE 'ownership_changed' END;
 INSERT INTO public.staff_notification_events(practice_id,location_id,work_item_id,event_kind,source_revision,due_generation,owner_generation,previous_owner_id,current_owner_id,actor_user_id)
 VALUES(NEW.practice_id,NEW.location_id,NEW.id,kind,NEW.revision,NEW.notification_due_generation,NEW.notification_owner_generation,old_owner,NEW.assignee_user_id,CASE WHEN current_setting('app.staff_notification_system_event',true)='true' THEN NULL ELSE nullif(current_setting('app.actor_user_id',true),'') END);
 RETURN NEW;
END $$;
CREATE TRIGGER staff_ownership_event AFTER INSERT OR UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION public.careiq_staff_ownership_event();
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['staff_notification_events','staff_notifications','staff_notification_email_batches','staff_notification_snapshots','staff_notification_preferences','staff_notification_policies'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  EXECUTE format('CREATE POLICY staff_location_scope ON public.%I AS RESTRICTIVE FOR ALL USING(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id'')) WITH CHECK(public.careiq_clinical_scope(practice_id,location_id) AND location_id=public.careiq_context_uuid(''app.location_id''))',t);
  EXECUTE format('CREATE TRIGGER notification_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit.capture_mutation()',t);
 END LOOP;
END $$;
CREATE POLICY staff_events_scope ON public.staff_notification_events FOR ALL USING(true) WITH CHECK(true);
CREATE POLICY staff_policy_scope ON public.staff_notification_policies FOR ALL USING(true) WITH CHECK(true);
CREATE POLICY staff_preferences_self ON public.staff_notification_preferences FOR ALL USING(user_id=current_setting('app.actor_user_id',true)) WITH CHECK(user_id=current_setting('app.actor_user_id',true));
CREATE POLICY staff_email_self ON public.staff_notification_email_batches FOR ALL USING(recipient_user_id=current_setting('app.actor_user_id',true)) WITH CHECK(recipient_user_id=current_setting('app.actor_user_id',true));
CREATE POLICY staff_snapshots_self ON public.staff_notification_snapshots FOR ALL USING(recipient_user_id=current_setting('app.actor_user_id',true)) WITH CHECK(recipient_user_id=current_setting('app.actor_user_id',true));
CREATE POLICY staff_inbox_self ON public.staff_notifications FOR SELECT USING(recipient_user_id=current_setting('app.actor_user_id',true));
CREATE POLICY staff_receipt_self ON public.staff_notifications FOR UPDATE USING(recipient_user_id=current_setting('app.actor_user_id',true)) WITH CHECK(recipient_user_id=current_setting('app.actor_user_id',true));
CREATE POLICY staff_fanout ON public.staff_notifications FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM public.practice_member_access m JOIN public.location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id WHERE m.practice_id=staff_notifications.practice_id AND m.user_id=staff_notifications.recipient_user_id AND m.status='active' AND a.location_id=staff_notifications.location_id AND a.active));
GRANT SELECT,INSERT ON public.staff_notification_events TO careiq_clinical_runtime;
GRANT UPDATE(processed_at) ON public.staff_notification_events TO careiq_clinical_runtime;
GRANT SELECT,INSERT ON public.staff_notifications TO careiq_clinical_runtime;
GRANT UPDATE(read_at,archived_at,snoozed_until,revision,email_state,email_destination_hash,email_attempt_count,email_next_at,email_provider_message_id,email_failure_code) ON public.staff_notifications TO careiq_clinical_runtime;
GRANT SELECT,INSERT,DELETE ON public.staff_notification_snapshots TO careiq_clinical_runtime;
GRANT SELECT,INSERT,UPDATE ON public.staff_notification_email_batches TO careiq_clinical_runtime;
GRANT SELECT,INSERT,UPDATE ON public.staff_notification_preferences,public.staff_notification_policies TO careiq_clinical_runtime;
--> statement-breakpoint
-- A worker must assume the actual eligible recipient context, never bypass RLS.
REVOKE ALL ON FUNCTION public.careiq_staff_work_generation(),public.careiq_staff_ownership_event() FROM PUBLIC;
