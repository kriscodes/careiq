import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
const url = isolatedTestDatabaseUrl();

test(
  'controlled onboarding and staff lifecycle recover safely from provider failures without replayed grants',
  { skip: !url },
  async (context) => {
    const target = new URL(url!);
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.equal(target.pathname, '/careiq_test');
    assert.equal(target.search, '');
    const admin = new Pool({ connectionString: url, ssl: false });
    const role = `careiq_lifecycle_test_${randomBytes(6).toString('hex')}`,
      password = randomBytes(20).toString('hex');
    const owner = `user_Owner${randomBytes(12).toString('hex')}`,
      staff = `user_Staff${randomBytes(12).toString('hex')}`,
      wrong = `user_Wrong${randomBytes(12).toString('hex')}`;
    let runtime: Pool | undefined,
      createdRole = false,
      practiceId: string | undefined;
    try {
      await admin.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      createdRole = true;
      await admin.query(
        (await readFile(new URL('../src/db/grant-clinical-runtime.sql', import.meta.url), 'utf8'))
          .replace(/^\\set .*$/m, '')
          .replace(":'runtime_role'", `'${role}'`),
      );
      const runtimeUrl = new URL(target);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      process.env.DATABASE_URL = runtimeUrl.href;
      process.env.DATABASE_SSL_MODE = 'disable';
      process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = owner;
      process.env.CAREIQ_STAFF_ROLES = 'org:clinician';
      ({ pool: runtime } = await import('../src/db/client.js'));
      const { clerk } = await import('../src/services/clerk-directory.js');
      const service = await import('../src/services/practice-access.service.js');
      const { reconcilePracticeMember, reconcilePracticeInvitations } =
        await import('../src/services/practice-reconciliation.js');
      const organizations = new Map<string, any>(),
        memberships = new Map<string, any>(),
        invitations = new Map<string, any>();
      const errors = {
        createOrganizationOnce: true,
        createInvitationOnce: false,
        roleUpdateOnce: false,
      };
      let organizationCreates = 0,
        invitationCreates = 0;
      const membership = (
        user: string,
        orgId: string,
        role: string,
        id = `mem_${randomUUID()}`,
      ) => ({
        id,
        role,
        permissions: role === 'org:clinician' ? ['org:patients:read', 'org:patients:create'] : [],
        organization: { id: orgId },
        publicUserData: {
          userId: user,
          identifier: `${user}@example.invalid`,
          firstName: 'Synthetic',
          lastName: 'Member',
        },
      });
      clerk.users.getUser = (async (userId: string) => ({
        banned: false,
        locked: false,
        emailAddresses: [
          {
            emailAddress: `${userId}@example.invalid`,
            verification: { status: userId === 'unverified' ? 'unverified' : 'verified' },
          },
        ],
      })) as any;
      clerk.organizations.getOrganization = (async ({ slug }: any) => {
        const value = organizations.get(slug);
        if (!value) {
          throw Object.assign(new Error('Not found'), { status: 404 });
        }
        return value;
      }) as any;
      clerk.organizations.createOrganization = (async (input: any) => {
        organizationCreates++;
        const org = { id: `org_${randomUUID()}`, ...input };
        organizations.set(input.slug, org);
        memberships.set(owner, membership(owner, org.id, 'org:admin'));
        if (errors.createOrganizationOnce) {
          errors.createOrganizationOnce = false;
          throw new Error('Lost provider response');
        }
        return org;
      }) as any;
      clerk.organizations.getOrganizationMembershipList = (async ({
        organizationId,
        userId,
      }: any) => ({
        data: userId
          .map((id: string) => memberships.get(id))
          .filter((row: any) => row?.organization.id === organizationId),
        totalCount: 1,
      })) as any;
      clerk.organizations.updateOrganizationMembership = (async ({ userId, role }: any) => {
        if (errors.roleUpdateOnce) {
          errors.roleUpdateOnce = false;
          throw new Error('Provider unavailable');
        }
        const old = memberships.get(userId);
        const value = membership(userId, old.organization.id, role, old.id);
        memberships.set(userId, value);
        return value;
      }) as any;
      clerk.organizations.getOrganizationInvitationList = (async ({
        organizationId,
        offset = 0,
        limit = 100,
      }: any) => {
        const rows = [...invitations.values()].filter(
          (row) => row.organizationId === organizationId,
        );
        return { data: rows.slice(offset, offset + limit), totalCount: rows.length };
      }) as any;
      clerk.organizations.createOrganizationInvitation = (async (input: any) => {
        invitationCreates++;
        const invitation = {
          id: `inv_${randomUUID()}`,
          ...input,
          status: 'pending',
          expiresAt: Date.now() + 7 * 86400000,
        };
        invitations.set(invitation.id, invitation);
        if (errors.createInvitationOnce) {
          errors.createInvitationOnce = false;
          throw new Error('Lost provider response');
        }
        return invitation;
      }) as any;
      clerk.organizations.getOrganizationInvitation = (async ({ invitationId }: any) => {
        const invitation = invitations.get(invitationId);
        if (!invitation) {
          throw new Error('Unexpected invitation');
        }
        return invitation;
      }) as any;
      clerk.organizations.revokeOrganizationInvitation = (async ({ invitationId }: any) => {
        const invitation = invitations.get(invitationId);
        invitation.status = 'revoked';
        return invitation;
      }) as any;
      // Model archive preparation on a separate connection while the real service
      // operation waits on the same account-scoped advisory lock. No provider call.
      async function concurrentArchive(userId: string, operation: () => Promise<unknown>) {
        const blocker = await admin.connect();
        let transactionOpen = false;
        try {
          await blocker.query('BEGIN');
          transactionOpen = true;
          await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `account-lifecycle:${userId}`,
          ]);
          await blocker.query(
            "INSERT INTO personal_account_lifecycle(user_id,status,archive_session_id) VALUES($1,'archiving','sess_SyntheticArchiveRace')",
            [userId],
          );
          const pending = operation().then(
            (value) => ({ value, error: null as any }),
            (error) => ({ value: undefined, error }),
          );
          let waiting = false;
          for (let attempt = 0; attempt < 150 && !waiting; attempt++) {
            waiting = (
              await admin.query(
                "SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.usename=$1) AS waiting",
                [role],
              )
            ).rows[0].waiting;
            if (!waiting) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          await blocker.query('COMMIT');
          transactionOpen = false;
          const result = await pending;
          assert.equal(
            waiting,
            true,
            "The practice operation must wait for archive's account lock.",
          );
          assert.equal(result.error?.code, 'ACCOUNT_ARCHIVED');
          assert.equal(result.error?.status, 403);
        } finally {
          if (transactionOpen) {
            await blocker.query('ROLLBACK');
          }
          blocker.release();
        }
      }
      const ownerAuth = {
        isAuthenticated: true,
        userId: owner,
        orgId: null as string | null,
        orgRole: 'org:admin',
      };
      const input = {
        name: 'Synthetic Practice',
        location: { name: 'Main', timeZone: 'America/Los_Angeles' },
      };
      const confirmation = (userId: string) => ({
        userId,
        practiceId: practiceId!,
        confirmationName: input.name,
        acknowledgedUserId: userId,
      });
      const setup = await import('../src/services/onboarding-state.service.js');
      const { practiceTransaction } = await import('../src/db/practice-transaction.js');
      await context.test(
        'drafts persist across reads, require verified founders, and deny another actor under runtime RLS',
        async () => {
          assert.deepEqual(await setup.getOnboardingState(ownerAuth), {
            eligible: true,
            emailVerified: true,
            draft: null,
            operation: null,
          });
          const draft = {
            practiceName: 'Synthetic Practice',
            locationName: '',
            timeZone: 'America/Los_Angeles',
            address: '',
            step: 2 as const,
          };
          assert.deepEqual(await setup.saveOnboardingDraft(ownerAuth, draft), draft);
          assert.deepEqual((await setup.getOnboardingState(ownerAuth)).draft, draft);
          assert.deepEqual(
            (await setup.getOnboardingState({ ...ownerAuth, userId: wrong })).draft,
            null,
          );
          await assert.rejects(
            setup.saveOnboardingDraft({ ...ownerAuth, userId: wrong }, draft),
            /ONBOARDING NOT ELIGIBLE/,
          );
          await assert.rejects(
            setup.saveOnboardingDraft({ ...ownerAuth, userId: 'unverified' }, draft),
            /VERIFIED EMAIL REQUIRED/,
          );
          const concealed = await practiceTransaction(null, wrong, async (client) =>
            client.query('SELECT * FROM onboarding_drafts WHERE actor_user_id=$1', [owner]),
          );
          assert.equal(concealed.rowCount, 0);
          await assert.rejects(
            practiceTransaction(null, wrong, async (client) =>
              client.query('INSERT INTO onboarding_drafts(actor_user_id) VALUES($1)', [owner]),
            ),
            /row-level security/,
          );
          assert.equal((await runtime!.query('SELECT * FROM onboarding_drafts')).rowCount, 0);
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM practice_onboarding WHERE actor_user_id=$1',
                [owner],
              )
            ).rows[0].count,
            0,
          );
        },
      );
      await context.test(
        'an archived approved founder cannot create its first provider organization or practice',
        async () => {
          const founder = `user_ArchivedFounder${randomBytes(12).toString('hex')}`;
          const configured = process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS;
          process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = `${owner},${founder}`;
          const before = organizationCreates;
          try {
            await admin.query(
              "INSERT INTO personal_account_lifecycle(user_id,status,archive_session_id) VALUES($1,'archived','sess_SyntheticArchivedFounder')",
              [founder],
            );
            await assert.rejects(
              service.onboardPractice({ ...ownerAuth, userId: founder }, input, randomUUID()),
              (error: any) => error.code === 'ACCOUNT_ARCHIVED' && error.status === 403,
            );
            assert.equal(organizationCreates, before);
            assert.equal(
              (
                await admin.query(
                  'SELECT count(*)::int AS count FROM practices WHERE owner_user_id=$1',
                  [founder],
                )
              ).rows[0].count,
              0,
            );
          } finally {
            process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = configured;
            await admin.query('DELETE FROM onboarding_drafts WHERE actor_user_id=$1', [founder]);
            await admin.query('DELETE FROM practice_onboarding WHERE actor_user_id=$1', [founder]);
            await admin.query('DELETE FROM personal_account_lifecycle WHERE user_id=$1', [founder]);
          }
        },
      );
      await context.test(
        'concurrent archive blocks first-practice provisioning before any provider organization is created',
        async () => {
          const founder = `user_RacingFounder${randomBytes(12).toString('hex')}`;
          const configured = process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS;
          process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = `${owner},${founder}`;
          const before = organizationCreates;
          try {
            await concurrentArchive(founder, () =>
              service.onboardPractice({ ...ownerAuth, userId: founder }, input, randomUUID()),
            );
            assert.equal(organizationCreates, before);
            assert.equal(
              (
                await admin.query(
                  'SELECT count(*)::int AS count FROM practices WHERE owner_user_id=$1',
                  [founder],
                )
              ).rows[0].count,
              0,
            );
          } finally {
            process.env.CAREIQ_PRACTICE_CREATOR_USER_IDS = configured;
            await admin.query('DELETE FROM onboarding_drafts WHERE actor_user_id=$1', [founder]);
            await admin.query('DELETE FROM practice_onboarding WHERE actor_user_id=$1', [founder]);
            await admin.query('DELETE FROM personal_account_lifecycle WHERE user_id=$1', [founder]);
          }
        },
      );
      let onboarding: any;
      await context.test(
        'verified eligible actor resumes lost external success with a fresh transport key and cannot change founding payload',
        async () => {
          await assert.rejects(
            service.onboardPractice({ ...ownerAuth, userId: wrong }, input, randomUUID()),
            /ONBOARDING NOT ELIGIBLE/,
          );
          await assert.rejects(
            service.onboardPractice(ownerAuth, input, randomUUID()),
            /Practice setup is pending/,
          );
          const pending = await setup.getOnboardingState(ownerAuth);
          assert.equal(pending.operation?.state, 'pending');
          assert.deepEqual(pending.draft, {
            practiceName: input.name,
            locationName: input.location.name,
            timeZone: input.location.timeZone,
            address: '',
            step: 3,
          });
          await assert.rejects(
            setup.saveOnboardingDraft(ownerAuth, { ...pending.draft!, practiceName: 'Changed' }),
            /Practice setup was already submitted/,
          );
          onboarding = await service.onboardPractice(ownerAuth, input, randomUUID());
          practiceId = onboarding.practice.id;
          ownerAuth.orgId = onboarding.orgId;
          assert.deepEqual((await setup.getOnboardingState(ownerAuth)).operation, {
            state: 'complete',
            practiceId,
            organizationId: onboarding.orgId,
          });
          await assert.rejects(
            setup.saveOnboardingDraft(ownerAuth, pending.draft!),
            /Practice setup was already submitted/,
          );
          assert.equal(organizationCreates, 1);
          assert.equal(
            (await service.onboardPractice(ownerAuth, input, randomUUID())).practice!.id,
            practiceId,
          );
          await assert.rejects(
            service.onboardPractice(ownerAuth, { ...input, name: 'Changed' }, randomUUID()),
            /ONBOARDING RETRY CONFLICT/,
          );
          const recovered = await service.getPracticeContext({ ...ownerAuth, orgId: null });
          assert.equal((recovered as any).onboardingOrgId, onboarding.orgId);
          const me = await service.getPracticeContext(ownerAuth);
          assert.equal(me.capabilities.patients.read, true);
          assert.equal(me.locations.length, 1);
          assert.equal(me.management.members, true);
          assert.equal(
            (await service.authorizeLocation(ownerAuth, onboarding.location.id)).ownerOperator,
            true,
          );
        },
      );
      await context.test(
        'owner location narrowing preserves its operator permissions and provider role',
        async () => {
          const before = await service.getPracticeContext(ownerAuth);
          assert.equal(before.locations.length, 1);
          await service.activateMember(ownerAuth, owner, {
            role: 'org:admin',
            locationIds: [onboarding.location.id],
          });
          const assigned = await service.getPracticeContext(ownerAuth);
          assert.equal(assigned.locations.length, 1);
          assert.equal(assigned.capabilities.patients.read, true);
          assert.deepEqual(assigned.workspaceCapabilities, {
            patientsRead: true,
            appointmentsRead: true,
            documentsRead: true,
            configurationManage: true,
          });
          assert.ok('ownerAccess' in assigned);
          assert.equal(assigned.ownerAccess?.allLocations, false);
          assert.equal(
            (await service.authorizeLocation(ownerAuth, onboarding.location.id)).tenant.locationId,
            onboarding.location.id,
          );
          assert.equal(memberships.get(owner).role, 'org:admin');
        },
      );
      await context.test(
        'owner operator access can be narrowed and restored without losing management, including explicit provider-grant denials',
        async () => {
          const { OWNER_OPERATOR_PERMISSIONS } =
            await import('../src/services/owner-operator-policy.js');
          const { workflowCapabilities } = await import('../src/routes/workflow.js');
          const adminState = await service.getPracticeAdmin(ownerAuth);
          const restored = await service.updateOwnerAccess(ownerAuth, {
            disabledPermissions: [],
            allLocations: true,
            locationIds: [],
            revision: adminState.ownerAccess.revision,
          });
          const second = await service.createLocation(ownerAuth, {
            name: 'Operator additional location',
            timeZone: 'America/New_York',
          });
          const enabled = await service.getPracticeContext(ownerAuth);
          assert.equal(enabled.locations.length, 2);
          const full = await service.authorizeLocation(ownerAuth, second.id);
          assert.deepEqual(new Set(full.permissions), new Set(OWNER_OPERATOR_PERMISSIONS));
          assert.ok(
            Object.values(
              workflowCapabilities(
                ownerAuth,
                full.capabilities,
                full.permissions,
                full.ownerOperator,
              ),
            ).every(Boolean),
          );
          const rawOwner = memberships.get(owner);
          memberships.set(owner, {
            ...rawOwner,
            permissions: ['org:patients:read', 'org:documents:read', 'org:paperwork:manage'],
          });
          try {
            const disabled = [...OWNER_OPERATOR_PERMISSIONS];
            const profile = await service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: disabled,
              allLocations: true,
              locationIds: [],
              revision: restored.revision,
            });
            const scope = await service.authorizeLocation(ownerAuth, onboarding.location.id);
            assert.deepEqual(scope.permissions, []);
            assert.equal(scope.capabilities.patients.read, false);
            assert.ok(
              Object.values(
                workflowCapabilities(
                  { ...ownerAuth, has: () => true },
                  scope.capabilities,
                  scope.permissions,
                  scope.ownerOperator,
                ),
              ).every((value) => !value),
            );
            const limited = await service.getPracticeContext(ownerAuth);
            assert.equal(limited.management.members, true);
            assert.equal(limited.management.locations, true);
            assert.equal(
              (await service.getPracticeAdmin(ownerAuth)).ownerAccess.revision,
              profile.revision,
            );
            await assert.rejects(
              service.updateOwnerAccess(ownerAuth, {
                disabledPermissions: [],
                allLocations: true,
                locationIds: [],
                revision: restored.revision,
              }),
              (error: any) => error.code === 'OWNER_ACCESS_CHANGED' && error.status === 409,
            );
            const noLocations = await service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: disabled,
              allLocations: false,
              locationIds: [],
              revision: profile.revision,
            });
            assert.deepEqual((await service.getPracticeContext(ownerAuth)).locations, []);
            await assert.rejects(
              service.authorizeLocation(ownerAuth, second.id),
              /LOCATION ACCESS DENIED/,
            );
            assert.equal(
              (await service.getPracticeAdmin(ownerAuth)).ownerAccess.revision,
              noLocations.revision,
            );
            const enabledAgain = await service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: [],
              allLocations: true,
              locationIds: [],
              revision: noLocations.revision,
            });
            const third = await service.createLocation(ownerAuth, {
              name: 'Future owner location',
              timeZone: 'America/Phoenix',
            });
            assert.ok(
              (await service.getPracticeContext(ownerAuth)).locations.some(
                (location) => location.id === third.id,
              ),
            );
            await service.setLocationStatus(ownerAuth, third.id, 'closed');
            await assert.rejects(
              service.authorizeLocation(ownerAuth, third.id),
              /LOCATION ACCESS DENIED/,
            );
            await service.setLocationStatus(ownerAuth, third.id, 'active');
            assert.equal(
              (await service.authorizeLocation(ownerAuth, third.id)).ownerOperator,
              true,
            );
            const narrowed = await service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: [],
              allLocations: false,
              locationIds: [onboarding.location.id],
              revision: enabledAgain.revision,
            });
            const fourth = await service.createLocation(ownerAuth, {
              name: 'Unselected new location',
              timeZone: 'America/Chicago',
            });
            await assert.rejects(
              service.authorizeLocation(ownerAuth, fourth.id),
              /LOCATION ACCESS DENIED/,
            );
            await service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: [],
              allLocations: true,
              locationIds: [],
              revision: narrowed.revision,
            });
          } finally {
            memberships.set(owner, rawOwner);
          }
        },
      );
      await context.test(
        'owner access input is actor-bound, bounded, revision-checked and rejects foreign or closed locations',
        async () => {
          const profile = (await service.getPracticeAdmin(ownerAuth)).ownerAccess;
          const valid = {
            disabledPermissions: [],
            allLocations: false,
            locationIds: [onboarding.location.id],
            revision: profile.revision,
          };
          for (const changed of [
            { ...valid, userId: wrong },
            { ...valid, disabledPermissions: ['org:audit:read'] },
            { ...valid, disabledPermissions: ['org:patients:read', 'org:patients:read'] },
            { ...valid, allLocations: 'true' },
            { ...valid, revision: -1 },
          ]) {
            await assert.rejects(
              service.updateOwnerAccess(ownerAuth, changed),
              (error: any) => error.code === 'INVALID_OWNER_ACCESS',
            );
          }
          await assert.rejects(
            service.updateOwnerAccess(ownerAuth, { ...valid, locationIds: [randomUUID()] }),
            (error: any) => error.code === 'INVALID_LOCATIONS',
          );
          const closed = await service.createLocation(ownerAuth, {
            name: 'Closed owner location',
            timeZone: 'UTC',
          });
          await service.setLocationStatus(ownerAuth, closed.id, 'closed');
          await assert.rejects(
            service.updateOwnerAccess(ownerAuth, { ...valid, locationIds: [closed.id] }),
            (error: any) => error.code === 'INVALID_LOCATIONS',
          );
          assert.equal(
            (await service.getPracticeAdmin(ownerAuth)).ownerAccess.revision,
            profile.revision,
          );
        },
      );
      let invitation: any, external: any;
      await context.test(
        'ambiguous invitation delivery reconciles once, even when already accepted at Clerk',
        async () => {
          const key = randomUUID();
          const body = {
            email: `${staff}@example.invalid`,
            role: 'org:clinician',
            locationIds: [onboarding.location.id],
          };
          errors.createInvitationOnce = true;
          await assert.rejects(
            service.createInvitation(ownerAuth, body, key),
            /Invitation delivery is pending/,
          );
          external = [...invitations.values()][0];
          external.status = 'accepted';
          invitation = await service.createInvitation(ownerAuth, body, key);
          assert.equal(invitationCreates, 1);
          assert.equal(invitation.status, 'invited');
          await assert.rejects(
            service.createInvitation(ownerAuth, { ...body, role: 'org:member' }, key),
            /IDEMPOTENCY KEY REUSED/,
          );
        },
      );
      const staffAuth = {
        isAuthenticated: true,
        userId: staff,
        orgId: '',
        orgRole: 'org:clinician',
      };
      await context.test(
        'recipient and current provider acceptance are required; acceptance alone grants no access',
        async () => {
          staffAuth.orgId = onboarding.orgId;
          memberships.set(staff, membership(staff, onboarding.orgId, 'org:clinician'));
          memberships.set(wrong, membership(wrong, onboarding.orgId, 'org:clinician'));
          await assert.rejects(
            service.acceptInvitations({ ...staffAuth, userId: wrong }),
            /ACCEPTED INVITATION REQUIRED/,
          );
          external.status = 'expired';
          await assert.rejects(
            service.acceptInvitations(staffAuth),
            /ACCEPTED INVITATION REQUIRED/,
          );
          external.status = 'accepted';
          assert.deepEqual(await service.acceptInvitations(staffAuth), {
            status: 'pending_assignment',
          });
          await assert.rejects(
            service.authorizeLocation(staffAuth, onboarding.location.id),
            /ENROLLMENT REQUIRED/,
          );
          await assert.rejects(service.getPracticeAdmin(staffAuth), /OWNER REQUIRED/);
          await service.activateMember(ownerAuth, staff, {
            role: 'org:clinician',
            locationIds: [onboarding.location.id],
          });
          const context = await service.authorizeLocation(staffAuth, onboarding.location.id);
          assert.equal(context.capabilities.patients.create, true);
        },
      );
      for (const grant of [
        { role: 'org:admin', permissions: [] as string[], read: false, create: false },
        { role: 'org:member', permissions: ['org:patients:read'], read: true, create: false },
        { role: 'org:member', permissions: ['org:documents:read'], read: false, create: false },
        { role: 'org:member', permissions: ['org:workflow:configure'], read: false, create: false },
        {
          role: 'org:clinician',
          permissions: ['org:patients:read', 'org:patients:create'],
          read: true,
          create: true,
        },
      ]) {
        await context.test(
          `${grant.role} (${grant.permissions.join(',') || 'management only'}) invitation requires verified acceptance, owner activation and location assignment; permissions remain explicit`,
          async () => {
            const recipient = `matrix_${randomUUID()}`;
            const principal = {
              isAuthenticated: true,
              userId: recipient,
              orgId: onboarding.orgId,
              orgRole: grant.role,
            };
            const issued = await service.createInvitation(
              ownerAuth,
              {
                email: `${recipient}@example.invalid`,
                role: grant.role,
                locationIds: [onboarding.location.id],
              },
              randomUUID(),
            );
            const provider = [...invitations.values()].find(
              (item) => item.privateMetadata.careiqInvitationId === issued.id,
            );
            memberships.set(recipient, {
              ...membership(recipient, onboarding.orgId, grant.role),
              permissions: grant.permissions,
            });
            await assert.rejects(
              service.acceptInvitations(principal),
              /ACCEPTED INVITATION REQUIRED/,
            );
            provider.status = 'accepted';
            assert.deepEqual(await service.acceptInvitations(principal), {
              status: 'pending_assignment',
            });
            const pending = await service.getPracticeContext(principal);
            assert.equal(pending.enrollmentStatus, 'pending_assignment');
            assert.equal(pending.management.members, false);
            assert.equal(pending.capabilities.patients.read, false);
            assert.deepEqual(pending.workspaceCapabilities, {
              patientsRead: false,
              appointmentsRead: false,
              documentsRead: false,
              configurationManage: false,
            });
            assert.deepEqual(pending.locations, []);
            await assert.rejects(
              service.authorizeLocation(principal, onboarding.location.id),
              /ENROLLMENT REQUIRED/,
            );
            await service.activateMember(ownerAuth, recipient, {
              role: grant.role,
              locationIds: [],
            });
            assert.deepEqual((await service.getPracticeContext(principal)).locations, []);
            await assert.rejects(
              service.authorizeLocation(principal, onboarding.location.id),
              /LOCATION ACCESS DENIED/,
            );
            await service.activateMember(ownerAuth, recipient, {
              role: grant.role,
              locationIds: [onboarding.location.id],
            });
            const scoped = await service.authorizeLocation(principal, onboarding.location.id);
            assert.equal(scoped.capabilities.patients.read, grant.read);
            assert.equal(scoped.capabilities.patients.create, grant.create);
            assert.deepEqual(scoped.permissions, grant.permissions);
            const home = await service.getPracticeContext(principal);
            assert.equal(home.management.members, false);
            assert.deepEqual(home.workspaceCapabilities, {
              patientsRead: grant.permissions.includes('org:patients:read'),
              appointmentsRead: grant.permissions.includes('org:appointments:read'),
              documentsRead: grant.permissions.includes('org:documents:read'),
              configurationManage: grant.permissions.includes('org:workflow:configure'),
            });
            await assert.rejects(service.getPracticeAdmin(principal), /OWNER REQUIRED/);
            await service.suspendMember(ownerAuth, recipient);
            assert.deepEqual((await service.getPracticeContext(principal)).workspaceCapabilities, {
              patientsRead: false,
              appointmentsRead: false,
              documentsRead: false,
              configurationManage: false,
            });
            await service.acceptInvitations(principal);
            await assert.rejects(
              service.authorizeLocation(principal, onboarding.location.id),
              /ENROLLMENT REQUIRED/,
            );
          },
        );
      }
      await context.test(
        'unconfigured staff roles cannot be introduced by an invitation payload',
        async () => {
          await assert.rejects(
            service.createInvitation(
              ownerAuth,
              {
                email: `unconfigured_${randomUUID()}@example.invalid`,
                role: 'org:unconfigured',
                locationIds: [],
              },
              randomUUID(),
            ),
            /ROLE NOT ALLOWED/,
          );
        },
      );
      await context.test(
        'failed provider role updates leave committed local denial; suspended acceptance replay cannot restore grants',
        async () => {
          errors.roleUpdateOnce = true;
          await assert.rejects(
            service.activateMember(ownerAuth, staff, {
              role: 'org:member',
              locationIds: [onboarding.location.id],
            }),
            /ROLE UPDATE PENDING/,
          );
          await assert.rejects(
            service.authorizeLocation(staffAuth, onboarding.location.id),
            /ENROLLMENT REQUIRED/,
          );
          await service.acceptInvitations(staffAuth);
          assert.equal(
            (
              await admin.query(
                'SELECT status FROM practice_member_access WHERE practice_id=$1 AND user_id=$2',
                [practiceId, staff],
              )
            ).rows[0].status,
            'suspended',
          );
          await service.activateMember(ownerAuth, staff, {
            role: 'org:clinician',
            locationIds: [onboarding.location.id],
          });
          await assert.rejects(service.suspendMember(ownerAuth, owner), /OWNER TRANSFER REQUIRED/);
          await assert.rejects(
            service.activateMember(ownerAuth, owner, {
              role: 'org:clinician',
              locationIds: [onboarding.location.id],
            }),
            /SELF ROLE CHANGE FORBIDDEN/,
          );
        },
      );
      await context.test(
        'ownership confirmation rejects bypasses, stale practice identity and a changed recipient without mutation or success audit',
        async () => {
          for (const malformed of [
            undefined,
            null,
            staff,
            [],
            {},
            { userId: staff },
            { ...confirmation(staff), confirmationName: null },
            { ...confirmation(staff), acknowledgedUserId: false },
          ]) {
            await assert.rejects(
              service.transferOwnership(ownerAuth, malformed),
              (error: any) =>
                error.code === 'OWNERSHIP_CONFIRMATION_REQUIRED' && error.status === 400,
            );
          }
          for (const malformed of [
            { ...confirmation(staff), unexpected: true },
            ...Object.entries({
              userId: 129,
              practiceId: 37,
              confirmationName: 121,
              acknowledgedUserId: 129,
            }).map(([key, length]) => ({ ...confirmation(staff), [key]: 'a'.repeat(length) })),
          ]) {
            await assert.rejects(
              service.transferOwnership(ownerAuth, malformed),
              (error: any) => error.code === 'INVALID_REQUEST' && error.status === 400,
            );
          }
          for (const changed of [
            { ...confirmation(staff), confirmationName: input.name.toLowerCase() },
            { ...confirmation(staff), confirmationName: ` ${input.name}` },
            { ...confirmation(staff), practiceId: randomUUID() },
            { ...confirmation(staff), acknowledgedUserId: wrong },
          ]) {
            await assert.rejects(
              service.transferOwnership(ownerAuth, changed),
              (error: any) =>
                error.code === 'OWNERSHIP_CONFIRMATION_MISMATCH' && error.status === 409,
            );
          }
          await admin.query("UPDATE practices SET name='Renamed synthetic practice' WHERE id=$1", [
            practiceId,
          ]);
          try {
            await assert.rejects(
              service.transferOwnership(ownerAuth, confirmation(staff)),
              (error: any) => error.code === 'OWNERSHIP_CONFIRMATION_MISMATCH',
            );
          } finally {
            await admin.query('UPDATE practices SET name=$2 WHERE id=$1', [practiceId, input.name]);
          }
          assert.equal(
            (await admin.query('SELECT owner_user_id FROM practices WHERE id=$1', [practiceId]))
              .rows[0].owner_user_id,
            owner,
          );
          assert.equal(
            (
              await admin.query(
                "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
                [practiceId],
              )
            ).rows[0].count,
            0,
          );
        },
      );
      await context.test(
        'archived, archiving and restoring recipients cannot acquire practice ownership',
        async () => {
          await service.activateMember(ownerAuth, staff, {
            role: 'org:admin',
            locationIds: [onboarding.location.id],
          });
          const before = (
            await admin.query(
              "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
              [practiceId],
            )
          ).rows[0].count;
          try {
            for (const status of ['archived', 'archiving', 'restoring']) {
              await admin.query(
                "INSERT INTO personal_account_lifecycle(user_id,status,archive_session_id) VALUES($1,$2,'sess_SyntheticArchivedRecipient') ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status",
                [staff, status],
              );
              await assert.rejects(
                service.transferOwnership(ownerAuth, confirmation(staff)),
                (error: any) => error.code === 'ACCOUNT_ARCHIVED' && error.status === 403,
              );
            }
            assert.equal(
              (await admin.query('SELECT owner_user_id FROM practices WHERE id=$1', [practiceId]))
                .rows[0].owner_user_id,
              owner,
            );
            assert.equal(
              (
                await admin.query(
                  "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
                  [practiceId],
                )
              ).rows[0].count,
              before,
            );
          } finally {
            await admin.query('DELETE FROM personal_account_lifecycle WHERE user_id=$1', [staff]);
            await service.activateMember(ownerAuth, staff, {
              role: 'org:clinician',
              locationIds: [onboarding.location.id],
            });
          }
        },
      );
      await context.test(
        'an archive racing ownership transfer wins before the recipient can become an owner',
        async () => {
          await service.activateMember(ownerAuth, staff, {
            role: 'org:admin',
            locationIds: [onboarding.location.id],
          });
          const before = (
            await admin.query(
              "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
              [practiceId],
            )
          ).rows[0].count;
          try {
            await concurrentArchive(staff, () =>
              service.transferOwnership(ownerAuth, confirmation(staff)),
            );
            assert.equal(
              (await admin.query('SELECT owner_user_id FROM practices WHERE id=$1', [practiceId]))
                .rows[0].owner_user_id,
              owner,
            );
            assert.equal(
              (
                await admin.query(
                  "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
                  [practiceId],
                )
              ).rows[0].count,
              before,
            );
          } finally {
            await admin.query('DELETE FROM personal_account_lifecycle WHERE user_id=$1', [staff]);
            await service.activateMember(ownerAuth, staff, {
              role: 'org:clinician',
              locationIds: [onboarding.location.id],
            });
          }
        },
      );
      await context.test(
        "ownership transfer requires an active provider admin and immediately removes the prior owner's management authority",
        async () => {
          await assert.rejects(
            service.transferOwnership(ownerAuth, confirmation(staff)),
            /OWNER ROLE REQUIRED/,
          );
          await service.activateMember(ownerAuth, staff, {
            role: 'org:admin',
            locationIds: [onboarding.location.id],
          });
          await service.suspendMember(ownerAuth, staff);
          await assert.rejects(
            service.transferOwnership(ownerAuth, confirmation(staff)),
            /ENROLLMENT REQUIRED/,
          );
          await service.activateMember(ownerAuth, staff, {
            role: 'org:admin',
            locationIds: [onboarding.location.id],
          });
          const { OWNER_OPERATOR_PERMISSIONS } =
            await import('../src/services/owner-operator-policy.js');
          const oldAccess = (await service.getPracticeAdmin(ownerAuth)).ownerAccess;
          await service.updateOwnerAccess(ownerAuth, {
            disabledPermissions: ['org:documents:read'],
            allLocations: false,
            locationIds: [onboarding.location.id],
            revision: oldAccess.revision,
          });
          await service.transferOwnership(ownerAuth, confirmation(staff));
          const former = await service.authorizeLocation(ownerAuth, onboarding.location.id);
          assert.equal(former.ownerOperator, false);
          assert.deepEqual(former.permissions, []);
          const incoming = await service.authorizeLocation(staffAuth, onboarding.location.id);
          assert.equal(incoming.ownerOperator, true);
          assert.deepEqual(new Set(incoming.permissions), new Set(OWNER_OPERATOR_PERMISSIONS));
          assert.deepEqual(
            (await service.getPracticeAdmin(staffAuth)).ownerAccess.disabledPermissions,
            [],
          );
          await assert.rejects(
            service.updateOwnerAccess(ownerAuth, {
              disabledPermissions: [],
              allLocations: true,
              locationIds: [],
              revision: oldAccess.revision,
            }),
            /OWNER REQUIRED/,
          );
          await assert.rejects(service.getPracticeAdmin(ownerAuth), /OWNER REQUIRED/);
          await assert.rejects(
            service.transferOwnership(ownerAuth, confirmation(staff)),
            /OWNER REQUIRED/,
          );
          await assert.rejects(service.suspendMember(staffAuth, staff), /OWNER TRANSFER REQUIRED/);
          await service.transferOwnership(staffAuth, confirmation(owner));
          assert.deepEqual(
            (await service.getPracticeAdmin(ownerAuth)).ownerAccess.disabledPermissions,
            [],
          );
          assert.equal((await service.getPracticeAdmin(ownerAuth)).ownerAccess.allLocations, true);
          assert.equal(
            (
              await admin.query(
                "SELECT count(*)::int AS count FROM practice_admin_events WHERE practice_id=$1 AND action='practice.ownership_transferred'",
                [practiceId],
              )
            ).rows[0].count,
            2,
          );
          await service.activateMember(ownerAuth, staff, {
            role: 'org:clinician',
            locationIds: [onboarding.location.id],
          });
        },
      );
      await context.test(
        'fresh provider removal denies stale sessions and replayed/out-of-order reconciliation cannot revive grants',
        async () => {
          const old = memberships.get(staff);
          memberships.delete(staff);
          await assert.rejects(
            service.authorizeLocation(staffAuth, onboarding.location.id),
            /ENROLLMENT REQUIRED/,
          );
          const eventId = `evt_${randomUUID()}`;
          await reconcilePracticeMember(onboarding.orgId, staff, eventId);
          await reconcilePracticeMember(onboarding.orgId, staff, eventId);
          memberships.set(staff, { ...old, id: `new_${randomUUID()}` });
          await reconcilePracticeMember(onboarding.orgId, staff, `late_${randomUUID()}`);
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM practice_provider_events WHERE event_id=$1',
                [eventId],
              )
            ).rows[0].count,
            1,
          );
          assert.equal(
            (
              await admin.query(
                'SELECT status FROM practice_member_access WHERE practice_id=$1 AND user_id=$2',
                [practiceId, staff],
              )
            ).rows[0].status,
            'revoked',
          );
          assert.equal(
            (
              await admin.query(
                'SELECT count(*)::int AS count FROM location_assignments WHERE practice_id=$1 AND user_id=$2 AND active',
                [practiceId, staff],
              )
            ).rows[0].count,
            0,
          );
        },
      );
      await context.test(
        'invitation reconciliation expires pending links without enrolling or assigning the recipient',
        async () => {
          const created = await service.createInvitation(
            ownerAuth,
            { email: `expired_${staff}@example.invalid`, role: 'org:member', locationIds: [] },
            randomUUID(),
          );
          const provider = [...invitations.values()].find(
            (item) => item.privateMetadata.careiqInvitationId === created.id,
          );
          provider.expiresAt = Date.now() - 1000;
          await reconcilePracticeInvitations(onboarding.orgId);
          await reconcilePracticeInvitations(onboarding.orgId);
          assert.equal(
            (await admin.query('SELECT status FROM practice_invitations WHERE id=$1', [created.id]))
              .rows[0].status,
            'expired',
          );
        },
      );
      await context.test(
        'revoking an uncertain send locates and revokes the provider invitation before reporting completion',
        async () => {
          errors.createInvitationOnce = true;
          await assert.rejects(
            service.createInvitation(
              ownerAuth,
              { email: `new_${staff}@example.invalid`, role: 'org:member', locationIds: [] },
              randomUUID(),
            ),
          );
          const pending = (
            await admin.query(
              "SELECT id FROM practice_invitations WHERE practice_id=$1 AND status='sending'",
              [practiceId],
            )
          ).rows[0];
          const provider = [...invitations.values()].find(
            (item) => item.privateMetadata.careiqInvitationId === pending.id,
          );
          await service.revokeInvitation(ownerAuth, pending.id);
          assert.equal(provider.status, 'revoked');
          const row = (
            await admin.query(
              'SELECT status,provider_revocation_pending FROM practice_invitations WHERE id=$1',
              [pending.id],
            )
          ).rows[0];
          assert.equal(row.status, 'revoked');
          assert.equal(row.provider_revocation_pending, false);
        },
      );
    } finally {
      await runtime?.end();
      await admin.query('DELETE FROM onboarding_drafts WHERE actor_user_id=$1', [owner]);
      if (practiceId) {
        for (const table of [
          'practice_admin_events',
          'practice_provider_events',
          'practice_invitation_attempts',
          'practice_invitations',
          'location_assignments',
          'practice_member_access',
          'locations',
        ]) {
          await admin.query(`DELETE FROM ${table} WHERE practice_id=$1`, [practiceId]);
        }
        await admin.query('DELETE FROM practice_onboarding WHERE actor_user_id=$1', [owner]);
        await admin.query('DELETE FROM practices WHERE id=$1', [practiceId]);
      } else {
        await admin.query('DELETE FROM practice_onboarding WHERE actor_user_id=$1', [owner]);
      }
      if (createdRole) {
        await admin.query(`DROP OWNED BY ${role}`);
        await admin.query(`DROP ROLE ${role}`);
      }
      await admin.end();
    }
  },
);
