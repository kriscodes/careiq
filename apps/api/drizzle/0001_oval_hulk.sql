CREATE TABLE "tenant_test_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_test_records" ADD CONSTRAINT "tenant_test_records_practice_id_practices_id_fk" 
FOREIGN KEY ("practice_id") 
REFERENCES "public"."practices"("id") 
ON DELETE no action ON UPDATE no action;

ALTER TABLE "tenant_test_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_test_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation"
ON "tenant_test_records"
USING (
	"practice_id" = current_setting('app.practice_id', true)::uuid
)
WITH CHECK (
	"practice_id" = current_setting('app.practice_id', true)::uuid
);