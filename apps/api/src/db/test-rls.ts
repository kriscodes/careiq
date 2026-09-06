import "dotenv/config";

 import { eq } from "drizzle-orm"

 import { db, pool } from "./client.js"
 import { withTenant } from "./with-tenant";
 import { practices } from "./schema/practices";
 import { tenantTestRecords } from "./schema/tenant-test-records";

 async function main() {
    const allPractices = await db.select().from(practices);

    const practiceA = allPractices[0];

    if(!practiceA) {
        throw new Error("Practice A does not exist");
    }

    await withTenant(practiceA.id, async(tx) => {
        await tx.insert(tenantTestRecords).values({
            practiceId: practiceA.id, 
            value: "Practice A secret",
        })
    })

    let [practiceB] = await db
    .select()
    .from(practices)
    .where(eq(practices.clerkOrgId, "org_rls_test_b"))
    .limit(1);

    if(!practiceB) {
        [practiceB] = await db
        .insert(practices)
        .values({
            clerkOrgId: "org_rls_test_b",
            name: "RLS Test Practice B",
        })
        .returning();
    }

    await withTenant(practiceB.id, async(tx) => {
        await tx.insert(tenantTestRecords).values({
            practiceId: practiceB.id,
            value: "Practice B secret",
        })
    })

    console.log("Seeded tenant records.")

    console.log({
        practiceA: practiceA.id,
        practiceB: practiceB.id,
    });

    const rowsForA = await withTenant(practiceA.id, async(tx) => {
        return tx.select().from(tenantTestRecords);
    });

    console.log("Practice A sees: ", rowsForA);

    const rowsForB = await withTenant(practiceB.id, async(tx) => {
        return tx.select().from(tenantTestRecords);
    });

    console.log("Practice B sees: ", rowsForB);

    try {
        await withTenant(practiceA.id, async(tx) => {
            await tx.insert(tenantTestRecords).values({
                practiceId: practiceB.id,
                value: "THIS MUST FAIL",
            });
        });

        console.error("ERROR: Cross-Tenant insert is unexpectadly succeeding");
    } catch {
        console.log("Cross-tenant insert correctly blocked.");
    }

    await pool.end();
 }

 main().catch((error => {
    console.error(error);
    process.exit(1);
 }))

 