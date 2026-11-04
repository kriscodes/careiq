-- Reveal only an occupied/not-occupied bit across this practice's locations.
-- Patient identity, appointment identifiers, times and location labels never leave this helper.
CREATE FUNCTION public.careiq_provider_slot_busy(provider_value uuid,starts_value timestamptz,ends_value timestamptz,exclude_value uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE practice_value uuid:=public.careiq_context_uuid('app.practice_id');location_value uuid:=public.careiq_context_uuid('app.location_id');
BEGIN
 IF practice_value IS NULL OR location_value IS NULL OR provider_value IS NULL OR starts_value IS NULL OR ends_value IS NULL
 OR ends_value<=starts_value OR ends_value-starts_value>interval '24 hours'
 OR public.careiq_clinical_scope(practice_value,location_value) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM public.providers p JOIN public.provider_locations a ON a.provider_id=p.id AND a.practice_id=p.practice_id
 WHERE p.id=provider_value AND p.practice_id=practice_value AND p.status='active' AND a.location_id=location_value AND a.active)
 THEN RAISE EXCEPTION 'AVAILABILITY_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 -- A current-location edit may exclude only an appointment the caller may already read.
 IF exclude_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=exclude_value AND a.practice_id=practice_value AND a.location_id=location_value)
 THEN RAISE EXCEPTION 'AVAILABILITY_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 RETURN EXISTS(SELECT 1 FROM public.appointments a WHERE a.practice_id=practice_value AND a.provider_id=provider_value
 AND a.status IN ('scheduled','confirmed','checked_in','in_progress') AND a.ends_at>starts_value AND a.scheduled_at<ends_value
 AND (exclude_value IS NULL OR a.id<>exclude_value));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.careiq_provider_slot_busy(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_provider_slot_busy(uuid,timestamptz,timestamptz,uuid) TO careiq_clinical_runtime;
