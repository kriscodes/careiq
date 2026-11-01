import type { PoolClient } from "pg";
import type { TenantContext } from "../middleware/tenant-context.js";
import { AccessError, type CurrentMembership } from "./practice-policy.js";
import { applyOwnerOperatorPermissions, parseOwnerOperatorDisabledPermissions } from "./owner-operator-policy.js";

export type OwnerAccess = { disabledPermissions: string[]; allLocations: boolean; revision: number };
export type EffectivePracticePermissions = { permissions: string[]; ownerOperator: boolean; ownerAccess: OwnerAccess | null };
type PermissionSubject = { practiceId: string; orgId: string; userId: string; membership: CurrentMembership | null };

/** Same-client authorization only. Neither provider role labels nor a stale owner snapshot are authority. */
export async function resolveEffectivePracticePermissions(client: PoolClient, subject: PermissionSubject): Promise<EffectivePracticePermissions> {
  const { practiceId, orgId, userId, membership } = subject;
  const context = (await client.query("SELECT current_setting('app.practice_id',true) AS practice, current_setting('app.actor_user_id',true) AS actor")).rows[0];
  if (!context || context.practice !== practiceId || context.actor !== userId) throw new AccessError("AUTHORIZATION_CONTEXT_MISMATCH", 403);
  if (!membership || membership.userId !== userId || typeof membership.id !== "string" || !membership.id || !Array.isArray(membership.permissions) || membership.permissions.some(permission => typeof permission !== "string")) throw new AccessError("ENROLLMENT_REQUIRED", 403);
  const practice = (await client.query('SELECT id,clerk_org_id AS "orgId",owner_user_id AS "ownerUserId",authorization_mode AS "authorizationMode",status FROM practices WHERE id=$1 FOR SHARE', [practiceId])).rows[0];
  if (!practice || practice.orgId !== orgId || practice.authorizationMode !== "location" || practice.status !== "active") throw new AccessError("PRACTICE_UNAVAILABLE", 403);
  const member = (await client.query('SELECT membership_id AS "membershipId",status FROM practice_member_access WHERE practice_id=$1 AND user_id=$2', [practiceId, userId])).rows[0];
  if (!member || member.status !== "active" || member.membershipId !== membership.id) throw new AccessError("ENROLLMENT_REQUIRED", 403);
  const account = (await client.query("SELECT status FROM personal_account_lifecycle WHERE user_id=$1", [userId])).rows[0];
  if (account && account.status !== "active") throw new AccessError("ACCOUNT_ARCHIVED", 403, "This account is archived or unavailable. Contact support to restore access.");
  const ownerOperator = practice.ownerUserId === userId && membership.role === "org:admin";
  if (!ownerOperator) return { permissions: applyOwnerOperatorPermissions(membership.permissions, false), ownerOperator: false, ownerAccess: null };
  const profile = (await client.query('SELECT disabled_permissions AS "disabledPermissions",all_locations AS "allLocations",revision FROM practice_owner_access WHERE practice_id=$1 AND owner_user_id=$2', [practiceId, userId])).rows[0];
  let ownerAccess: OwnerAccess = { disabledPermissions: [], allLocations: true, revision: 0 };
  if (profile) {
    try {
      const disabledPermissions = parseOwnerOperatorDisabledPermissions(profile.disabledPermissions);
      if (typeof profile.allLocations !== "boolean" || !Number.isSafeInteger(profile.revision) || profile.revision < 0) throw new Error("Invalid owner access profile");
      ownerAccess = { disabledPermissions, allLocations: profile.allLocations, revision: profile.revision };
    } catch { throw new AccessError("AUTHORIZATION_UNAVAILABLE", 503, "Current owner access could not be verified. Please retry."); }
  }
  return { permissions: applyOwnerOperatorPermissions(membership.permissions, true, ownerAccess.disabledPermissions), ownerOperator: true, ownerAccess };
}

/** Off-HTTP callers supply freshly fetched membership; each recipient is read under their own actor RLS. */
export async function effectivePermissionsForMember(tenant: Pick<TenantContext, "practiceId" | "orgId">, userId: string, membership: CurrentMembership): Promise<EffectivePracticePermissions> {
  const { practiceTransaction } = await import("../db/practice-transaction.js");
  return practiceTransaction(tenant.practiceId, userId, client => resolveEffectivePracticePermissions(client, { practiceId: tenant.practiceId, orgId: tenant.orgId, userId, membership }));
}
