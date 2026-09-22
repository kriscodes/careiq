ALTER POLICY "patients_tenant_isolation" ON "patients"
USING ("practice_id" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
WITH CHECK ("practice_id" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "appointments_tenant_isolation" ON "appointments"
USING ("practice_id" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
WITH CHECK ("practice_id" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
