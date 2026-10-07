-- Security-invoker RLS helpers must resolve application tables before pg_temp.
-- Prevent a runtime-created temporary table from shadowing the real access tables.
ALTER FUNCTION public.careiq_context_uuid(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.careiq_clinical_scope(uuid,uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.careiq_location_activation_guard() SET search_path = pg_catalog, public, pg_temp;
