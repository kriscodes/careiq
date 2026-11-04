# ADR-017: Practice, Locations, Memberships, and Roles

**Status:** Accepted for staged implementation — October 5, 2026; hosted rollout pending

**Date:** 2026-10-04

## Numbering and relationship to prior decisions

The original request called this ADR-013. The repository already contains an accepted [ADR-013 for file and document storage](013-file-and-doc-storage-architecture.md), followed by ADR-014 through ADR-016. The owner confirmed using the next available number, ADR-017, to preserve those decisions and their existing links.

This proposal extends [ADR-004](004-multi-tenant-saas.md), [ADR-005](005-authentication-authorization.md), and [ADR-007](007-multi-tenant-data-isolation.md). Practice remains the tenant and one Practice maps to one Clerk Organization. Clerk remains the authority for identities, organization memberships, membership roles, and role permissions. CareIQ adds location assignments as domain authorization constraints, consistent with ADR-005's provision for resource-specific rules. It does not introduce another identity provider or a parallel local role directory.

For location-enabled practices, this decision replaces the historical implicit clinical privileges of `org:admin` and `org:member` for practices migrated to location enforcement. Existing accepted ADRs and their historical implementation notes remain intact; this document identifies the intended change rather than rewriting history.

## Context and October 4 baseline

Practices need to create locations, invite staff, and assign access without exposing another location's clinical records. A staff member may work at several locations in the same practice and may belong to more than one practice using one Clerk identity.

At the time of the original mobile proposal, the repository implemented:

- An internal UUIDv7 Practice linked uniquely to a Clerk Organization in `apps/api/src/db/schema/practices.ts`.
- An active organization selected in the web `OrganizationSwitcher`. `GET /api/v1/me` calls `provisionPractice`, which lazily creates the CareIQ Practice for that organization. This is not the controlled onboarding workflow described by ADR-005.
- Verified Clerk authentication and practice resolution in `apps/api/src/middleware/tenant-context.ts`. `permissions.ts` gives `org:admin` clinical read/create, `org:member` clinical read, and custom roles explicit per-resource permissions.
- Practice-owned patients and appointments, including a composite patient/practice foreign key. There are no locations, location assignments, CareIQ invitation workflow, or enrollment lifecycle.
- Transaction-local `app.practice_id`, forced PostgreSQL RLS, metadata-only clinical audit events, and persistent create idempotency. The current idempotency key scope is practice + operation + key; it does not yet include actor or location.

The October 4 mobile bootstrap did not include the backend change. The October 5 implementation adds the staged migration, controlled onboarding, invitation/member lifecycle, location-aware clinical APIs and web settings described in the [implementation and rollout guide](../practice-access-implementation.md). That guide records the initial policy choices, verification and remaining environment work; production has not been migrated by this repository change.

## Decision

### Domain boundaries

```text
Clerk User (one global identity)
  └── Clerk Organization Membership (one role per practice)
        └── CareIQ Practice (tenant; one Clerk Organization)
              ├── Location A
              │     └── Explicit staff assignments
              └── Location B
                    └── Explicit staff assignments
```

A Location is a CareIQ resource within a Practice, not a separate Clerk Organization. Every location belongs to exactly one practice. Locations have an internal UUIDv7 identifier, name, operational status, time zone, and optional address. Closing a location disables access and new activity without deleting its history.

All location-owned records carry both `practice_id` and `location_id`. Composite foreign keys and indexes ensure that a location cannot be attached to a different practice. References between location-owned clinical records must also agree on practice and location; a patient from Location A cannot be booked into Location B by substituting its identifier.

Suggested relationships, to refine during schema implementation:

| Relationship | Purpose and authority |
| --- | --- |
| `practices.clerk_org_id` | Existing unique link to the authoritative Clerk Organization. |
| `locations` | CareIQ-owned locations and their lifecycle. |
| `practice_member_access` | Minimal membership reference, Clerk user/membership IDs, enrollment status, local suspension, and reconciliation metadata. Does not store an independently editable copy of Clerk roles or permissions. |
| `location_assignments` | Explicit practice/member/location access, active status, and grant/revocation metadata. Unique per practice, member, and location; composite references prevent cross-practice grants. |
| `practice_invitations` | Clerk invitation reference, intended recipient, enrollment state, optional pending assignments, expiry/revocation, and audit metadata. No raw invitation bearer token. |

