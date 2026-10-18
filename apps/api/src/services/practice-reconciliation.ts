import type { WebhookEvent } from "@clerk/backend/webhooks";
import { practiceTransaction } from "../db/practice-transaction.js";
import { clerk, currentMembership } from "./clerk-directory.js";
import { findPracticeByClerkOrgId } from "./practice.service.js";

/** Provider events and scheduled reconciliation can only narrow access, never activate enrollment or grants. */
export async function reconcilePracticeMember(orgId: string, userId: string, eventId?: string) {
  const practice = await findPracticeByClerkOrgId(orgId);
  if (!practice || practice.authorizationMode !== "location") return;
  const current = await currentMembership(orgId, userId);
  return practiceTransaction(practice.id, "system:clerk-reconciliation", async (client) => {
    if (eventId) {
      const inserted = await client.query("INSERT INTO practice_provider_events(event_id,practice_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [eventId, practice.id]);
      if (!inserted.rowCount) return;
    }
    const local = (await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR UPDATE", [practice.id, userId])).rows[0];
    if (local && (!current || current.id !== local.membership_id)) {
      await client.query("UPDATE practice_member_access SET status='revoked',review_token=NULL,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [practice.id, userId]);
      await client.query("UPDATE location_assignments SET active=false,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [practice.id, userId]);
      await client.query("INSERT INTO practice_admin_events(practice_id,actor_user_id,action,subject_id) VALUES($1,'system:clerk-reconciliation','member.provider_revoked',$2)", [practice.id, userId]);
    }
  });
}
export async function handleClerkEvent(event: WebhookEvent, eventId: string) {
  if (event.type === "organizationMembership.created" || event.type === "organizationMembership.updated" || event.type === "organizationMembership.deleted") {
    await reconcilePracticeMember(event.data.organization.id, event.data.public_user_data.user_id, eventId);
  }
  if (event.type === "organizationInvitation.created" || event.type === "organizationInvitation.revoked" || event.type === "organizationInvitation.accepted") {
    await reconcilePracticeInvitations(event.data.organization_id);
  }
  // Duplicate/older invitation events converge through fresh provider state and conditional writes, never activation.
}

/** Refresh invitation projection without granting enrollment. Provider accepted stays locally invited until recipient verification. */
export async function reconcilePracticeInvitations(orgId: string) {
  const practice = await findPracticeByClerkOrgId(orgId);
  if (!practice || practice.authorizationMode !== "location") return;
  const rows = await practiceTransaction(practice.id, "system:clerk-reconciliation", async (client) => (await client.query("SELECT * FROM practice_invitations WHERE practice_id=$1 AND status IN ('sending','invited')", [practice.id])).rows);
  for (const row of rows) {
    let provider;
    if (row.clerk_invitation_id) provider = await clerk.organizations.getOrganizationInvitation({ organizationId: orgId, invitationId: row.clerk_invitation_id });
    else {
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await clerk.organizations.getOrganizationInvitationList({ organizationId: orgId, offset, limit: 100 });
        provider = page.data.find((invitation) => invitation.privateMetadata.careiqInvitationId === row.id);
        if (provider || offset + page.data.length >= page.totalCount) break;
      }
    }
    if (!provider || provider.organizationId !== orgId || provider.emailAddress.toLowerCase() !== row.email || provider.privateMetadata.careiqInvitationId !== row.id || provider.role !== row.role) continue;
    const status = provider.status === "revoked" ? "revoked" : provider.status === "expired" || (provider.status === "pending" && provider.expiresAt <= Date.now()) ? "expired" : ["pending", "accepted"].includes(provider.status ?? "") ? "invited" : null;
    if (!status) continue;
    await practiceTransaction(practice.id, "system:clerk-reconciliation", async (client) => {
      const updated = await client.query("UPDATE practice_invitations SET status=$3,clerk_invitation_id=$4,expires_at=$5,updated_at=now() WHERE practice_id=$1 AND id=$2 AND status IN ('sending','invited') AND (status<>$3 OR clerk_invitation_id IS NULL) RETURNING id", [practice.id,row.id,status,provider!.id,new Date(provider!.expiresAt)]);
      if (updated.rowCount) await client.query("INSERT INTO practice_admin_events(practice_id,actor_user_id,action,subject_id) VALUES($1,'system:clerk-reconciliation','invitation.reconciled',$2)", [practice.id,row.id]);
    });
  }
}
