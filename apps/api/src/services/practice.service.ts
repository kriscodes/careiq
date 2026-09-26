import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { practices } from "../db/schema/practices.js"

const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
});

export async function findPracticeByClerkOrgId(clerkOrgId: string) {
    const [practice] = await db
    .select()
    .from(practices)
    .where(eq(practices.clerkOrgId, clerkOrgId))
    .limit(1);

    return practice ?? null;
}

export async function provisionPractice(clerkOrgId: string) {
    const existingPractice = await findPracticeByClerkOrgId(clerkOrgId);

    if(existingPractice) {
        return existingPractice;
    }

    const organization = await clerkClient.organizations.getOrganization({
        organizationId: clerkOrgId,
    });

    const [practice] = await db
    .insert(practices)
    .values({
        clerkOrgId,
        name: organization.name,
    })
    .onConflictDoNothing({
        target: practices.clerkOrgId,
    })
    .returning();

    if(practice) {
        return practice;
    }

    return findPracticeByClerkOrgId(clerkOrgId);
}