Clerk membership and an active local enrollment are both required. A local reference alone cannot create membership. Location assignments can narrow Clerk-granted authority but cannot grant permissions absent from the member's current Clerk role.

### Roles, administration, and clinical access

Keep one role per Clerk Organization membership, as ADR-005 establishes. Role definitions bundle permissions; backend operations authorize permissions and resource context. The initial implementation keeps Clerk roles authoritative: only the accountable active `org:admin` owner administers CareIQ access; recognized staff roles are configured by the operator. Clinical actions require explicit Clerk permissions even for administrators. A broader delegated permission matrix remains a separate product decision.

Practice administration covers location configuration, invitations, membership administration, and role assignment. It does not automatically confer access to patient records, all locations, protected audit records, or future locations. Administrative APIs return only the directory/configuration information needed for these tasks.

Clinical access requires a role with the relevant clinical permission **and** an explicit active assignment to the selected location. A role may bundle both administration and clinical permissions when that combination is intentionally approved. Its holder still needs a location assignment for clinical work. Staff can have several location assignments without additional accounts or organizations.

The initial model uses the same membership role at every assigned location. Different clinical roles at different locations would require a separate, deliberate extension; do not create a second local role/permission system silently. There is no implicit wildcard assignment. Practice-wide reporting, emergency access, or bulk assignment to future locations requires separate authorization design and review.

Administrators may grant only roles and locations within their delegated authority. The backend prevents self-escalation, grants exceeding the acting administrator's grant authority, and removal of the last accountable practice owner. Ownership transfer is an explicit, audited workflow. Final role names and grant rules must be validated against the selected Clerk plan and configuration.

### Onboarding and invitation lifecycle

For a new practice:

1. Authenticate the founding user and verify eligibility to create a practice.
2. Run a CareIQ backend provisioning operation that coordinates the Clerk Organization, internal Practice, initial owner, and at least one Location.
3. Record provisioning progress and make retries idempotent. A partial external/local failure leaves the practice pending and inaccessible until reconciliation completes; never assume cross-provider atomicity.
4. Let the administrator invite staff during setup and later in settings. Practice setup may complete without sending any invitations.

For staff invitations:

1. An authorized administrator specifies the recipient and may propose a role and explicit locations, or defer assignment until after acceptance.
2. The backend creates an organization-bound Clerk invitation and a minimal local enrollment record. Use per-recipient, expiring invitations; a copied generic link must not grant arbitrary users access.
3. The recipient signs in or creates an account through Clerk and accepts the invitation for the intended organization. The backend validates the provider-confirmed invitation and membership; URL parameters are navigation hints, never proof of membership or role.
4. Acceptance establishes membership and moves the local enrollment to `pending_assignment`. It grants no clinical access. Even a role with clinical permissions is insufficient until enrollment and assignments are active.
5. An authorized administrator confirms the membership role and locations. The API verifies current Clerk membership, successful role configuration, location ownership, and grant authority before activating enrollment and assignments.

Conceptual enrollment states are `invited → pending_assignment → active`, with `expired`, `revoked`, and `suspended` denying access. Invitation state and member suspension are distinct: expiring an unaccepted invitation is not the same operation as removing an already active member. Reissuing an invitation invalidates the previous outstanding enrollment attempt. Replayed acceptance or provider events must not reactivate a revoked member or grant duplicate assignments.

For the first release, administrator confirmation after acceptance is the safe default. Whether preassigned invitations should activate automatically is a product decision still to review. Invitations, acceptance, assignment, role changes, revocation, and ownership transfer must be auditable without logging invitation tokens or unnecessary recipient details.

Replace lazy provisioning through `/me` when controlled onboarding launches. `/me` becomes a context read and may report a pending/unprovisioned state; selecting or accepting an arbitrary Clerk Organization must not create a usable CareIQ practice. Disable unrestricted organization creation paths in client configuration/UI as part of the coordinated rollout, with backend eligibility checks remaining authoritative.

