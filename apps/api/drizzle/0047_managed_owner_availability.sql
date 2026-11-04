-- Reconcile owner defaults under the same forced-RLS rules used by a managed migrator.
DO $$
DECLARE practice_row record; initialized integer; all_locations_value boolean;
 previous_practice text:=coalesce(current_setting('app.practice_id',true),'');
 previous_actor text:=coalesce(current_setting('app.actor_user_id',true),'');
BEGIN
 FOR practice_row IN SELECT id,owner_user_id FROM public.practices WHERE authorization_mode='location' AND status='active' AND owner_user_id IS NOT NULL LOOP
  PERFORM set_config('app.practice_id',practice_row.id::text,true),set_config('app.actor_user_id',practice_row.owner_user_id,true);
  IF NOT EXISTS(SELECT 1 FROM public.practice_member_access WHERE practice_id=practice_row.id AND user_id=practice_row.owner_user_id AND status='active') THEN CONTINUE;END IF;
  INSERT INTO public.practice_owner_access(practice_id,owner_user_id) VALUES(practice_row.id,practice_row.owner_user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS initialized=ROW_COUNT;
  SELECT all_locations INTO all_locations_value FROM public.practice_owner_access WHERE practice_id=practice_row.id AND owner_user_id=practice_row.owner_user_id;
  IF all_locations_value THEN
   INSERT INTO public.location_assignments(practice_id,user_id,location_id,active,granted_by)
   SELECT practice_row.id,practice_row.owner_user_id,l.id,true,practice_row.owner_user_id FROM public.locations l WHERE l.practice_id=practice_row.id AND l.status='active'
   ON CONFLICT(practice_id,user_id,location_id) DO UPDATE SET active=true,updated_at=now() WHERE NOT location_assignments.active;
  END IF;
  IF initialized=1 THEN
   PERFORM set_config('app.actor_user_id','system:owner-operator-migration',true);
   INSERT INTO public.practice_admin_events(practice_id,actor_user_id,action,subject_id) VALUES(practice_row.id,'system:owner-operator-migration','owner.operator_access_initialized',practice_row.owner_user_id);
  END IF;
 END LOOP;
 PERFORM set_config('app.practice_id',previous_practice,true),set_config('app.actor_user_id',previous_actor,true);
END $$;
--> statement-breakpoint
-- The helper owns only this bounded projection; the API cannot assume this role.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='careiq_availability_reader') THEN
  CREATE ROLE careiq_availability_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='careiq_availability_reader' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='careiq_availability_reader'::regrole)
 OR pg_has_role('careiq_clinical_runtime','careiq_availability_reader','MEMBER') THEN
  RAISE EXCEPTION 'AVAILABILITY_READER_ROLE_UNSAFE' USING ERRCODE='42501';
 END IF;
END $$;
GRANT careiq_availability_reader TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT USAGE,CREATE ON SCHEMA public TO careiq_availability_reader;
GRANT SELECT(id,status,authorization_mode) ON public.practices TO careiq_availability_reader;
GRANT SELECT(practice_id,user_id,status) ON public.practice_member_access TO careiq_availability_reader;
GRANT SELECT(practice_id,user_id,location_id,active) ON public.location_assignments TO careiq_availability_reader;
GRANT SELECT(id,practice_id,status) ON public.locations TO careiq_availability_reader;
GRANT SELECT(id,practice_id,status) ON public.providers TO careiq_availability_reader;
GRANT SELECT(practice_id,provider_id,location_id,active) ON public.provider_locations TO careiq_availability_reader;
GRANT SELECT(id,practice_id,location_id,provider_id,status,scheduled_at,ends_at) ON public.appointments TO careiq_availability_reader;
GRANT EXECUTE ON FUNCTION public.careiq_context_uuid(text),public.careiq_clinical_scope(uuid,uuid),public.careiq_workflow_practice_scope(uuid) TO careiq_availability_reader;
CREATE POLICY appointments_availability_projection ON public.appointments FOR SELECT TO careiq_availability_reader USING(practice_id=careiq_context_uuid('app.practice_id'));
ALTER FUNCTION public.careiq_provider_slot_busy(uuid,timestamptz,timestamptz,uuid) OWNER TO careiq_availability_reader;
REVOKE CREATE ON SCHEMA public FROM careiq_availability_reader;
GRANT careiq_availability_reader TO CURRENT_USER WITH INHERIT FALSE, SET FALSE;
