-- Local denial commits before provider ban; retained records and memberships are untouched.
CREATE TABLE public.personal_account_lifecycle (
  user_id text PRIMARY KEY CONSTRAINT personal_account_user_check CHECK(user_id ~ '^user_[A-Za-z0-9]+$'),
  status text NOT NULL CONSTRAINT personal_account_status_check CHECK(status IN ('active','archiving','archived','restoring')),
  archive_session_id text NOT NULL CONSTRAINT personal_account_session_check CHECK(archive_session_id ~ '^sess_[A-Za-z0-9]+$'),
  archive_requested_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, restored_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.personal_account_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id text NOT NULL CONSTRAINT personal_account_event_user_check CHECK(user_id ~ '^user_[A-Za-z0-9]+$'),
  actor_reference text NOT NULL CONSTRAINT personal_account_event_actor_check CHECK(length(actor_reference) BETWEEN 1 AND 128),
  event text NOT NULL CONSTRAINT personal_account_event_type_check CHECK(event IN ('archive_requested','archive_completed','restore_requested','restore_completed')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personal_account_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_account_lifecycle FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_account_self ON public.personal_account_lifecycle USING(user_id=NULLIF(current_setting('app.actor_user_id',true),'')) WITH CHECK(user_id=NULLIF(current_setting('app.actor_user_id',true),''));
ALTER TABLE public.personal_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_account_events FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_account_event_self_read ON public.personal_account_events FOR SELECT USING(user_id=NULLIF(current_setting('app.actor_user_id',true),''));
CREATE POLICY personal_account_event_self_insert ON public.personal_account_events FOR INSERT WITH CHECK(user_id=NULLIF(current_setting('app.actor_user_id',true),''));
REVOKE ALL ON public.personal_account_lifecycle,public.personal_account_events FROM PUBLIC;
GRANT SELECT,INSERT ON public.personal_account_lifecycle TO careiq_clinical_runtime;
GRANT UPDATE(status,archive_session_id,archive_requested_at,archived_at,restored_at,updated_at) ON public.personal_account_lifecycle TO careiq_clinical_runtime;
GRANT SELECT ON public.personal_account_events TO careiq_clinical_runtime;
GRANT INSERT(user_id,actor_reference,event) ON public.personal_account_events TO careiq_clinical_runtime;
