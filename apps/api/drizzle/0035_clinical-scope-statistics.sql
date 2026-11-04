-- Preserve the correlation of practice and location so scoped keyset pages use
-- their existing indexes instead of sorting every authorized row in the clinic.
-- These planner statistics change no row visibility, grants, policies or data.
CREATE STATISTICS public.patients_practice_location_dependencies (dependencies)
 ON practice_id,location_id FROM public.patients;
--> statement-breakpoint
CREATE STATISTICS public.documents_practice_location_dependencies (dependencies)
 ON practice_id,location_id FROM public.documents;
--> statement-breakpoint
ANALYZE public.patients;
--> statement-breakpoint
ANALYZE public.documents;
