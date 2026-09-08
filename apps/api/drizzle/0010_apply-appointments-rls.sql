ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_tenant_isolation"
ON "appointments";

CREATE POLICY "appointments_tenant_isolation"
ON "appointments"
USING (
  "practice_id" = current_setting('app.practice_id', true)::uuid
)
WITH CHECK (
  "practice_id" = current_setting('app.practice_id', true)::uuid
);