import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestAuthentication, TenantContext } from "../middleware/tenant-context.js";
import { clinicalCapabilities } from "../middleware/permissions.js";
import { practiceTransaction } from "../db/practice-transaction.js";
import { findPracticeByClerkOrgId } from "./practice.service.js";
import { clerk, currentMembership, verifiedEmails } from "./clerk-directory.js";
import { AccessError, allowedRoles, assertCurrentEnrollment, assertOwner, assertRoleGrant, currentCapabilities, parseLocation, parseLocationIds, type CurrentMembership } from "./practice-policy.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const locationSelect = 'id,name,time_zone AS "timeZone",address,status';
const invitationSelect = 'id,email,role,status,location_ids AS "locationIds",expires_at AS "expiresAt",provider_revocation_pending AS "providerRevocationPending"';
function authenticated(auth: RequestAuthentication): string {
  if (!auth.isAuthenticated || !auth.userId) throw new AccessError("UNAUTHENTICATED", 401);
  return auth.userId;
}
async function resolve(auth: RequestAuthentication) {
  const userId = authenticated(auth);
  if (!auth.orgId) throw new AccessError("ORGANIZATION_REQUIRED");
  const practice = await findPracticeByClerkOrgId(auth.orgId);
  if (!practice) throw new AccessError("PRACTICE_NOT_FOUND");
  if (practice.status !== "active") throw new AccessError("PRACTICE_UNAVAILABLE");
  if (practice.authorizationMode !== "location") throw new AccessError("PRACTICE_MIGRATION_REQUIRED", 409);
  const membership = await currentMembership(auth.orgId, userId);
  return { userId, orgId: auth.orgId, practice, membership };
}
async function audit(client: PoolClient, practiceId: string, actor: string, action: string, subject?: string) {
  await client.query("INSERT INTO practice_admin_events(practice_id,actor_user_id,action,subject_id) VALUES($1,$2,$3,$4)", [practiceId, actor, action, subject ?? null]);
}
async function ownerTransaction<T>(auth: RequestAuthentication, callback: (client: PoolClient, context: Awaited<ReturnType<typeof resolve>>) => Promise<T>) {
  const context = await resolve(auth);
  return practiceTransaction(context.practice.id, context.userId, async (client) => {
    const { rows: [practice] } = await client.query("SELECT owner_user_id,status FROM practices WHERE id=$1 FOR SHARE", [context.practice.id]);
    assertOwner(practice, context.userId, context.membership);
    if (practice.status !== "active") throw new AccessError("PRACTICE_UNAVAILABLE");
    const { rows: [member] } = await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR SHARE", [context.practice.id, context.userId]);
    assertCurrentEnrollment(member, context.membership);
    context.practice.ownerUserId = practice.owner_user_id;
    return callback(client, context);
  });
}
async function checkLocations(client: PoolClient, practiceId: string, ids: string[]) {
  const rows = await client.query("SELECT id FROM locations WHERE practice_id=$1 AND id=ANY($2::uuid[]) AND status='active' FOR SHARE", [practiceId, ids]);
  if (rows.rowCount !== ids.length) throw new AccessError("INVALID_LOCATIONS", 400);
}
export async function getPracticeContext(auth: RequestAuthentication) {
  const userId = authenticated(auth);
  const base = { userId, orgId: auth.orgId ?? null, sessionId: auth.sessionId ?? null };
  const none = { capabilities: currentCapabilities(null), management: { locations: false, members: false }, locations: [], enrollmentStatus: null };
  if (!auth.orgId) {
    const onboardingOrgId = await practiceTransaction(null, userId, async (client) => (await client.query("SELECT clerk_org_id FROM practice_onboarding WHERE actor_user_id=$1 AND status='complete'", [userId])).rows[0]?.clerk_org_id ?? null);
    return { ...base, ...none, practice: null, onboarding: "required", onboardingOrgId };
  }
  const practice = await findPracticeByClerkOrgId(auth.orgId);
  if (!practice) return { ...base, ...none, practice: null, onboarding: "required" };
  if (practice.status !== "active") return { ...base, ...none, practice, onboarding: "pending" };
  if (practice.authorizationMode === "legacy") return { ...base, ...none, practice, onboarding: "ready", capabilities: clinicalCapabilities(auth) };
  const membership = await currentMembership(auth.orgId, userId);
  return practiceTransaction(practice.id, userId, async (client) => {
    const { rows: [member] } = await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2", [practice.id, userId]);
    const active = membership && member?.status === "active" && member.membership_id === membership.id;
    const owner = active && practice.ownerUserId === userId && membership.role === "org:admin";
    const locations = active ? (await client.query(`SELECT l.id,l.name,l.time_zone AS "timeZone",l.address,l.status FROM locations l JOIN location_assignments a ON a.location_id=l.id AND a.practice_id=l.practice_id WHERE l.practice_id=$1 AND a.user_id=$2 AND a.active AND l.status='active' ORDER BY l.name,l.id`, [practice.id, userId])).rows : [];
    return { ...base, practice, onboarding: active ? "ready" : "pending", enrollmentStatus: membership ? (member?.membership_id === membership.id ? member?.status : "pending_assignment") : "revoked", capabilities: currentCapabilities(active ? membership : null), management: { locations: Boolean(owner), members: Boolean(owner) }, locations };
  });
}
export async function authorizeLocation(auth: RequestAuthentication, locationId: string) {
  if (!uuid(locationId)) throw new AccessError("INVALID_LOCATION", 400);
  const context = await resolve(auth);
  return practiceTransaction(context.practice.id, context.userId, async (client) => {
    const { rows: [member] } = await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2", [context.practice.id, context.userId]);
    assertCurrentEnrollment(member, context.membership);
    const permitted = await client.query("SELECT l.id FROM locations l JOIN location_assignments a ON a.location_id=l.id AND a.practice_id=l.practice_id WHERE l.practice_id=$1 AND l.id=$2 AND l.status='active' AND a.user_id=$3 AND a.active", [context.practice.id, locationId, context.userId]);
    if (!permitted.rowCount) throw new AccessError("LOCATION_ACCESS_DENIED");
    return { tenant: { userId: context.userId, orgId: context.orgId, practiceId: context.practice.id, locationId, membershipId: context.membership!.id } satisfies TenantContext, capabilities: currentCapabilities(context.membership) };
  });
}
export async function onboardPractice(auth: RequestAuthentication, body: Record<string, unknown>, requestKey: string) {
  const userId = authenticated(auth);
  const emails = await verifiedEmails(userId);
  if (!emails.length) throw new AccessError("VERIFIED_EMAIL_REQUIRED");
  // Closed by default. Operators explicitly approve founding identities; no arbitrary organization adoption.
  const eligible = (process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS ?? "").split(",").map((id) => id.trim());
  if (!eligible.includes(userId)) throw new AccessError("ONBOARDING_NOT_ELIGIBLE");
  const location = parseLocation(body.location);
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || /[\u0000-\u001f]/.test(body.name)) throw new AccessError("INVALID_PRACTICE", 400);
  const name = body.name.trim(); const requestHash = hash({ name, location });
  await practiceTransaction(null, userId, async (client) => {
    await client.query("INSERT INTO practice_onboarding(actor_user_id,request_key,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [userId, requestKey, requestHash]);
  });
  return practiceTransaction(null, userId, async (client) => {
    const { rows: [attempt] } = await client.query("SELECT * FROM practice_onboarding WHERE actor_user_id=$1 FOR UPDATE", [userId]);
    if (attempt.request_hash !== requestHash) throw new AccessError("ONBOARDING_RETRY_CONFLICT", 409);
    if (attempt.status === "complete") {
      await client.query("SELECT set_config('app.practice_id',$1,true)", [attempt.practice_id]);
      const practice = await findPracticeByClerkOrgId(attempt.clerk_org_id);
      const first = (await client.query(`SELECT ${locationSelect} FROM locations WHERE practice_id=$1 ORDER BY created_at,id LIMIT 1`, [attempt.practice_id])).rows[0];
      return { orgId: attempt.clerk_org_id, practice, location: first };
    }
    // The deterministic slug and private marker reconcile an external success followed by a local rollback.
    const slug = `careiq-${attempt.id}`;
    let organization;
    try { organization = await clerk.organizations.getOrganization({ slug }); }
    catch (error) {
      if ((error as { status?: number }).status !== 404) throw new AccessError("PROVISIONING_UNAVAILABLE", 503);
      try { organization = await clerk.organizations.createOrganization({ name, slug, createdBy: userId, privateMetadata: { careiqOnboardingId: attempt.id, careiqOwnerUserId: userId } }); }
      catch { throw new AccessError("PROVISIONING_PENDING", 503, "Practice setup is pending. Retry with the same details and retry key."); }
    }
    if (organization.privateMetadata.careiqOnboardingId !== attempt.id || organization.privateMetadata.careiqOwnerUserId !== userId) throw new AccessError("PROVISIONING_CONFLICT", 409);
    const membership = await currentMembership(organization.id, userId);
    if (membership?.role !== "org:admin") throw new AccessError("PROVISIONING_PENDING", 503);
    const { rows: [practice] } = await client.query('INSERT INTO practices(clerk_org_id,name,authorization_mode,status,owner_user_id) VALUES($1,$2,\'location\',\'active\',$3) RETURNING id,name,authorization_mode AS "authorizationMode",status,owner_user_id AS "ownerUserId"', [organization.id, name, userId]);
    await client.query("SELECT set_config('app.practice_id',$1,true)", [practice.id]);
    await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practice.id, userId, membership.id]);
    const { rows: [first] } = await client.query(`INSERT INTO locations(practice_id,name,time_zone,address) VALUES($1,$2,$3,$4) RETURNING ${locationSelect}`, [practice.id, location.name, location.timeZone, location.address]);
    await audit(client, practice.id, userId, "practice.created", practice.id);
    await audit(client, practice.id, userId, "location.created", first.id);
    await client.query("UPDATE practice_onboarding SET clerk_org_id=$2,practice_id=$3,status='complete' WHERE actor_user_id=$1", [userId, organization.id, practice.id]);
    return { orgId: organization.id, practice, location: first };
  });
}
export async function getPracticeAdmin(auth: RequestAuthentication) {
  return ownerTransaction(auth, async (client, context) => {
    const locations = (await client.query(`SELECT ${locationSelect} FROM locations WHERE practice_id=$1 ORDER BY name,id`, [context.practice.id])).rows;
    const local = (await client.query('SELECT user_id AS "userId",membership_id AS "membershipId",status FROM practice_member_access WHERE practice_id=$1 ORDER BY user_id', [context.practice.id])).rows;
    const members = [];
    // Bounded administrative directory; no clinical records or invitation tokens are returned.
    if (local.length > 500) throw new AccessError("DIRECTORY_PAGINATION_REQUIRED", 409);
    for (const member of local) {
      const current = member.userId === context.userId ? context.membership : await currentMembership(context.orgId, member.userId);
      const assignments = (await client.query("SELECT location_id FROM location_assignments WHERE practice_id=$1 AND user_id=$2 AND active", [context.practice.id, member.userId])).rows;
      const proposal = member.status === "pending_assignment" ? (await client.query("SELECT location_ids FROM practice_invitations WHERE practice_id=$1 AND accepted_user_id=$2 AND status='accepted' ORDER BY created_at DESC,id DESC LIMIT 1", [context.practice.id, member.userId])).rows[0]?.location_ids ?? [] : [];
      members.push({ ...member, proposedLocationIds: proposal, displayName: current?.displayName, email: current?.email, role: current?.role ?? null, status: current?.id === member.membershipId ? member.status : "revoked", locationIds: assignments.map((row) => row.location_id), isOwner: context.practice.ownerUserId === member.userId });
    }
    const invitations = (await client.query(`SELECT ${invitationSelect} FROM practice_invitations WHERE practice_id=$1 ORDER BY created_at DESC LIMIT 500`, [context.practice.id])).rows;
    return { locations, members, invitations, allowedRoles: allowedRoles() };
  });
}
export async function createLocation(auth: RequestAuthentication, body: unknown) {
  const input = parseLocation(body);
  return ownerTransaction(auth, async (client, context) => {
    const { rows: [location] } = await client.query(`INSERT INTO locations(practice_id,name,time_zone,address) VALUES($1,$2,$3,$4) RETURNING ${locationSelect}`, [context.practice.id, input.name, input.timeZone, input.address]);
    await audit(client, context.practice.id, context.userId, "location.created", location.id);
    return location;
  });
}
export async function setLocationStatus(auth: RequestAuthentication, locationId: string, status: unknown) {
  if (!uuid(locationId) || !["active", "closed"].includes(status as string)) throw new AccessError("INVALID_LOCATION", 400);
  return ownerTransaction(auth, async (client, context) => {
    const { rows: [location] } = await client.query(`UPDATE locations SET status=$3,updated_at=now() WHERE practice_id=$1 AND id=$2 RETURNING ${locationSelect}`, [context.practice.id, locationId, status]);
    if (!location) throw new AccessError("LOCATION_NOT_FOUND", 404);
    await audit(client, context.practice.id, context.userId, status === "closed" ? "location.closed" : "location.reopened", locationId);
    return location;
  });
}
export async function createInvitation(auth: RequestAuthentication, body: Record<string, unknown>, requestKey: string) {
  const ids = parseLocationIds(body.locationIds);
  if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new AccessError("INVALID_EMAIL", 400);
  if (typeof body.role !== "string" || !allowedRoles().includes(body.role)) throw new AccessError("ROLE_NOT_ALLOWED");
  const email = body.email.trim().toLowerCase(), role = body.role, requestHash = hash({ email, role, locationIds: ids.slice().sort() });
  const invitationId = await ownerTransaction(auth, async (client, context) => {
    await checkLocations(client, context.practice.id, ids);
    const previous = (await client.query("SELECT * FROM practice_invitations WHERE practice_id=$1 AND actor_user_id=$2 AND request_key=$3", [context.practice.id, context.userId, requestKey])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new AccessError("IDEMPOTENCY_KEY_REUSED", 409);
      return previous.id as string;
    }
    const outstanding = (await client.query("SELECT id FROM practice_invitations WHERE practice_id=$1 AND email=$2 AND status IN ('sending','invited')", [context.practice.id, email])).rowCount;
    if (outstanding) throw new AccessError("INVITATION_ALREADY_PENDING", 409, "Revoke the outstanding invitation before issuing another.");
    const { rows: [invitation] } = await client.query("INSERT INTO practice_invitations(practice_id,actor_user_id,request_key,request_hash,email,role,location_ids,status) VALUES($1,$2,$3,$4,$5,$6,$7,'sending') RETURNING id", [context.practice.id, context.userId, requestKey, requestHash, email, role, ids]);
    await audit(client, context.practice.id, context.userId, "invitation.requested", invitation.id);
    return invitation.id as string;
  });
  return ownerTransaction(auth, async (client, context) => {
    const { rows: [invitation] } = await client.query("SELECT * FROM practice_invitations WHERE id=$1 FOR NO KEY UPDATE", [invitationId]);
    if (invitation.status !== "sending") return (await client.query(`SELECT ${invitationSelect} FROM practice_invitations WHERE id=$1`, [invitationId])).rows[0];
    // An already-attempted request is reconciled against Clerk; it is never blindly re-sent.
    const invitations = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await clerk.organizations.getOrganizationInvitationList({ organizationId: context.orgId, limit: 100, offset });
      invitations.push(...page.data);
      if (offset + page.data.length >= page.totalCount) break;
      if (offset === 9900) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409);
    }
    let external = invitations.find((item) => item.privateMetadata.careiqInvitationId === invitation.id);
    if (!external) {
      // Persist the attempted marker before the call in a separate transaction would lose this row lock.
      // Use a session advisory lock via this transaction plus an independently committed marker.
      if (invitation.expires_at) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409, "The provider outcome is unknown; review the invitation before retrying.");
      await practiceTransaction(context.practice.id, context.userId, async (marker) => {
        // A marker table row avoids writing the locked invitation. The request hash identifies the sole send attempt.
        await marker.query("INSERT INTO practice_invitation_attempts(invitation_id,practice_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [invitation.id, context.practice.id]);
      });
      const attempted = (await client.query("SELECT attempted_at FROM practice_invitation_attempts WHERE invitation_id=$1", [invitation.id])).rows[0];
      if (!attempted) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409);
      // claimSend is atomically recorded separately below; only the first caller may initiate delivery.
      const claim = await practiceTransaction(context.practice.id, context.userId, async (marker) => marker.query("UPDATE practice_invitation_attempts SET sent=true WHERE invitation_id=$1 AND NOT sent RETURNING invitation_id", [invitation.id]));
      if (!claim.rowCount) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409);
      try {
        external = await clerk.organizations.createOrganizationInvitation({ organizationId: context.orgId, emailAddress: email, role, inviterUserId: context.userId, expiresInDays: 7, privateMetadata: { careiqInvitationId: invitation.id }, ...(process.env.CAREIQ_INVITATION_REDIRECT_URL ? { redirectUrl: process.env.CAREIQ_INVITATION_REDIRECT_URL } : {}) });
      } catch { throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 503, "Invitation delivery is pending confirmation. Retry the same request to reconcile it."); }
    }
    if (external.organizationId !== context.orgId || external.emailAddress.toLowerCase() !== email || external.role !== role) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409);
    if (!["pending", "accepted"].includes(external.status ?? "")) throw new AccessError("INVITATION_RECONCILIATION_REQUIRED", 409);
    await client.query("UPDATE practice_invitations SET clerk_invitation_id=$2,status='invited',expires_at=$3,updated_at=now() WHERE id=$1", [invitation.id, external.id, new Date(external.expiresAt)]);
    await audit(client, context.practice.id, context.userId, "invitation.sent", invitation.id);
    return (await client.query(`SELECT ${invitationSelect} FROM practice_invitations WHERE id=$1`, [invitation.id])).rows[0];
  });
}
export async function acceptInvitations(auth: RequestAuthentication) {
  const context = await resolve(auth);
  if (!context.membership) throw new AccessError("MEMBERSHIP_REQUIRED");
  const emails = await verifiedEmails(context.userId);
  return practiceTransaction(context.practice.id, context.userId, async (client) => {
    const candidates = (await client.query("SELECT * FROM practice_invitations WHERE practice_id=$1 AND email=ANY($2::text[]) AND status IN ('invited','accepted') ORDER BY created_at DESC FOR UPDATE", [context.practice.id, emails])).rows;
    for (const invitation of candidates) {
      if (invitation.status === "accepted") {
        if (invitation.accepted_user_id === context.userId) return { status: "already_accepted" };
        continue;
      }
      if (!invitation.clerk_invitation_id) continue;
      const provider = await clerk.organizations.getOrganizationInvitation({ organizationId: context.orgId, invitationId: invitation.clerk_invitation_id });
      if (provider.status !== "accepted" || provider.organizationId !== context.orgId || !emails.includes(provider.emailAddress.toLowerCase()) || provider.privateMetadata.careiqInvitationId !== invitation.id) continue;
      // Clerk's accepted state is authoritative for acceptance before expiry; an expired pending link never enrolls.
      const { rows: [existing] } = await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR UPDATE", [context.practice.id, context.userId]);
      if (existing && existing.membership_id === context.membership!.id && ["suspended", "revoked"].includes(existing.status)) throw new AccessError("ENROLLMENT_SUSPENDED");
      if (existing?.status === "active") throw new AccessError("ENROLLMENT_ALREADY_ACTIVE", 409);
      await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'pending_assignment') ON CONFLICT(practice_id,user_id) DO UPDATE SET membership_id=EXCLUDED.membership_id,status='pending_assignment',updated_at=now()", [context.practice.id, context.userId, context.membership!.id]);
      await client.query("UPDATE location_assignments SET active=false,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, context.userId]);
      await client.query("UPDATE practice_invitations SET status='accepted',accepted_user_id=$2,updated_at=now() WHERE id=$1", [invitation.id, context.userId]);
      await audit(client, context.practice.id, context.userId, "invitation.accepted", invitation.id);
      return { status: "pending_assignment" };
    }
    throw new AccessError("ACCEPTED_INVITATION_REQUIRED");
  });
}
export async function activateMember(auth: RequestAuthentication, targetUserId: string, body: Record<string, unknown>) {
  const ids = parseLocationIds(body.locationIds);
  const reviewToken = randomUUID();
  // Commit local suspension before a provider role mutation. A failed provider operation must not restore access.
  await ownerTransaction(auth, async (client, context) => {
    const membership = targetUserId === context.userId ? context.membership : await currentMembership(context.orgId, targetUserId);
    if (!membership) throw new AccessError("MEMBERSHIP_REQUIRED");
    assertRoleGrant(context.userId, targetUserId, membership.role, body.role, allowedRoles());
    await checkLocations(client, context.practice.id, ids);
    const member = (await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR UPDATE", [context.practice.id, targetUserId])).rows[0];
    if (!member || member.membership_id !== membership.id || member.status === "revoked") throw new AccessError("ENROLLMENT_REVIEW_REQUIRED");
    await client.query("UPDATE practice_member_access SET review_token=$3 WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId, reviewToken]);
    if (targetUserId !== context.userId) {
      await client.query("UPDATE practice_member_access SET status='suspended',updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId]);
      await client.query("UPDATE location_assignments SET active=false,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId]);
      await audit(client, context.practice.id, context.userId, "member.suspended_for_review", targetUserId);
    }
  });
  return ownerTransaction(auth, async (client, context) => {
    const member = (await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR UPDATE", [context.practice.id, targetUserId])).rows[0];
    if (member?.review_token !== reviewToken) throw new AccessError("ENROLLMENT_REVIEW_SUPERSEDED", 409);
    let membership = targetUserId === context.userId ? context.membership : await currentMembership(context.orgId, targetUserId);
    if (!membership || !member || member.membership_id !== membership.id || member.status === "revoked") throw new AccessError("ENROLLMENT_REVIEW_REQUIRED");
    assertRoleGrant(context.userId, targetUserId, membership.role, body.role, allowedRoles());
    await checkLocations(client, context.practice.id, ids);
    if (membership.role !== body.role) {
      try { await clerk.organizations.updateOrganizationMembership({ organizationId: context.orgId, userId: targetUserId, role: body.role as string }); }
      catch { throw new AccessError("ROLE_UPDATE_PENDING", 503); }
      membership = await currentMembership(context.orgId, targetUserId);
      if (!membership || membership.id !== member.membership_id || membership.role !== body.role) throw new AccessError("ROLE_UPDATE_PENDING", 503);
      await audit(client, context.practice.id, context.userId, "member.role_changed", targetUserId);
    }
    await client.query("UPDATE location_assignments SET active=false,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId]);
    for (const id of ids) await client.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$4) ON CONFLICT(practice_id,user_id,location_id) DO UPDATE SET active=true,granted_by=EXCLUDED.granted_by,updated_at=now()", [context.practice.id, targetUserId, id, context.userId]);
    await client.query("UPDATE practice_member_access SET status='active',review_token=NULL,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId]);
    await audit(client, context.practice.id, context.userId, "member.activated", targetUserId);
    for (const id of ids) await audit(client, context.practice.id, context.userId, "location.assignment_granted", `${targetUserId}:${id}`);
    return { userId: targetUserId, status: "active", role: membership.role, locationIds: ids };
  });
}
export async function suspendMember(auth: RequestAuthentication, targetUserId: string) {
  return ownerTransaction(auth, async (client, context) => {
    if (targetUserId === context.userId || targetUserId === context.practice.ownerUserId) throw new AccessError("OWNER_TRANSFER_REQUIRED", 409);
    const result = await client.query("UPDATE practice_member_access SET status='suspended',review_token=NULL,updated_at=now() WHERE practice_id=$1 AND user_id=$2 RETURNING user_id", [context.practice.id, targetUserId]);
    if (!result.rowCount) throw new AccessError("MEMBER_NOT_FOUND", 404);
    await client.query("UPDATE location_assignments SET active=false,updated_at=now() WHERE practice_id=$1 AND user_id=$2", [context.practice.id, targetUserId]);
    await audit(client, context.practice.id, context.userId, "member.suspended", targetUserId);
    return { userId: targetUserId, status: "suspended" };
  });
}
export async function revokeInvitation(auth: RequestAuthentication, invitationId: string) {
  if (!uuid(invitationId)) throw new AccessError("INVALID_INVITATION", 400);
  const pending = await ownerTransaction(auth, async (client, context) => {
    const invitation = (await client.query("SELECT * FROM practice_invitations WHERE practice_id=$1 AND id=$2 FOR UPDATE", [context.practice.id, invitationId])).rows[0];
    if (!invitation) throw new AccessError("INVITATION_NOT_FOUND", 404);
    if (invitation.status === "accepted") throw new AccessError("SUSPEND_MEMBER_INSTEAD", 409);
    await client.query("UPDATE practice_invitations SET status='revoked',provider_revocation_pending=true,updated_at=now() WHERE id=$1", [invitationId]);
    await audit(client, context.practice.id, context.userId, "invitation.revoked", invitationId);
    return { invitation, orgId: context.orgId, actor: context.userId };
  });
  let providerId = pending.invitation.clerk_invitation_id as string | null;
  try {
    let external;
    if (providerId) external = await clerk.organizations.getOrganizationInvitation({ organizationId: pending.orgId, invitationId: providerId });
    else {
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await clerk.organizations.getOrganizationInvitationList({ organizationId: pending.orgId, limit: 100, offset });
        external = page.data.find((item) => item.privateMetadata.careiqInvitationId === invitationId);
        if (external) { providerId = external.id; break; }
        if (offset + page.data.length >= page.totalCount) break;
        if (offset === 9900) throw new Error("RECONCILIATION_REQUIRED");
      }
      // An attempted send with an unknown provider outcome cannot be declared successfully revoked.
      if (!external) {
        const attempted = await practiceTransaction(pending.invitation.practice_id, pending.actor, async (client) => (await client.query("SELECT sent FROM practice_invitation_attempts WHERE invitation_id=$1", [invitationId])).rows[0]?.sent);
        if (attempted) throw new Error("RECONCILIATION_REQUIRED");
      }
    }
    if (external?.status === "pending") await clerk.organizations.revokeOrganizationInvitation({ organizationId: pending.orgId, invitationId: external.id, requestingUserId: pending.actor });
    // Accepted invitations cannot be undone at the provider. The locally revoked enrollment attempt
    // remains denied; removing an actual member is a separate explicit operation.
    await practiceTransaction(pending.invitation.practice_id, pending.actor, async (client) => {
      await client.query("UPDATE practice_invitations SET clerk_invitation_id=COALESCE($2,clerk_invitation_id),provider_revocation_pending=false,updated_at=now() WHERE id=$1 AND status='revoked'", [invitationId, providerId]);
      await audit(client, pending.invitation.practice_id, pending.actor, "invitation.revocation_reconciled", invitationId);
    });
  } catch { throw new AccessError("INVITATION_REVOCATION_PENDING", 503, "Local access is revoked; retry to finish provider revocation."); }
  return { id: invitationId, status: "revoked", providerRevocationPending: false };
}

export async function transferOwnership(auth: RequestAuthentication, targetUserId: string) {
  if (!targetUserId || targetUserId === authenticated(auth)) throw new AccessError("INVALID_OWNER", 400);
  return ownerTransaction(auth, async (client, context) => {
    const membership = await currentMembership(context.orgId, targetUserId);
    const member = (await client.query("SELECT * FROM practice_member_access WHERE practice_id=$1 AND user_id=$2 FOR SHARE", [context.practice.id, targetUserId])).rows[0];
    assertCurrentEnrollment(member, membership);
    if (membership?.role !== "org:admin") throw new AccessError("OWNER_ROLE_REQUIRED");
    await client.query("UPDATE practices SET owner_user_id=$2 WHERE id=$1", [context.practice.id, targetUserId]);
    await audit(client, context.practice.id, context.userId, "practice.ownership_transferred", targetUserId);
    return { ownerUserId: targetUserId };
  });
}
export const practiceAccess = { getContext: getPracticeContext, authorizeLocation, onboard: onboardPractice, admin: getPracticeAdmin, createLocation, setLocationStatus, createInvitation, acceptInvitations, activateMember, suspendMember, revokeInvitation, transferOwnership };