### Request authorization and context

Each clinical request must satisfy all of the following:

1. A valid Clerk session identifies the user and active organization.
2. The organization resolves to the authorized, active CareIQ Practice.
3. The user has a current Clerk membership and the required current role permission.
4. Local enrollment is active and neither member nor practice is suspended.
5. The requested Location is active, belongs to that Practice, and has an active assignment for that member.
6. The requested clinical resource belongs to the same Practice and Location.

The API constructs validated practice/location/actor context only after these checks. It never accepts a client-supplied `practice_id`, role, permission list, or assignment as authority. An absent location fails closed; it never means all locations.

Prefer explicit location-scoped resources, for example `/api/v1/locations/{locationId}/patients` and `/api/v1/locations/{locationId}/appointments`, with a nonclinical context endpoint exposing only the caller's accessible locations and capabilities. These routes are proposed contracts, not endpoints in the current API. Keep REST/JSON, versioning, stable errors, and the backend business-logic boundary from ADR-002 and ADR-011.

Clients keep active practice and location as navigation state. They obtain capabilities from the backend, clear clinical views and drafts on user/practice/location change, cancel in-flight requests, and key any memory cache by user + practice + location + resource. They must ignore stale responses after context changes. Denial or revocation clears the affected state. Client route guards and selectors improve the experience; they are not authorization controls.

### Revocation and reconciliation

Clerk remains authoritative for membership, role, and permission changes. Signed sessions can outlive a membership change, so trusting an old token plus a local enrollment projection alone is insufficient for the proposed revocation behavior.

Initially, resolve current membership and authorization through a verified backend Clerk lookup for protected access. If freshness cannot be established, deny protected access with an appropriate retryable error. Any later cache must have an explicitly reviewed maximum staleness and invalidation strategy; do not claim immediate revocation using asynchronous events alone. Provider rate limits and availability are implementation readiness checks.

For removal initiated through CareIQ, commit a local suspension before making the Clerk removal/change request. That local deny prevents new access while an external operation is retried. Do not reactivate access merely because an external retry failed. Resume only after an authorized action and fresh reconciliation confirm the intended state.

Verified Clerk events supplement request-time checks. Process them idempotently with duplicate/out-of-order protection and periodically reconcile memberships/invitations. For ambiguous or older events, fetch current provider state before enabling access. Deletion must disable related assignments without erasing audit history; rejoining requires a new enrollment review and must not revive historic grants automatically. Already-authorized in-flight operations need an explicit transaction/revocation concurrency policy; there is no claim of retroactively canceling committed work.

### Database isolation, audit, and retry behavior

Extend transaction-local context to validated practice, location, and actor. Keep it local to the transaction and never leak it through pooled connections. Retain forced RLS with `USING` and `WITH CHECK` restrictions and runtime roles that cannot bypass RLS. Application authorization and explicit query scoping supplement this database boundary.

Location-owned tables must enforce practice **and** location scope. Missing, empty, invalid, or unauthorized context must return no protected rows and permit no writes. Administrative metadata uses separately designed practice-scoped policies; an administrative connection must not gain general clinical bypass rights. Test raw queries using the real non-owner runtime role in addition to service-level tests.

Preserve the implemented atomic clinical audit behavior and append-only/insert-only runtime privileges. Add location and relevant grant-change context deliberately; do not rewrite historical events or invent historic locations. Distinguish practice administration events from clinical read/create events. ADR-010's separate protected audit access remains applicable, and its full audit schema/trigger architecture is still broader than the implemented metadata-only audit.

Extend idempotency to validated practice + actor + location + operation + key. Include context in conflict/hash handling and reauthorize every retry before returning a stored result. A key from another location or actor must not expose a stored clinical record. Preserve existing keys through the migration and do not silently reinterpret them as new operations, which could duplicate already-completed writes. Historic keys lack actor/location fields: where their original scope cannot be established safely, return a conflict requiring reconciliation without returning a record or repeating the write. The new authorization, audit, and idempotency behavior must activate together with location enforcement; there must be no rollout window that uses new clinical scope with old replay behavior.

