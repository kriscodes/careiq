# ADR-005: Authentication and Authorization Architecture

**Status:** Accepted

## Context

CareIQ is a multi-tenant SaaS platform that will serve multiple independent healthcare practices.

The platform requires a secure and scalable approach to authentication, tenant membership, and authorization.

CareIQ will support multiple user-facing applications, including web, mobile, and tablet clients. These applications require a shared identity and authorization model.

Users may belong to multiple practices and may have different levels of access within each practice.

Authentication and authorization are security-critical concerns. The platform should avoid implementing password management, session management, multi-factor authentication, organization membership management, and other identity infrastructure internally when a specialized identity provider can provide these capabilities.

CareIQ requires an authorization model that is understandable by healthcare practices while remaining flexible enough to support increasingly granular permissions as the platform evolves.

## Decision

CareIQ will use Clerk as its authentication and identity provider.

Clerk Organizations will provide the identity and membership boundary for CareIQ tenants.

A CareIQ Practice will correspond to a Clerk Organization.

### Identity

A CareIQ user will have a single global identity managed by Clerk.

Users may belong to one or more Clerk Organizations.

A user's membership within an Organization determines their access within the corresponding CareIQ Practice.

### Authentication

Clerk will manage authentication and identity-related capabilities, including:

* User authentication.
* Session management.
* Password management.
* Email verification.
* Multi-factor authentication capabilities.
* Identity provider integrations.
* Organization membership management.

CareIQ applications will use Clerk to establish authenticated user sessions.

The CareIQ backend will validate authenticated requests before executing protected operations.

### Authorization

CareIQ will use role-based access control (RBAC) as its primary authorization model.

Roles will be assigned to users through their Clerk Organization membership.

Each membership will have a single assigned role.

Roles will grant one or more permissions.

Application authorization decisions should primarily be based on permissions rather than hard-coded role names.

Roles provide a manageable way to assign groups of permissions to users, while permissions provide the level of granularity used by the CareIQ application when authorizing operations.

CareIQ will begin with system-defined roles appropriate for healthcare practices.

The initial role model will be refined separately as CareIQ's core workflows and user responsibilities are defined.

### Authorization Enforcement

The CareIQ backend is the source of truth for authorization enforcement.

Client applications may use roles and permissions to control the user experience, such as hiding unavailable actions or navigation.

Client-side authorization must not be considered a security boundary.

Sensitive operations and protected data must be authorized by backend services before data is returned or an operation is performed.

Authorization decisions must validate:

1. The user is authenticated.
2. The user has an active and valid practice context.
3. The user is authorized to access the requested practice.
4. The user has the required permission for the requested operation.
5. The requested resource belongs to the authorized practice.
6. Any additional resource-specific rules are satisfied.

### Tenant Context

The active Clerk Organization will represent the user's current CareIQ Practice context.

CareIQ applications may allow users who belong to multiple practices to switch between authorized practice contexts.

The backend must validate the organization context associated with every protected request.

The client must not be treated as the sole authority for determining which practice's data may be accessed.

All practice-specific database queries and operations must enforce the appropriate tenant boundary.

### Source of Truth

Clerk will be the source of truth for:

* User identity.
* Authentication state.
* Organizations.
* Organization memberships.
* Roles.
* Authorization permissions.

CareIQ's PostgreSQL database will remain the source of truth for CareIQ domain data.

Each CareIQ Practice record will store a reference to its corresponding Clerk Organization.

CareIQ domain data will be associated with the appropriate Practice and tenant boundary.

CareIQ will not duplicate Clerk's complete user, membership, role, or permission model as a second authorization system.

Limited local references or synchronized data may be stored when required for application relationships, auditing, performance, or integration purposes. Clerk remains the authoritative source for identity and access control.

### Practice Creation and Onboarding

Creating a CareIQ Practice will be controlled through CareIQ's application onboarding workflow.

The onboarding process will coordinate the creation and configuration of:

1. A Clerk Organization.
2. A corresponding CareIQ Practice.
3. The relationship between the Clerk Organization and CareIQ Practice.
4. The initial practice administrator or owner.
5. Required practice configuration.

CareIQ will not rely on unrestricted client-side Organization creation as the sole mechanism for provisioning healthcare practice tenants.

### Future Considerations

Additional contextual authorization rules may be introduced when required.

For example, a user may have permission to access patient information while additional rules restrict access based on provider relationships, assignments, or other resource-specific conditions.

These additional rules will supplement RBAC rather than replace it.

Future enterprise authentication capabilities, including single sign-on, may be introduced through Clerk as customer requirements evolve.

## Consequences

CareIQ avoids building and maintaining its own authentication and identity infrastructure.

A shared identity model can be used across web, mobile, tablet, and future CareIQ applications.

Clerk Organizations provide a direct model for multi-tenant practice membership and organization switching.

RBAC provides a clear and understandable authorization model for healthcare practice staff.

Permission-based authorization allows CareIQ to make fine-grained access decisions without tightly coupling application code to specific role names.

The CareIQ backend remains responsible for enforcing authorization and tenant isolation.

CareIQ becomes dependent on Clerk for identity and access management.

Clerk-specific Organization, role, and permission concepts become an architectural dependency and must be considered when designing authentication flows, backend APIs, and onboarding workflows.

Custom roles and permissions may require specific Clerk product capabilities and pricing plans in production. These requirements must be evaluated before production deployment.

The authorization model must continue to be tested as a security-critical component of the platform.
