-- Configuration replacement retires exceptions while preserving every previous schedule rule.
ALTER TABLE public.provider_availability_exceptions ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE INDEX provider_availability_exceptions_active_idx ON public.provider_availability_exceptions(practice_id,location_id,provider_id,starts_at,ends_at) WHERE active;
