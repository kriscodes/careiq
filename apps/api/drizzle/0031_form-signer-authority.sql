-- New v2 patient-only signing fails closed when a supported self-signing authority is absent.
-- This local eligibility threshold is not a universal determination of legal record/consent rights.
CREATE FUNCTION public.careiq_form_signer_authorized(request_uuid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record;a jsonb;allowed boolean;patient_row record;local_date date;
BEGIN
 SELECT req.*,loc.time_zone INTO r FROM public.document_requests req JOIN public.practices pr ON pr.id=req.practice_id AND pr.status='active' JOIN public.locations loc ON loc.id=req.location_id AND loc.practice_id=req.practice_id AND loc.status='active'
 WHERE req.id=request_uuid AND req.purpose='form_completion' AND req.form_completion_policy='form_then_sign' AND req.state='open' AND req.expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN false;END IF;
 allowed:=COALESCE(public.careiq_clinical_scope(r.practice_id,r.location_id) AND r.location_id=public.careiq_context_uuid('app.location_id'),false);
 a:=public.careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash',true),''),true);
 IF NOT allowed AND (a IS NULL OR (a->>'request_id')::uuid<>r.id OR (a->>'patient_id')::uuid<>r.patient_id OR (a->>'practice_id')::uuid<>r.practice_id OR (a->>'location_id')::uuid<>r.location_id) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.document_request_items i JOIN public.prepared_documents p ON p.id=i.prepared_document_id AND p.patient_id=i.patient_id AND p.practice_id=i.practice_id AND p.location_id=i.location_id JOIN public.template_versions tv ON tv.id=p.template_version_id AND tv.practice_id=p.practice_id WHERE i.request_id=r.id AND i.patient_id=r.patient_id AND i.practice_id=r.practice_id AND i.location_id=r.location_id AND tv.schema_version=2 AND tv.form_schema->>'completionPolicy'='form_then_sign' AND tv.form_schema->'signing'->'roles'=jsonb_build_array(jsonb_build_object('key','patient','label',tv.form_schema->'signing'->'roles'->0->>'label','required',true))) THEN RETURN false;END IF;
 -- The lock is held through the caller's completion transaction; DOB/archive updates cannot race it.
 SELECT pt.date_of_birth,pt.archived_at INTO patient_row FROM public.patients pt WHERE pt.id=r.patient_id AND pt.practice_id=r.practice_id AND pt.location_id=r.location_id FOR SHARE;
 IF NOT FOUND OR patient_row.archived_at IS NOT NULL OR patient_row.date_of_birth IS NULL THEN RETURN false;END IF;
 local_date:=(clock_timestamp() AT TIME ZONE r.time_zone)::date;
 RETURN patient_row.date_of_birth<=local_date-interval '18 years' AND patient_row.date_of_birth>local_date-interval '130 years';
END $$;
REVOKE ALL ON FUNCTION public.careiq_form_signer_authorized(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careiq_form_signer_authorized(uuid) TO careiq_clinical_runtime;
