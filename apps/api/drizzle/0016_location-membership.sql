-- ADR-017 expansion. Existing practices remain legacy; no clinical row mappings or staff grants are inferred.
ALTER TABLE practices ADD COLUMN authorization_mode text NOT NULL DEFAULT 'legacy' CHECK (authorization_mode IN ('legacy','location'));
ALTER TABLE practices ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended'));
ALTER TABLE practices ADD COLUMN owner_user_id text;
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL CONSTRAINT locations_practice_id_practices_id_fk REFERENCES practices(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120), time_zone text NOT NULL,
  address text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, practice_id)
);
INSERT INTO locations (practice_id,name,time_zone,status) SELECT id,'Legacy — mapping review required','UTC','closed' FROM practices;
CREATE TABLE practice_member_access (
  practice_id uuid NOT NULL CONSTRAINT practice_member_access_practice_id_practices_id_fk REFERENCES practices(id), user_id text NOT NULL, membership_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_assignment','active','suspended','revoked')),
  review_token uuid, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (practice_id,user_id), UNIQUE(practice_id,membership_id)
);
CREATE TABLE location_assignments (
  practice_id uuid NOT NULL, user_id text NOT NULL, location_id uuid NOT NULL, active boolean NOT NULL DEFAULT false,
  granted_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (practice_id,user_id,location_id),
  FOREIGN KEY (practice_id,user_id) REFERENCES practice_member_access(practice_id,user_id),
  FOREIGN KEY (location_id,practice_id) REFERENCES locations(id,practice_id)
);
CREATE TABLE practice_invitations (
  id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL CONSTRAINT practice_invitations_practice_id_practices_id_fk REFERENCES practices(id),
  actor_user_id text NOT NULL, request_key uuid NOT NULL, request_hash text NOT NULL,
  email text NOT NULL, role text NOT NULL, location_ids uuid[] NOT NULL DEFAULT '{}', clerk_invitation_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('sending','invited','accepted','revoked','expired')),
  provider_revocation_pending boolean NOT NULL DEFAULT false, accepted_user_id text, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(practice_id,actor_user_id,request_key)
);
CREATE UNIQUE INDEX practice_invitation_outstanding_recipient ON practice_invitations(practice_id,email) WHERE status IN ('sending','invited');
CREATE TABLE practice_invitation_attempts (
  invitation_id uuid PRIMARY KEY CONSTRAINT practice_invitation_attempts_invitation_id_practice_invitations_id_fk REFERENCES practice_invitations(id), practice_id uuid NOT NULL CONSTRAINT practice_invitation_attempts_practice_id_practices_id_fk REFERENCES practices(id),
  sent boolean NOT NULL DEFAULT false, attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_onboarding (
  actor_user_id text PRIMARY KEY, request_key uuid NOT NULL, request_hash text NOT NULL,
  id uuid NOT NULL UNIQUE DEFAULT uuidv7(), clerk_org_id text, practice_id uuid CONSTRAINT practice_onboarding_practice_id_practices_id_fk REFERENCES practices(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_admin_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(), practice_id uuid NOT NULL CONSTRAINT practice_admin_events_practice_id_practices_id_fk REFERENCES practices(id), actor_user_id text NOT NULL,
  action text NOT NULL, subject_id text, occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE patients ADD COLUMN location_id uuid;
ALTER TABLE appointments ADD COLUMN location_id uuid;
ALTER TABLE patients ADD CONSTRAINT patients_location_practice_fk FOREIGN KEY(location_id,practice_id) REFERENCES locations(id,practice_id);
ALTER TABLE patients ADD CONSTRAINT patients_id_practice_location_unique UNIQUE(id,practice_id,location_id);
ALTER TABLE appointments ADD CONSTRAINT appointments_location_practice_fk FOREIGN KEY(location_id,practice_id) REFERENCES locations(id,practice_id);
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_location_fk FOREIGN KEY(patient_id,practice_id,location_id) REFERENCES patients(id,practice_id,location_id);
CREATE INDEX patients_location_name_idx ON patients(practice_id,location_id,last_name,first_name,id);
CREATE INDEX appointments_location_schedule_idx ON appointments(practice_id,location_id,scheduled_at,id);
ALTER TABLE clinical_audit_events ADD COLUMN location_id uuid;
ALTER TABLE clinical_audit_events ADD CONSTRAINT clinical_audit_location_fk FOREIGN KEY(location_id,practice_id) REFERENCES locations(id,practice_id);
ALTER TABLE clinical_request_keys ADD COLUMN actor_user_id text;
ALTER TABLE clinical_request_keys ADD COLUMN location_id uuid;
ALTER TABLE clinical_request_keys DROP CONSTRAINT clinical_request_keys_practice_id_operation_request_key_pk;
CREATE UNIQUE INDEX clinical_request_keys_legacy_unique ON clinical_request_keys(practice_id,operation,request_key) WHERE location_id IS NULL;
CREATE UNIQUE INDEX clinical_request_keys_scoped_unique ON clinical_request_keys(practice_id,actor_user_id,location_id,operation,request_key) WHERE location_id IS NOT NULL;
ALTER TABLE clinical_request_keys ADD CONSTRAINT clinical_request_keys_context CHECK ((location_id IS NULL AND actor_user_id IS NULL) OR (location_id IS NOT NULL AND actor_user_id IS NOT NULL AND length(btrim(actor_user_id)) BETWEEN 1 AND 256));
ALTER TABLE clinical_request_keys ADD CONSTRAINT clinical_request_keys_location_fk FOREIGN KEY(location_id,practice_id) REFERENCES locations(id,practice_id);
--> statement-breakpoint
-- Invalid/missing settings are denial, not cast failures; security-invoker functions never bypass RLS.
CREATE FUNCTION careiq_context_uuid(setting_name text) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN NULLIF(current_setting(setting_name,true),'')::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END $$;
CREATE FUNCTION careiq_clinical_scope(row_practice uuid,row_location uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT row_practice = careiq_context_uuid('app.practice_id') AND EXISTS (
    SELECT 1 FROM practices p WHERE p.id=row_practice AND p.status='active' AND (
      (p.authorization_mode='legacy' AND careiq_context_uuid('app.location_id') IS NULL AND NULLIF(current_setting('app.location_id',true),'') IS NULL)
      OR (p.authorization_mode='location' AND row_location=careiq_context_uuid('app.location_id') AND EXISTS (
        SELECT 1 FROM practice_member_access m JOIN location_assignments a ON a.practice_id=m.practice_id AND a.user_id=m.user_id
        JOIN locations l ON l.id=a.location_id AND l.practice_id=a.practice_id
        WHERE m.practice_id=row_practice AND m.user_id=NULLIF(current_setting('app.actor_user_id',true),'')
          AND m.status='active' AND a.active AND l.status='active' AND a.location_id=row_location
      ))
    )
  );
$$;
-- Remove every previous permissive clinical policy so no old policy can broaden the new boundary.
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('patients','appointments','clinical_request_keys') LOOP
    EXECUTE format('DROP POLICY %I ON %I',pol.policyname,pol.tablename);
  END LOOP;
END $$;
CREATE POLICY patients_scope ON patients USING(careiq_clinical_scope(practice_id,location_id)) WITH CHECK(careiq_clinical_scope(practice_id,location_id));
CREATE POLICY appointments_scope ON appointments USING(careiq_clinical_scope(practice_id,location_id)) WITH CHECK(careiq_clinical_scope(practice_id,location_id));
-- Historic retry metadata is visible within a practice only to detect conflicts, never to return a clinical resource in location mode.
CREATE POLICY clinical_request_keys_select ON clinical_request_keys FOR SELECT USING (
  practice_id=careiq_context_uuid('app.practice_id') AND ((location_id IS NULL AND careiq_clinical_scope(practice_id,careiq_context_uuid('app.location_id'))) OR (actor_user_id=NULLIF(current_setting('app.actor_user_id',true),'') AND careiq_clinical_scope(practice_id,location_id)))
);
CREATE POLICY clinical_request_keys_insert ON clinical_request_keys FOR INSERT WITH CHECK (
  careiq_clinical_scope(practice_id,location_id) AND (location_id IS NULL OR actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''))
);
DROP POLICY clinical_audit_events_insert ON clinical_audit_events;
CREATE POLICY clinical_audit_events_insert ON clinical_audit_events FOR INSERT WITH CHECK (
  careiq_clinical_scope(practice_id,location_id) AND actor_user_id=NULLIF(current_setting('app.actor_user_id',true),'')
);
--> statement-breakpoint
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['locations','practice_member_access','location_assignments','practice_invitations','practice_invitation_attempts','practice_admin_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY practice_scope ON %I USING (practice_id=careiq_context_uuid(''app.practice_id'')) WITH CHECK (practice_id=careiq_context_uuid(''app.practice_id''))',table_name);
  END LOOP;
END $$;
ALTER TABLE practice_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_actor ON practice_onboarding USING(actor_user_id=NULLIF(current_setting('app.actor_user_id',true),'')) WITH CHECK(actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''));
-- New metadata table privileges are explicit and never include clinical UPDATE/DELETE or audit SELECT.
DO $$ DECLARE g record; BEGIN
 FOR g IN SELECT DISTINCT c.relname,r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE c.oid=ANY(ARRAY['locations'::regclass,'practice_member_access'::regclass,'location_assignments'::regclass,'practice_invitations'::regclass,'practice_invitation_attempts'::regclass,'practice_onboarding'::regclass,'practice_admin_events'::regclass]) AND a.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON %I FROM %I',g.relname,g.rolname); END LOOP;
END $$;
REVOKE ALL ON locations,practice_member_access,location_assignments,practice_invitations,practice_invitation_attempts,practice_onboarding,practice_admin_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON locations,practice_member_access,location_assignments,practice_invitations,practice_invitation_attempts,practice_onboarding TO careiq_clinical_runtime;
GRANT INSERT ON practice_admin_events TO careiq_clinical_runtime;
-- Ownership is a narrowly writable field. Enabling location mode/status stays an operator deployment action.
GRANT UPDATE(owner_user_id) ON practices TO careiq_clinical_runtime;
GRANT SELECT ON practice_admin_events TO careiq_audit_reader;
--> statement-breakpoint
CREATE TABLE practice_provider_events (
  event_id text NOT NULL, practice_id uuid NOT NULL CONSTRAINT practice_provider_events_practice_id_practices_id_fk REFERENCES practices(id), processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(practice_id,event_id)
);
ALTER TABLE practice_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_provider_events FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_event_scope ON practice_provider_events USING(practice_id=careiq_context_uuid('app.practice_id')) WITH CHECK(practice_id=careiq_context_uuid('app.practice_id'));
DO $$ DECLARE g record; BEGIN
 FOR g IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE c.oid='practice_provider_events'::regclass AND a.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON practice_provider_events FROM %I',g.rolname); END LOOP;
END $$;
REVOKE ALL ON practice_provider_events FROM PUBLIC;
GRANT SELECT,INSERT ON practice_provider_events TO careiq_clinical_runtime;
-- Existing practices may only transition after explicit verified mapping/review. Runtime cannot update the mode.
CREATE FUNCTION careiq_location_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.authorization_mode='location' AND NEW.authorization_mode<>'location' THEN
    RAISE EXCEPTION 'Location enforcement cannot be rolled back to legacy; suspend the practice instead';
  END IF;
  IF OLD.authorization_mode='legacy' AND NEW.authorization_mode='location' THEN
    IF current_setting('careiq.rollout_reviewed',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit rollout review required'; END IF;
    IF NEW.owner_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM practice_member_access WHERE practice_id=NEW.id AND user_id=NEW.owner_user_id AND status='active')
      OR NOT EXISTS(SELECT 1 FROM locations WHERE practice_id=NEW.id AND status='active')
      OR EXISTS(SELECT 1 FROM patients WHERE practice_id=NEW.id AND location_id IS NULL)
      OR EXISTS(SELECT 1 FROM appointments WHERE practice_id=NEW.id AND location_id IS NULL) THEN
      RAISE EXCEPTION 'Owner, active location, and complete verified clinical mappings required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practices_location_activation BEFORE UPDATE OF authorization_mode ON practices FOR EACH ROW EXECUTE FUNCTION careiq_location_activation_guard();

--> statement-breakpoint
DROP POLICY practice_scope ON practice_admin_events;
CREATE POLICY admin_event_insert ON practice_admin_events FOR INSERT WITH CHECK(practice_id=careiq_context_uuid('app.practice_id') AND actor_user_id=NULLIF(current_setting('app.actor_user_id',true),''));
CREATE POLICY admin_event_review ON practice_admin_events FOR SELECT TO careiq_audit_reader USING(practice_id=careiq_context_uuid('app.practice_id'));
