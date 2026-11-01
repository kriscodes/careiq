-- Durable personal-account requests only. No identity, membership, clinical or audit records are erased.
CREATE TABLE public.account_closure_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id text NOT NULL CONSTRAINT account_closure_actor_check CHECK(actor_user_id ~ '^user_[A-Za-z0-9]+$'),
  requested_session_id text NOT NULL CONSTRAINT account_closure_session_check CHECK(requested_session_id ~ '^sess_[A-Za-z0-9]+$'),
  action text NOT NULL CONSTRAINT account_closure_action_check CHECK(action IN ('archive','delete')),
  status text NOT NULL DEFAULT 'pending' CONSTRAINT account_closure_status_check CHECK(status IN ('pending','fulfilled','cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_closure_one_pending ON public.account_closure_requests(actor_user_id) WHERE status='pending';
ALTER TABLE public.account_closure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_closure_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY account_closure_self_read ON public.account_closure_requests FOR SELECT USING(actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''));
CREATE POLICY account_closure_self_request ON public.account_closure_requests FOR INSERT WITH CHECK(actor_user_id=NULLIF(current_setting('app.actor_user_id',true),'') AND status='pending');
REVOKE ALL ON public.account_closure_requests FROM PUBLIC;
GRANT SELECT ON public.account_closure_requests TO careiq_clinical_runtime;
GRANT INSERT(actor_user_id,requested_session_id,action) ON public.account_closure_requests TO careiq_clinical_runtime;
