# Practice onboarding and location access

Implementation date: October 5, 2026. Decision: [ADR-017](decisions/017-practice-location-membership-model.md). This is a repository implementation and staged rollout guide; production has not been migrated by this change.

## Product behavior

An owner signs in with Clerk, creates a CareIQ practice and its first location, then manages locations and employees in **Practice settings**. Practice creation is coordinated by the API. Merely selecting a Clerk organization or reading `/me` no longer creates a practice.

An owner invites an employee by email, chooses an approved Clerk role, and proposes explicit locations. The employee signs in with the invited email, accepts the Clerk invitation, and finishes joining CareIQ. Enrollment remains pending until the owner confirms role and location assignments. A copied URL, client role, or organization identifier cannot grant access.

Staff select an assigned working location before opening patients and appointments. A patient record belongs to one location; cross-location patient sharing is outside this release. Changing user, practice, or location unmounts records and drafts and cancels requests. Returning to a hidden window rechecks access before rendering records. Clinical information stays in component memory.

The initial administrative policy is deliberately small: the accountable owner must have a fresh `org:admin` membership and active local enrollment to manage locations, invitations, roles, assignments, or ownership transfer. Other administrators do not automatically gain CareIQ management authority. Owner transfer requires another active Clerk administrator and is audited. The owner cannot suspend themselves or change their own role through these endpoints.

Neither `org:admin` nor `org:member` implies clinical access in location mode. Clinical access requires current Clerk permissions plus an active enrollment and explicit location assignment. Owners can explicitly assign themselves locations; creating a location never grants all staff access to it.

## API surface

