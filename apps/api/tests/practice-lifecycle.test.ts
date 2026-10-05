import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
const url = process.env.TEST_DATABASE_URL;

test("controlled onboarding and staff lifecycle recover safely from provider failures without replayed grants", { skip: !url }, async (context) => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname)); assert.equal(target.pathname, "/careiq_test"); assert.equal(target.search, "");
  const admin = new Pool({ connectionString: url, ssl: false });
  const role = `careiq_lifecycle_test_${randomBytes(6).toString("hex")}`, password = randomBytes(20).toString("hex");
  const owner = `owner_${randomUUID()}`, staff = `staff_${randomUUID()}`, wrong = `wrong_${randomUUID()}`;
  let runtime: Pool | undefined, createdRole = false, practiceId: string | undefined;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`); createdRole = true;
    await admin.query((await readFile(new URL("../src/db/grant-clinical-runtime.sql", import.meta.url), "utf8")).replace(/^\\set .*$/m, "").replace(":'runtime_role'", `'${role}'`));
    const runtimeUrl = new URL(target); runtimeUrl.username = role; runtimeUrl.password = password;
    process.env.DATABASE_URL = runtimeUrl.href; process.env.DATABASE_SSL_MODE = "disable";
    process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = owner; process.env.CAREIQ_STAFF_ROLES = "org:clinician";
    ({ pool: runtime } = await import("../src/db/client.js"));
    const { clerk } = await import("../src/services/clerk-directory.js");
    const service = await import("../src/services/practice-access.service.js");
    const { reconcilePracticeMember, reconcilePracticeInvitations } = await import("../src/services/practice-reconciliation.js");
    const organizations = new Map<string, any>(), memberships = new Map<string, any>(), invitations = new Map<string, any>();
    const errors = { createOrganizationOnce: true, createInvitationOnce: false, roleUpdateOnce: false };
    let organizationCreates = 0, invitationCreates = 0;
    const membership = (user: string, orgId: string, role: string, id = `mem_${randomUUID()}`) => ({ id, role, permissions: role === "org:clinician" ? ["org:patients:read", "org:patients:create"] : [], organization: { id: orgId }, publicUserData: { userId: user, identifier: `${user}@example.invalid`, firstName: "Synthetic", lastName: "Member" } });
    clerk.users.getUser = (async (userId: string) => ({ banned: false, locked: false, emailAddresses: [{ emailAddress: `${userId}@example.invalid`, verification: { status: "verified" } }] })) as any;
    clerk.organizations.getOrganization = (async ({ slug }: any) => { const value = organizations.get(slug); if (!value) throw Object.assign(new Error("Not found"), { status: 404 }); return value; }) as any;
    clerk.organizations.createOrganization = (async (input: any) => {
      organizationCreates++; const org = { id: `org_${randomUUID()}`, ...input }; organizations.set(input.slug, org); memberships.set(owner, membership(owner, org.id, "org:admin"));
      if (errors.createOrganizationOnce) { errors.createOrganizationOnce = false; throw new Error("Lost provider response"); } return org;
    }) as any;
    clerk.organizations.getOrganizationMembershipList = (async ({ organizationId, userId }: any) => ({ data: userId.map((id: string) => memberships.get(id)).filter((row: any) => row?.organization.id === organizationId), totalCount: 1 })) as any;
    clerk.organizations.updateOrganizationMembership = (async ({ userId, role }: any) => { if (errors.roleUpdateOnce) { errors.roleUpdateOnce = false; throw new Error("Provider unavailable"); } const old = memberships.get(userId); const value = membership(userId, old.organization.id, role, old.id); memberships.set(userId, value); return value; }) as any;
    clerk.organizations.getOrganizationInvitationList = (async ({ organizationId, offset = 0, limit = 100 }: any) => { const rows = [...invitations.values()].filter((row) => row.organizationId === organizationId); return { data: rows.slice(offset, offset + limit), totalCount: rows.length }; }) as any;
    clerk.organizations.createOrganizationInvitation = (async (input: any) => { invitationCreates++; const invitation = { id: `inv_${randomUUID()}`, ...input, status: "pending", expiresAt: Date.now() + 7 * 86400000 }; invitations.set(invitation.id, invitation); if (errors.createInvitationOnce) { errors.createInvitationOnce = false; throw new Error("Lost provider response"); } return invitation; }) as any;
    clerk.organizations.getOrganizationInvitation = (async ({ invitationId }: any) => { const invitation = invitations.get(invitationId); if (!invitation) throw new Error("Unexpected invitation"); return invitation; }) as any;
    clerk.organizations.revokeOrganizationInvitation = (async ({ invitationId }: any) => { const invitation = invitations.get(invitationId); invitation.status = "revoked"; return invitation; }) as any;
    const ownerAuth = { isAuthenticated: true, userId: owner, orgId: null as string | null, orgRole: "org:admin" };
    const input = { name: "Synthetic Practice", location: { name: "Main", timeZone: "America/Los_Angeles" } };
    let onboarding: any;
    await context.test("verified eligible actor resumes lost external success with a fresh transport key and cannot change founding payload", async () => {
      await assert.rejects(service.onboardPractice({ ...ownerAuth, userId: wrong }, input, randomUUID()), /ONBOARDING NOT ELIGIBLE/);
      await assert.rejects(service.onboardPractice(ownerAuth, input, randomUUID()), /Practice setup is pending/);
      onboarding = await service.onboardPractice(ownerAuth, input, randomUUID()); practiceId = onboarding.practice.id; ownerAuth.orgId = onboarding.orgId;
      assert.equal(organizationCreates, 1);
      assert.equal((await service.onboardPractice(ownerAuth, input, randomUUID())).practice!.id, practiceId);
      await assert.rejects(service.onboardPractice(ownerAuth, { ...input, name: "Changed" }, randomUUID()), /ONBOARDING RETRY CONFLICT/);
      const recovered = await service.getPracticeContext({ ...ownerAuth, orgId: null }); assert.equal((recovered as any).onboardingOrgId, onboarding.orgId);
      const me = await service.getPracticeContext(ownerAuth); assert.equal(me.capabilities.patients.read, false); assert.equal(me.locations.length, 0); assert.equal(me.management.members, true);
      await assert.rejects(service.authorizeLocation(ownerAuth, onboarding.location.id), /LOCATION ACCESS DENIED/);
    });
    let invitation: any, external: any;
    await context.test("ambiguous invitation delivery reconciles once, even when already accepted at Clerk", async () => {
      const key = randomUUID(); const body = { email: `${staff}@example.invalid`, role: "org:clinician", locationIds: [onboarding.location.id] };
      errors.createInvitationOnce = true;
      await assert.rejects(service.createInvitation(ownerAuth, body, key), /Invitation delivery is pending/);
      external = [...invitations.values()][0]; external.status = "accepted";
      invitation = await service.createInvitation(ownerAuth, body, key);
      assert.equal(invitationCreates, 1); assert.equal(invitation.status, "invited");
      await assert.rejects(service.createInvitation(ownerAuth, { ...body, role: "org:member" }, key), /IDEMPOTENCY KEY REUSED/);
    });
    const staffAuth = { isAuthenticated: true, userId: staff, orgId: "", orgRole: "org:clinician" };
    await context.test("recipient and current provider acceptance are required; acceptance alone grants no access", async () => {
      staffAuth.orgId = onboarding.orgId; memberships.set(staff, membership(staff, onboarding.orgId, "org:clinician")); memberships.set(wrong, membership(wrong, onboarding.orgId, "org:clinician"));
      await assert.rejects(service.acceptInvitations({ ...staffAuth, userId: wrong }), /ACCEPTED INVITATION REQUIRED/);
      external.status = "expired"; await assert.rejects(service.acceptInvitations(staffAuth), /ACCEPTED INVITATION REQUIRED/);
      external.status = "accepted"; assert.deepEqual(await service.acceptInvitations(staffAuth), { status: "pending_assignment" });
      await assert.rejects(service.authorizeLocation(staffAuth, onboarding.location.id), /ENROLLMENT REQUIRED/);
      await assert.rejects(service.getPracticeAdmin(staffAuth), /OWNER REQUIRED/);
      await service.activateMember(ownerAuth, staff, { role: "org:clinician", locationIds: [onboarding.location.id] });
      const context = await service.authorizeLocation(staffAuth, onboarding.location.id); assert.equal(context.capabilities.patients.create, true);
    });
    await context.test("failed provider role updates leave committed local denial; suspended acceptance replay cannot restore grants", async () => {
      errors.roleUpdateOnce = true;
      await assert.rejects(service.activateMember(ownerAuth, staff, { role: "org:member", locationIds: [onboarding.location.id] }), /ROLE UPDATE PENDING/);
      await assert.rejects(service.authorizeLocation(staffAuth, onboarding.location.id), /ENROLLMENT REQUIRED/);
      await service.acceptInvitations(staffAuth);
      assert.equal((await admin.query("SELECT status FROM practice_member_access WHERE practice_id=$1 AND user_id=$2", [practiceId, staff])).rows[0].status, "suspended");
      await service.activateMember(ownerAuth, staff, { role: "org:clinician", locationIds: [onboarding.location.id] });
      await assert.rejects(service.suspendMember(ownerAuth, owner), /OWNER TRANSFER REQUIRED/);
      await assert.rejects(service.activateMember(ownerAuth, owner, { role: "org:clinician", locationIds: [onboarding.location.id] }), /SELF ROLE CHANGE FORBIDDEN/);
    });
    await context.test("ownership transfer requires an active provider admin and immediately removes the prior owner's management authority", async () => {
      await assert.rejects(service.transferOwnership(ownerAuth, staff), /OWNER ROLE REQUIRED/);
      await service.activateMember(ownerAuth, staff, { role: "org:admin", locationIds: [onboarding.location.id] });
      await service.transferOwnership(ownerAuth, staff);
      await assert.rejects(service.getPracticeAdmin(ownerAuth), /OWNER REQUIRED/);
      await assert.rejects(service.suspendMember(staffAuth, staff), /OWNER TRANSFER REQUIRED/);
      await service.transferOwnership(staffAuth, owner);
      await service.activateMember(ownerAuth, staff, { role: "org:clinician", locationIds: [onboarding.location.id] });
    });
    await context.test("fresh provider removal denies stale sessions and replayed/out-of-order reconciliation cannot revive grants", async () => {
      const old = memberships.get(staff); memberships.delete(staff);
      await assert.rejects(service.authorizeLocation(staffAuth, onboarding.location.id), /ENROLLMENT REQUIRED/);
      const eventId = `evt_${randomUUID()}`; await reconcilePracticeMember(onboarding.orgId, staff, eventId); await reconcilePracticeMember(onboarding.orgId, staff, eventId);
      memberships.set(staff, { ...old, id: `new_${randomUUID()}` }); await reconcilePracticeMember(onboarding.orgId, staff, `late_${randomUUID()}`);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM practice_provider_events WHERE event_id=$1", [eventId])).rows[0].count, 1);
      assert.equal((await admin.query("SELECT status FROM practice_member_access WHERE practice_id=$1 AND user_id=$2", [practiceId, staff])).rows[0].status, "revoked");
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM location_assignments WHERE practice_id=$1 AND user_id=$2 AND active", [practiceId, staff])).rows[0].count, 0);
    });
    await context.test("invitation reconciliation expires pending links without enrolling or assigning the recipient", async () => {
      const created = await service.createInvitation(ownerAuth, { email: `expired_${staff}@example.invalid`, role: "org:member", locationIds: [] }, randomUUID());
      const provider = [...invitations.values()].find((item) => item.privateMetadata.careiqInvitationId === created.id);
      provider.expiresAt = Date.now() - 1000;
      await reconcilePracticeInvitations(onboarding.orgId); await reconcilePracticeInvitations(onboarding.orgId);
      assert.equal((await admin.query("SELECT status FROM practice_invitations WHERE id=$1", [created.id])).rows[0].status, "expired");
    });
    await context.test("revoking an uncertain send locates and revokes the provider invitation before reporting completion", async () => {
      errors.createInvitationOnce = true;
      await assert.rejects(service.createInvitation(ownerAuth, { email: `new_${staff}@example.invalid`, role: "org:member", locationIds: [] }, randomUUID()));
      const pending = (await admin.query("SELECT id FROM practice_invitations WHERE practice_id=$1 AND status='sending'", [practiceId])).rows[0];
      const provider = [...invitations.values()].find((item) => item.privateMetadata.careiqInvitationId === pending.id);
      await service.revokeInvitation(ownerAuth, pending.id); assert.equal(provider.status, "revoked");
      const row = (await admin.query("SELECT status,provider_revocation_pending FROM practice_invitations WHERE id=$1", [pending.id])).rows[0];
      assert.equal(row.status, "revoked"); assert.equal(row.provider_revocation_pending, false);
    });
  } finally {
    await runtime?.end();
    if (practiceId) {
      for (const table of ["practice_admin_events", "practice_provider_events", "practice_invitation_attempts", "practice_invitations", "location_assignments", "practice_member_access", "locations"]) await admin.query(`DELETE FROM ${table} WHERE practice_id=$1`, [practiceId]);
      await admin.query("DELETE FROM practice_onboarding WHERE actor_user_id=$1", [owner]);
      await admin.query("DELETE FROM practices WHERE id=$1", [practiceId]);
    } else await admin.query("DELETE FROM practice_onboarding WHERE actor_user_id=$1", [owner]);
    if (createdRole) { await admin.query(`DROP OWNED BY ${role}`); await admin.query(`DROP ROLE ${role}`); }
    await admin.end();
  }
});
