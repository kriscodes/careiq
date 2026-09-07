import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, pool } from "./client.js";
import { withTenant } from "./with-tenant.js";
import { practices } from "./schema/practices.js";
import { patients } from "./schema/patients.js";

async function main() {
    const allPractices = await db.select().from(practices);

    const practiceA = allPractices[0];

    if(!practiceA) {
        throw new Error("Practice A does not exist.");
    }

    const [practiceB] = await db
    .select()
    .from(practices)
    .where(eq(practices.clerkOrgId, "org_rls_test_b"))
    .limit(1);

    if(!practiceB) {
        throw new Error("Practice B does not exist.");
    }

    const rowsForA = await withTenant(practiceA.id, async (tx) => {
        return tx.select().from(patients);
    });

    const rowsForB = await withTenant(practiceB.id, async(tx) => {
        return tx.select().from(patients);
    });

    console.log("Practice A sees: ");
    console.log(rowsForA);

    console.log("Practice B sees:");
    console.log(rowsForB);

    await pool.end();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});