All application endpoints require verified Clerk authentication and return `Cache-Control: no-store`. Clinical routes retain their existing JSON payloads and pagination.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/me` | Read current practice, enrollment, management capabilities and assigned active locations. No provisioning side effects. |
| `POST /api/v1/onboarding` | Create/reconcile the approved owner's practice and initial location. Requires a UUIDv4 `Idempotency-Key`. |
| `GET /api/v1/practice/admin` | Owner-only nonclinical locations, membership and invitation directory. |
| `POST /api/v1/locations` | Create a location with name, IANA time zone and optional address. |
| `POST /api/v1/locations/:locationId/status` | Close or reopen a location without deleting its history. |
| `POST /api/v1/practice/invitations` | Send/reconcile an organization-bound invitation with role and proposed location IDs. Requires a UUIDv4 `Idempotency-Key`. |
| `POST /api/v1/practice/invitations/accept` | Verify provider-confirmed acceptance and enroll the authenticated recipient as pending. |
| `POST /api/v1/practice/invitations/:id/revoke` | Revoke the local invitation before attempting provider revocation. |
| `POST /api/v1/practice/members/:userId/activate` | Confirm the current membership, approved role and explicit locations. |
| `POST /api/v1/practice/members/:userId/suspend` | Disable local access and assignments. |
| `POST /api/v1/practice/ownership` | Transfer accountability to an active administrator. |
| `GET/POST /api/v1/locations/:locationId/patients` | List/create patients inside validated location scope. |
| `GET/POST /api/v1/locations/:locationId/appointments` | List/create appointments referencing patients in that same location. |

The API never trusts client-supplied practice IDs, permissions or assignment arrays as authority. A location-mode practice receives `LOCATION_CONTEXT_REQUIRED` on the old unscoped clinical routes. There is no fallback to an implicit location.

## Provider and environment setup

Keep Clerk identities, organization memberships, roles and permissions authoritative. Configure the selected Clerk application before testing with real accounts:

1. Turn off unrestricted organization creation and organization suggestions/join paths in client configuration. The app now offers a CareIQ practice creator and an existing-memberships selector.
2. Set `CAREIQ_PRACTICE_CREATOR_USER_IDS` on the API to the approved founding Clerk user IDs. Founders must have a verified email. The bootstrap is closed to arbitrary practice creation; a future commercial signup eligibility policy can replace this allowlist.
3. Configure reviewed staff roles in Clerk, then list their keys in `CAREIQ_STAFF_ROLES`. Built-in member/admin roles remain recognized. Custom clinical permissions are `org:patients:read`, `org:patients:create`, `org:appointments:read`, and `org:appointments:create`. Grant only those appropriate to the role. The API does not create a parallel role directory.
4. Set `CAREIQ_INVITATION_REDIRECT_URL` to the matching web application. Configure Clerk's `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`, `organizationInvitation.created`, `organizationInvitation.accepted`, and `organizationInvitation.revoked` events to `POST /api/v1/webhooks/clerk`, with `CLERK_WEBHOOK_SIGNING_SECRET` stored only on the API. Raw-body signature verification precedes processing; this endpoint uses provider signatures rather than a user session.
5. Keep the existing CORS/authorized-party policy. Native auth remains a separate mobile integration task; do not weaken browser token validation to make an untested native flow pass.

Fresh Clerk membership lookups are required for location-mode access; failures deny access with retryable errors. Webhooks and the membership reconciliation command only narrow local grants. They never activate a member. Duplicate or reordered provider notifications cannot replace the owner's activation review. Rejoining with a different Clerk membership requires a new enrollment review.

Run `pnpm --filter @careiq/api members:reconcile` from an operator scheduler using the restricted runtime login and the matching Clerk environment. Choose a schedule appropriate to provider quotas; request-time lookups remain the access boundary. No hosted schedule is created by this change.

Founding onboarding supports one practice per approved identity in this rollout. The same actor and normalized practice/location details resume the original operation even after a browser refresh changes the transport retry key. A conflicting payload requires operator reconciliation. A completed creation can be reopened from the web without repeating it. Invitation send/revoke attempts similarly retain reconciliation state; the settings screen exposes provider revocation retries when delivery confirmation is pending.

## Database and migration

Migration `0016_location-membership.sql` adds locations, local enrollment references, assignments, invitation/provisioning state, administrative audit events, and provider-event deduplication. Patients, appointments, clinical audit and retry keys gain location scope. Composite foreign keys bind clinical references to both practice and location.

The non-owning runtime role uses forced row-level security. Clinical transactions set practice, actor and location locally, then recheck and lock active enrollment, location and assignment rows. Local revocation or location closure serializes with already authorized work: committed work is retained, and requests beginning after revocation cannot keep using the old grant. External provider changes are checked at request authorization, not retroactively applied to an already committed request.

Clinical retries are scoped to practice + actor + location + operation + key. A legacy key that cannot safely be reinterpreted returns a conflict without exposing its old record or repeating the write. Clinical audit entries are written in the same transaction as the authorized operation. Administrative audit is metadata-only and append-only for the runtime role.

Existing practices remain in legacy mode during expansion. A closed location named **Legacy — mapping review required** is created without assigning staff or moving existing patient data. New practices use location mode immediately. Do not enable an existing practice until an operator has verified:

- The accountable owner and current Clerk role/permission configuration.
- Explicit membership and location grants approved by that owner.
- Complete patient/appointment mappings, including same-location references.
- Runtime grants/RLS, clinical audit, retry behavior, and the location-aware web client.
- Synthetic owner/invitee, cross-practice and cross-location acceptance tests in the deployment environment.

The database activation guard requires an explicit transaction-local rollout-review flag and validates activation prerequisites. Runtime credentials cannot change the authorization mode. Once location mode is enabled, returning to broad legacy access is blocked; suspend the practice or fix the location-aware release instead.

Run migrations as an explicit deployment step with migration credentials. Use the restricted runtime role for the application. This task does not execute migrations against a hosted environment or change live Clerk configuration.

## Mobile boundary and product backlog

`apps/mobile` is the Expo iOS/Android foundation: native navigation, setup, secure optional Clerk provider and a public health check. It shares the workspace and API boundary, with app-specific native components. It has no protected clinical flow yet. See [mobile development](mobile-development.md) and the [original scaffold review](mobile-bootstrap-review.md).

The largest planned features are:

1. Owner onboarding, employee invitations, roles and locations.
2. Insurance verification, actionable benefits/status and staff follow-up.
3. Claim denial triage, ownership, supporting evidence and resolution tracking.
4. Document requests, collection, validation and completion tracking.
5. Claim preparation, submission, acknowledgments and status/retry handling.
6. Scheduling with provider/location availability and conflict prevention.
7. iOS/Android access to the first selected staff workflow.

The scheduling baseline already creates and lists appointments. Availability, conflict prevention, insurance, documents and claims are roadmap work, not completed features in this change. The [Notion Software Kanban](https://app.notion.com/p/d71076cec86e49648cf1be0db9288a17?v=3eee97848806818d8cc6000c4148e153) tracks their acceptance criteria and dependencies.

## Verification

See the final validation record below before promoting this branch. Native device testing and real Clerk invitation delivery require configured non-production accounts. A JavaScript export is not a native device test. The existing mobile dependency audit remains a release blocker; no advisory suppression is added.

Validation on October 5, 2026 used synthetic fixtures, a disposable PostgreSQL 18.6 database, and stubbed Clerk provider responses for lifecycle tests. It did not send live invitations.

| Check | Result |
| --- | --- |
| Workspace lint and TypeScript | Passed across all applications/packages. |
| API build | Passed. |
| API and database tests | 101 passed, none skipped, including the final retry-metadata restriction. |
| Fresh database migration + immediate replay | Passed; second run is a no-op. |
| Drizzle schema generation | No changes after the matching 0016 snapshot. |
| Web tests | 27 passed, including context denial, cancellation and scoped pagination/retry behavior. |
| Web production build | Passed with Next.js webpack. The default Turbopack build cannot open its worker port in this host sandbox; that local limitation remains distinct from a build success. |
| Mobile tests, lint, typecheck, dependency alignment | Passed; six mobile tests. |
| iOS and Android JavaScript/Hermes exports | Passed. |
| Production dependency audit | Failing: two high and one moderate upstream mobile-toolchain findings. No compatible published fixes or suppression were added. See the scaffold review for dependency paths. |
| Live Clerk/browser acceptance, production migration, native binaries/devices | Not executed; tracked as rollout work. |

The branch is for review. Do not infer hosted activation or native release readiness from these local results.
