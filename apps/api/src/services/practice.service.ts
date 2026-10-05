import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { practices } from "../db/schema/practices.js";

/** A lookup only: selecting an arbitrary Clerk organization never provisions a practice. */
export async function findPracticeByClerkOrgId(clerkOrgId: string) {
  const [practice] = await db.select().from(practices).where(eq(practices.clerkOrgId, clerkOrgId)).limit(1);
  return practice ?? null;
}
