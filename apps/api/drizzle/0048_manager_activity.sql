-- Operational team activity is a bounded safe projection of canonical completed
-- business events, independent of forensic audit access and appointment dates.
CREATE FUNCTION audit.manager_activity(from_date date,to_date date)
RETURNS TABLE(id uuid,occurred_at timestamptz,action text,category text,entity_type text,entity_id text,outcome text,actor_type text,actor_id text,result text,source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p uuid:=public.careiq_context_uuid('app.practice_id'); l uuid:=public.careiq_context_uuid('app.location_id'); zone text;
BEGIN
 IF from_date IS NULL OR to_date IS NULL OR to_date<from_date OR to_date-from_date>30 THEN RAISE EXCEPTION 'INVALID_ACTIVITY_RANGE' USING ERRCODE='22023'; END IF;
 IF l IS NULL OR NOT public.careiq_clinical_scope(p,l) THEN RAISE EXCEPTION 'MANAGER_ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT x.time_zone INTO zone FROM public.locations x WHERE x.id=l AND x.practice_id=p AND x.status='active';
 IF zone IS NULL THEN RAISE EXCEPTION 'MANAGER_ACTIVITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.recorded_at,e.action::text,
 CASE WHEN e.action LIKE 'appointments.%' THEN 'appointments' WHEN e.action IN ('insurance.follow_up.revised','work-items.assignment','work-items.completion','requests.reminders','requests.reissue') THEN 'followups' ELSE 'insurance' END,
 e.entity_type,e.entity_id,e.outcome,e.actor_type,e.actor_id,
 CASE WHEN e.action IN ('insurance.case.created','insurance.coverage.revised','insurance.evidence.recorded','insurance.evidence.corrected') THEN CASE WHEN e.metadata->>'toState' IN ('unverified','active','inactive','needs_follow_up') THEN e.metadata->>'toState' END
 ELSE CASE WHEN e.metadata->>'resultState' IN ('scheduled','confirmed','checked_in','in_progress','completed','cancelled','no_show','open') THEN e.metadata->>'resultState' END END,
 CASE WHEN e.action IN ('insurance.evidence.recorded','insurance.evidence.corrected') AND e.metadata->>'channel' IN ('payer_portal','phone','document') THEN e.metadata->>'channel' END
 FROM audit.events e
 WHERE e.practice_id=p AND e.location_id=l AND e.outcome='succeeded' AND e.actor_type IN ('user','administrator') AND e.actor_id IS NOT NULL
 AND e.recorded_at >= (from_date::timestamp AT TIME ZONE zone) AND e.recorded_at < ((to_date+1)::timestamp AT TIME ZONE zone)
 AND e.action=ANY(ARRAY['appointments.create','appointments.update','appointments.status','appointments.cancellation','insurance.case.created','insurance.coverage.revised','insurance.evidence.recorded','insurance.evidence.corrected','insurance.follow_up.revised','work-items.assignment','work-items.completion','requests.reminders','requests.reissue']);
END $$;
REVOKE ALL ON FUNCTION audit.manager_activity(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.manager_activity(date,date) TO careiq_clinical_runtime;
