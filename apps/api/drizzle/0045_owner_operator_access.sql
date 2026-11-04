-- Owner preferences are local, actor-scoped and separate from provider roles.
CREATE TABLE public.practice_owner_access (
  practice_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  disabled_permissions text[] NOT NULL DEFAULT '{}'::text[],
  all_locations boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_owner_access_pkey PRIMARY KEY(practice_id,owner_user_id),
  CONSTRAINT practice_owner_access_member_fk FOREIGN KEY(practice_id,owner_user_id) REFERENCES public.practice_member_access(practice_id,user_id) ON DELETE CASCADE,
  CONSTRAINT practice_owner_access_revision_check CHECK(revision>=0),
  CONSTRAINT practice_owner_access_permissions_check CHECK(
    coalesce(array_ndims(disabled_permissions),1)=1 AND cardinality(disabled_permissions)<=17
    AND array_position(disabled_permissions,NULL) IS NULL
    AND disabled_permissions <@ ARRAY['org:patients:read','org:patients:create','org:patients:update','org:appointments:read','org:appointments:create','org:appointments:update','org:documents:read','org:documents:upload','org:documents:review','org:documents:archive','org:requests:send','org:requirements:waive','org:requirements:manage','org:work:manage','org:workflow:configure','org:paperwork:manage','org:activity:read']::text[]
  )
);
--> statement-breakpoint
-- The reviewed owner default uses ordinary assignments; clinical RLS is unchanged.
WITH initialized AS (
  INSERT INTO public.practice_owner_access(practice_id,owner_user_id)
  SELECT p.id,p.owner_user_id FROM public.practices p JOIN public.practice_member_access m ON m.practice_id=p.id AND m.user_id=p.owner_user_id
  WHERE p.authorization_mode='location' AND p.status='active' AND m.status='active'
  ON CONFLICT(practice_id,owner_user_id) DO NOTHING
  RETURNING practice_id,owner_user_id
)
INSERT INTO public.practice_admin_events(practice_id,actor_user_id,action,subject_id)
SELECT practice_id,'system:owner-operator-migration','owner.operator_access_initialized',owner_user_id FROM initialized;
INSERT INTO public.location_assignments(practice_id,user_id,location_id,active,granted_by)
SELECT p.id,p.owner_user_id,l.id,true,p.owner_user_id
FROM public.practices p JOIN public.practice_member_access m ON m.practice_id=p.id AND m.user_id=p.owner_user_id
JOIN public.locations l ON l.practice_id=p.id AND l.status='active'
WHERE p.authorization_mode='location' AND p.status='active' AND m.status='active'
ON CONFLICT(practice_id,user_id,location_id) DO UPDATE SET active=true,updated_at=now() WHERE NOT location_assignments.active;
--> statement-breakpoint
ALTER TABLE public.practice_owner_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_owner_access FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_owner_self ON public.practice_owner_access
USING(practice_id=careiq_context_uuid('app.practice_id') AND owner_user_id=NULLIF(current_setting('app.actor_user_id',true),''))
WITH CHECK(practice_id=careiq_context_uuid('app.practice_id') AND owner_user_id=NULLIF(current_setting('app.actor_user_id',true),''));
REVOKE ALL ON public.practice_owner_access FROM PUBLIC;
GRANT SELECT,INSERT ON public.practice_owner_access TO careiq_clinical_runtime;
GRANT UPDATE(disabled_permissions,all_locations,revision,updated_at) ON public.practice_owner_access TO careiq_clinical_runtime;
