CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;

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