### Patient ownership and location isolation

The proposed default is strict location isolation: patients and appointments are location-owned, and a person seen at two locations initially has separate location records. There is no practice-wide patient directory, search, deduplication, or cross-location appointment lookup available to ordinary staff.

This is a product choice requiring explicit review before implementation. If CareIQ needs a single longitudinal patient identity across locations, introduce a separate practice-owned identity and explicitly authorized location records/links in a subsequent design. Do not add a shared patient table as an implementation shortcut that exposes identifiers, contact details, or record existence across isolated locations. Transfers and cross-location sharing likewise need explicit authorization, audit, and retention semantics.

## Staged migration and compatibility

Follow ADR-015's expand-and-contract approach. Production migrations remain explicit deployment operations.

1. **Approve semantics.** Confirm patient ownership, initial roles, administrator access, invitation activation, revocation freshness, and ownership-transfer policy. Publish contracts and cross-location threat cases before coding enforcement.
2. **Expand safely.** Add location/enrollment/assignment structures and required RLS without enabling location mode for existing practices. Create a named legacy/default location for each existing practice; backfill only with verified mappings. Unmapped or ambiguous rows remain inaccessible to new location-scoped operations until resolved.
3. **Review grants.** Inventory existing Clerk memberships and admin/member clinical behavior. Have an accountable practice owner approve initial role/assignment mappings. Do not silently grant every member every location or convert control-plane administrators into clinicians.
4. **Coordinate API and clients.** Deploy location-aware context and explicit endpoints, then a location-aware web client and supported mobile clients. Add membership lifecycle checks to every clinical route and implement matching audit/idempotency scope, including conservative historic-key handling. Validate invitations and revocation before enabling a practice.
5. **Enable with a gate.** Switch a practice to location enforcement only after data, grants, runtime policies, audit/retry behavior, client readiness, and end-to-end checks pass. Activate these controls together. For an enabled practice, legacy clinical endpoints without location context must return a stable update/context-required error and no records. Old web tabs or mobile binaries must not receive an implicit all-location view or silently selected location. If an incompatible public contract cannot be preserved, use the versioning/deprecation process in ADR-011.
6. **Tighten and retire.** Enforce non-null constraints only after verified backfill, validate composite foreign keys before activating their dependent clinical operations, and retire legacy behavior through a documented compatibility window. After a practice is enabled, rollback must not restore broad old permissions; block unsupported clients or disable affected operations instead.

Required verification includes cross-practice and cross-location reads/writes, foreign-key substitution, missing context, pending/unassigned users, administrative users without clinical grants, role/assignment removal during active sessions, expired/replayed/wrong-recipient invitations, duplicate/out-of-order provider events, old clients, failed provisioning retries, stale client responses, idempotency replays across identities/locations, and transaction/pool context cleanup. Preserve existing tenant, clinical audit, and retry tests.

## Consequences and review decisions

This model fits multi-location practices while retaining the accepted tenant, identity, database, API, and audit architecture. It adds an explicit location boundary rather than multiplying tenants. The cost is coordinated onboarding, membership freshness checks, more database policies, and a careful transition for existing clients and records.

The accepted initial defaults are strict location-owned patients, explicit clinical grants, owner-only administration, administrator confirmation after acceptance, and fresh provider lookups. Before hosted rollout or expanding that policy, review:

- Strict location-owned patients versus an explicitly shared patient identity.
- Initial membership roles, grant authority, owner safeguards, and whether different roles per location are required.
- Administrator confirmation after invitation acceptance versus reviewed automatic activation.
- Membership/permission freshness and availability expectations, including provider lookup limits.
- Location migration mappings, client compatibility window, and the per-practice activation gate.

The initial mobile scaffold remains a safe setup screen with no protected clinical calls. Backend/web location enforcement is implemented behind the staged migration; hosted activation and native authentication/device verification remain separate release work. See the [implementation guide](../practice-access-implementation.md) for current evidence and limits.
