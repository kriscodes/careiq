ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;

CREATE POLICY "patients_tenant_isolation"
ON "patients"
USING (
  "practice_id" = current_setting('app.practice_id', true)::uuid
)
WITH CHECK (
  "practice_id" = current_setting('app.practice_id', true)::uuid
);