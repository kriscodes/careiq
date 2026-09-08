ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointments_tenant_isolation"
ON "appointments"
USING (
  "practice_id" = current_setting('app.practice_id', true)::uuid
)
WITH CHECK (
  "practice_id" = current_setting('app.practice_id', true)::uuid
);