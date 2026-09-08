import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, pool } from "./client.js";
import { withTenant } from "./with-tenant.js";
import { practices } from "./schema/practices.js";
import { patients } from "./schema/patients.js";
import { appointments } from "./schema/appointments.js";

async function main() {
  const allPractices = await db.select().from(practices);

  const practiceA = allPractices[0];

  if (!practiceA) {
    throw new Error("Practice A does not exist.");
  }

  const [practiceB] = await db
    .select()
    .from(practices)
    .where(eq(practices.clerkOrgId, "org_rls_test_b"))
    .limit(1);

  if (!practiceB) {
    throw new Error("Practice B does not exist.");
  }

  const patientsForA = await withTenant(practiceA.id, async (tx) => {
    return tx.select().from(patients);
  });

  if (patientsForA.length === 0) {
    throw new Error("Practice A has no patients.");
  }

  let patientsForB = await withTenant(practiceB.id, async (tx) => {
    return tx.select().from(patients);
  });

  if (patientsForB.length === 0) {
    const [patientB] = await withTenant(practiceB.id, async (tx) => {
      return tx
        .insert(patients)
        .values({
          practiceId: practiceB.id,
          firstName: "Practice",
          lastName: "B Patient",
          email: "practice-b@example.com",
          phone: "555-222-2222",
        })
        .returning();
    });

    patientsForB = [patientB];
  }

  const patientA = patientsForA[0];
  const patientB = patientsForB[0];

  const [appointmentA] = await withTenant(practiceA.id, async (tx) => {
    return tx
      .insert(appointments)
      .values({
        practiceId: practiceA.id,
        patientId: patientA.id,
        scheduledAt: new Date("2026-09-08T10:00:00-07:00"),
        reason: "Practice A RLS test",
      })
      .returning();
  });

  const [appointmentB] = await withTenant(practiceB.id, async (tx) => {
    return tx
      .insert(appointments)
      .values({
        practiceId: practiceB.id,
        patientId: patientB.id,
        scheduledAt: new Date("2026-09-08T11:00:00-07:00"),
        reason: "Practice B RLS test",
      })
      .returning();
  });

  console.log("Created appointments:");
  console.log({
    appointmentA: appointmentA.id,
    appointmentB: appointmentB.id,
  });

  const appointmentsForA = await withTenant(
    practiceA.id,
    async (tx) => {
      return tx.select().from(appointments);
    },
  );

  const appointmentsForB = await withTenant(
    practiceB.id,
    async (tx) => {
      return tx.select().from(appointments);
    },
  );

  console.log("\nPractice A sees:");
  console.log(appointmentsForA);

  console.log("\nPractice B sees:");
  console.log(appointmentsForB);

  const practiceASeesPracticeB = appointmentsForA.some(
    (appointment) => appointment.practiceId === practiceB.id,
  );

  const practiceBSeesPracticeA = appointmentsForB.some(
    (appointment) => appointment.practiceId === practiceA.id,
  );

  console.log("\nIsolation checks:");
  console.log({
    practiceASeesPracticeB,
    practiceBSeesPracticeA,
  });

  if (practiceASeesPracticeB || practiceBSeesPracticeA) {
    throw new Error("Appointment RLS isolation failed.");
  }

  try {
    await withTenant(practiceA.id, async (tx) => {
      await tx.insert(appointments).values({
        practiceId: practiceA.id,
        patientId: patientB.id,
        scheduledAt: new Date("2026-09-08T12:00:00-07:00"),
        reason: "THIS MUST FAIL",
      });
    });

    console.error(
      "ERROR: Practice A created an appointment for Practice B's patient.",
    );
  } catch {
    console.log(
      "Cross-tenant patient appointment correctly blocked.",
    );
  }

  console.log("\nAppointment tenant isolation passed.");

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);

  await pool.end();

  process.exit(1);
});