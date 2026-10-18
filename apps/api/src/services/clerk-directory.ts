import { createClerkClient } from "@clerk/backend";
import { AccessError, type CurrentMembership } from "./practice-policy.js";

export const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
export async function currentMembership(orgId: string, userId: string): Promise<CurrentMembership | null> {
  try {
    const response = await clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, userId: [userId], limit: 2 });
    const match = response.data.filter((member) => member.publicUserData?.userId === userId && member.organization.id === orgId);
    if (match.length !== 1) return null;
    const member = match[0];
    return { id: member.id, userId, role: member.role, permissions: member.permissions, displayName: [member.publicUserData?.firstName, member.publicUserData?.lastName].filter(Boolean).join(" ") || undefined, email: member.publicUserData?.identifier };
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw new AccessError("AUTHORIZATION_UNAVAILABLE", 503, "Current membership could not be verified. Please retry.");
  }
}
export async function verifiedEmails(userId: string): Promise<string[]> {
  try {
    const user = await clerk.users.getUser(userId);
    if (user.banned || user.locked) throw new AccessError("ACCOUNT_UNAVAILABLE");
    return user.emailAddresses.filter((email) => email.verification?.status === "verified").map((email) => email.emailAddress.toLowerCase());
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError("AUTHORIZATION_UNAVAILABLE", 503);
  }
}
