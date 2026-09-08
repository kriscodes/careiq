ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_patients_id_fk";
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_id_practice_id_unique" UNIQUE("id","practice_id");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_practice_fk" FOREIGN KEY ("patient_id","practice_id") REFERENCES "public"."patients"("id","practice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
