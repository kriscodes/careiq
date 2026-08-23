# ADR-007: Multi-Tenant Data Isolation

**Status:** Accepted

## Context

CareIQ is a multi-tenant SaaS platform that serves multiple independent healthcare practices.

As defined in ADR-004, each healthcare practice represents an independent tenant within the CareIQ platform.

CareIQ will use a shared PostgreSQL database as defined in ADR-006.

A shared database architecture requires explicit controls to ensure that data belonging to one practice cannot be accessed by another practice.

Tenant isolation must be enforced consistently across synchronous API requests, background jobs, asynchronous workflows, and other services that access tenant-owned data.

CareIQ requires defense-in-depth protections to reduce the risk of cross-tenant data exposure caused by application errors or incorrectly scoped database queries.

## Decision

CareIQ will use a shared PostgreSQL database and shared schema for multiple tenants.

The CareIQ Practice will represent the tenant boundary for application domain data.

Each CareIQ Practice will have a unique internal identifier.

Tenant-owned domain data will be associated with a CareIQ `practice_id`.

The CareIQ Practice will be linked to its corresponding Clerk Organization through the Clerk Organization identifier as defined in ADR-004 and ADR-005.

### Tenant Ownership

Every record containing or representing tenant-owned data must be associated with a CareIQ Practice.

Tenant-owned tables should contain a direct `practice_id` by default.

Direct tenant ownership will be preferred even when the tenant relationship could be inferred through another related record.

For example, an appointment belonging to a patient within a practice should also directly contain the appropriate `practice_id`.

Exceptions to direct `practice_id` ownership must be deliberate and defined by the applicable domain model.

Platform-level records that do not belong to an individual practice are not required to contain a `practice_id`.

### Application-Level Tenant Scoping

CareIQ backend services must explicitly operate within a validated practice context when accessing tenant-owned data.

For authenticated user requests, the backend will:

1. Validate the authenticated user.
2. Validate the tenant context associated with the authenticated request and resolve the corresponding CareIQ Practice.
3. Resolve the corresponding CareIQ Practice.
4. Establish the authorized `practice_id` context.
5. Perform authorization checks.
6. Access tenant-owned data within the authorized practice boundary.

Application queries should explicitly scope tenant-owned data to the active `practice_id`.

PostgreSQL Row-Level Security does not replace application-level awareness of tenant ownership.

Application-level tenant scoping and database-level enforcement will be used together as defense in depth.

### PostgreSQL Row-Level Security

PostgreSQL Row-Level Security will be used to enforce tenant isolation for tenant-owned data.

Tenant-owned tables will use Row-Level Security policies that restrict access according to the authorized `practice_id` context.

The database must not return or modify tenant-owned records outside of the established practice context.

A missing or invalid tenant context must not result in unrestricted access to tenant-owned data.

Tenant-owned data should be inaccessible by default when no valid practice context has been established.

Tenant ownership changes should be performed as an explicit transfer operation rather than as an ordinary record update.

### Tenant Context

The authorized tenant context will be established within the PostgreSQL transaction used to access tenant-owned data.

Tenant context must be transaction-scoped and must not persist beyond the transaction.

Connection pooling must not allow tenant context from one request or operation to persist into another request or operation.

CareIQ will use PostgreSQL transaction-local configuration or an equivalent transaction-scoped mechanism to establish the active `practice_id` context used by Row-Level Security policies.

### Database Access Roles

Normal CareIQ application database access must use a database role that does not bypass Row-Level Security.

The database credentials used by normal API requests, background jobs, and other tenant-scoped application services must remain subject to tenant isolation policies.

Privileged database access that can bypass tenant isolation must be separated from normal application access.

Privileged access may be used only for explicitly controlled platform operations, such as:

- Database migrations.
- Database administration.
- Controlled maintenance.
- Disaster recovery.
- Other explicitly authorized platform-level operations.

Normal application requests must not use privileged database access as a convenience mechanism.

### Background Jobs and Asynchronous Workflows

Background jobs and asynchronous workflows may access tenant-owned data without an interactive authenticated user.

These processes must explicitly establish an authorized `practice_id` context before accessing tenant-owned data.

Tenant context must be included in or resolvable from the job or workflow execution context.

Background jobs must remain subject to the same tenant isolation principles as synchronous application requests.

Background processing must not use unrestricted cross-tenant access when operating on behalf of an individual practice.

### Cross-Tenant Operations

Some platform operations may legitimately require access across multiple tenants.

Examples may include platform administration, controlled analytics, billing operations, maintenance, and disaster recovery.

Cross-tenant access must use explicitly privileged and separately controlled access paths.

The normal tenant-scoped application access path must not bypass Row-Level Security for cross-tenant operations.

Cross-tenant operations must be intentionally designed and authorized rather than relying on implicit unrestricted database access.

### Tenant Ownership Changes

Tenant ownership is expected to remain stable but is not universally immutable.

A tenant-owned record may be moved from one CareIQ Practice to another when a legitimate business or administrative operation requires the transfer.

Tenant ownership changes must:

1. Be performed through an authorized backend operation.
2. Validate that the actor or process is authorized to perform the transfer.
3. Record the affected entity and entity identifier.
4. Record the previous tenant ownership.
5. Record the new tenant ownership.
6. Record when the change occurred.
7. Record who or what initiated the change.

Tenant ownership changes must be included in CareIQ's audit history.

The detailed implementation of audit logging is intentionally addressed through a separate architectural decision.

## Consequences

CareIQ can operate multiple healthcare practices within a shared PostgreSQL database while maintaining explicit tenant boundaries.

A direct `practice_id` association makes tenant ownership visible and easier to enforce across domain data.

Application-level tenant scoping provides explicit awareness of the active tenant within backend services.

PostgreSQL Row-Level Security provides an additional database-level protection against cross-tenant data exposure.

Transaction-scoped tenant context reduces the risk of tenant context leaking between requests when database connections are reused through connection pooling.

Background jobs and asynchronous workflows follow the same tenant isolation principles as interactive requests.

Separating privileged database access from normal application access reduces the risk that application code can accidentally bypass tenant isolation.

Allowing controlled tenant ownership changes provides flexibility for legitimate business operations while requiring those changes to be authorized and auditable.

This architecture introduces additional complexity around database transactions, connection management, Row-Level Security policies, background processing, and testing.

All new tenant-owned domain models and database access patterns must be designed to comply with the tenant isolation architecture defined in this decision.