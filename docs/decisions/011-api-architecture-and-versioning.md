````md id="p4y9nc"
# ADR-011: API Architecture and Versioning

**Status:** Accepted

## Context

CareIQ will support multiple first-party applications and future external integrations.

The platform requires a consistent API architecture that can serve:

- Web applications.
- Mobile applications.
- Tablet applications.
- External integrations.
- Background services.
- Future CareIQ applications and services.

CareIQ must provide a stable and secure contract between clients and backend services while preserving the ability to evolve the platform over time.

The API architecture must also work consistently with previously established decisions for:

- Authentication and authorization.
- Multi-tenancy.
- Tenant isolation.
- Audit logging.
- Integration readiness.
- PostgreSQL-backed domain data.

CareIQ requires explicit boundaries between first-party application APIs and externally supported integration APIs so that internal implementation details do not automatically become permanent public contracts.

## Decision

CareIQ will use versioned REST APIs using JSON over HTTPS as the primary interface between clients, backend services, and supported external integrations.

The initial API version will use URL-based versioning.

The primary first-party API will use paths under:

```text
/api/v1/...
```

CareIQ will introduce a new major API version only when a breaking change cannot reasonably be handled while preserving backward compatibility.

## API Style

CareIQ APIs will use REST-style resource-oriented endpoints over HTTPS.

JSON will be the default request and response representation.

Examples may include:

```text
GET    /api/v1/patients
POST   /api/v1/patients
GET    /api/v1/patients/{id}
PATCH  /api/v1/patients/{id}
DELETE /api/v1/patients/{id}
```

API design should use standard HTTP semantics and status codes where appropriate.

CareIQ will not introduce another primary API style, such as GraphQL or RPC, without a separate architectural decision.

## API Versioning

CareIQ will use URL-based major API versioning.

The initial version will be:

```text
/api/v1
```

Major API versions represent breaking compatibility boundaries.

CareIQ should avoid creating new major API versions for ordinary additive or backward-compatible changes.

Examples of changes that should generally remain compatible within the same major version include:

- Adding optional response fields.
- Adding new endpoints.
- Adding optional request fields.
- Adding new supported enum values when clients are expected to tolerate them.
- Adding new capabilities without removing existing behavior.

A new major API version may be introduced when a change would break existing supported clients or integrations and cannot reasonably be introduced compatibly.

## First-Party API Surface

CareIQ first-party applications will use the primary CareIQ API.

First-party clients include:

- Web applications.
- Mobile applications.
- Tablet applications.
- Future CareIQ-owned client applications.

Client applications must not directly access PostgreSQL.

The API remains the primary platform boundary for:

- Authentication.
- Tenant resolution.
- Authorization.
- Business logic.
- Validation.
- Audit context.
- Data access.

The conceptual flow is:

```text
Web
Mobile
Tablet
   │
   ▼
/api/v1
   │
   ▼
CareIQ Backend
   │
   ├── Authentication
   ├── Tenant Resolution
   ├── Authorization
   ├── Business Logic
   ├── Audit Integration
   └── Database Access
```

## External Integration API Surface

External systems will use a separately defined integration API surface.

CareIQ will not automatically expose every internal application endpoint as a supported external API contract.

The integration API may initially be implemented within the same backend application as the first-party API.

Conceptually:

```text
CareIQ Clients
      │
      ▼
  /api/v1
      │
      ┐
      │
      ▼
 Shared Domain Services
      ▲
      │
      ┘
      │
External Systems
      │
      ▼
/integrations/v1
```

The logical separation between the first-party API and integration API will exist even when both are deployed within the same backend service.

Physical separation into independent services may occur later when justified by:

- Scale.
- Security.
- Operational requirements.
- Independent deployment requirements.
- Integration-specific performance requirements.

The exact integration API path structure may evolve, but its contract must remain explicitly separated from unsupported internal implementation details.

## Authentication

First-party CareIQ user authentication will use Clerk as defined in ADR-005.

Authenticated API requests must establish a validated identity before protected operations are performed.

The API will apply the established CareIQ flow:

```text
Authentication
      │
      ▼
Tenant Resolution
      │
      ▼
Authorization
      │
      ▼
Domain Operation
      │
      ▼
Audit Context
```

Client-side authentication or authorization state must not replace backend verification.

## Integration Authentication

CareIQ will support multiple integration authentication patterns because different integration scenarios require different identity models.

### OAuth

OAuth may be used when a user or administrator grants an external application delegated access to CareIQ resources.

Delegated access must be limited by explicitly authorized scopes or permissions.

Conceptual scopes may include:

```text
patients:read
appointments:read
appointments:write
```

The exact scope model may evolve with the integration domain.

### Service Accounts

Server-to-server integrations will use explicit machine identities represented as service accounts or equivalent integration identities.

A service account may be associated with:

- A CareIQ Practice.
- Permissions.
- Integration configuration.
- Credentials.
- Audit identity.

Service accounts allow machine activity to be distinguished from human user activity.

### API Keys

API keys may be used as credentials for supported integration scenarios.

An API key must authenticate an integration identity or service account rather than acting as the identity itself.

The conceptual model is:

```text
API Key
   │
   ▼
Integration Identity
   │
   ├── Tenant Scope
   ├── Permissions
   └── Audit Identity
```

Credentials may be revoked or rotated without destroying the underlying integration identity or audit history.

## Integration Tenant Scope

Integration identities will be tenant-scoped by default.

A practice-scoped integration may access only the tenant data for the Practice it is explicitly authorized to access.

Conceptually:

```text
Integration Identity
        │
        └── Practice A
```

Access to Practice B must not be implied or inherited automatically.

Cross-tenant or platform-scoped integration access requires explicit authorization and must use controlled platform-level access paths.

Integration activity must participate in CareIQ's authorization, tenant-isolation, and audit architectures.

## Authentication and Authorization Separation

Credentials authenticate an identity.

Permissions authorize that identity.

CareIQ will maintain this distinction for:

- Human users.
- Service accounts.
- Integrations.
- Other machine identities.

Possession of a credential must not automatically imply unrestricted access.

All authenticated identities remain subject to the permissions and tenant boundaries associated with that identity.

## Response Format

CareIQ APIs will use consistent JSON response structures.

A typical successful response may use a structure such as:

```json
{
  "data": {
    "id": "019..."
  }
}
```

Collection responses may include pagination metadata.

For example:

```json
{
  "data": [],
  "pagination": {
    "cursor": "...",
    "hasMore": true
  }
}
```

The exact response schemas will be defined through the CareIQ OpenAPI contract.

## Pagination

CareIQ collection endpoints will use cursor-based pagination by default.

Cursor-based pagination is preferred over offset-based pagination for large or frequently changing datasets because it provides more predictable behavior and supports efficient access patterns as datasets grow.

Alternative pagination strategies may be used when a specific endpoint or domain requirement clearly justifies them.

## Error Format

CareIQ APIs will use a consistent structured error format.

Errors should include:

- An appropriate HTTP status code.
- A stable machine-readable error code.
- A human-readable message.
- A request or correlation identifier when available.

A conceptual error response is:

```json
{
  "error": {
    "code": "PATIENT_NOT_FOUND",
    "message": "The requested patient could not be found.",
    "requestId": "req_123"
  }
}
```

Machine-readable error codes should remain stable enough for supported clients to handle errors programmatically.

Human-readable messages must not expose sensitive internal implementation details.

## Request and Correlation Identifiers

CareIQ API requests should support request or correlation identifiers.

Request identifiers allow individual HTTP requests to be traced through:

- Application logs.
- Audit events.
- Database mutations.
- Background processing.
- Integration activity.
- Other backend services.

Request and correlation identifiers should integrate with the audit architecture defined in ADR-010.

A request identifier represents an individual request or execution attempt.

It is distinct from an idempotency key.

## Idempotency

CareIQ APIs will support idempotency for operations where retries could otherwise create duplicate or inconsistent side effects.

Examples may include:

- Creating appointments.
- Creating patients.
- Submitting intake forms.
- Payment or billing operations.
- Integration commands.
- Webhook processing.
- Background job retries.
- Other operations where duplicate execution would be harmful or incorrect.

Clients performing supported idempotent operations may provide an idempotency key.

Conceptually:

```text
Client
  │
  ├── Idempotency-Key: abc123
  │
  ▼
CareIQ API
  │
  ├── First Request
  │      ├── Execute operation
  │      └── Record result
  │
  └── Retry With Same Key
         ├── Do not execute again
         └── Return recorded outcome
```

Idempotency keys will be scoped to the applicable tenant and authenticated identity or integration.

Repeated requests using the same valid idempotency key for the same intended operation must not execute the underlying operation more than once.

CareIQ must distinguish between:

```text
Request ID
    │
    └── Identifies an individual HTTP attempt

Idempotency Key
    │
    └── Identifies the intended business operation across retries
```

The exact storage mechanism, expiration policy, and persistence implementation for idempotency records will be defined during implementation.

## OpenAPI Contract

CareIQ will maintain OpenAPI specifications as the authoritative contract for supported REST API surfaces.

OpenAPI definitions should describe supported API behavior including:

- Endpoints.
- Request schemas.
- Response schemas.
- Error structures.
- Authentication requirements.
- Authorization expectations where appropriate.
- Pagination behavior.
- API versions.
- Supported integration contracts.

OpenAPI contracts will be version-controlled alongside CareIQ application code.

The architecture should prevent API documentation and implementation from drifting apart.

The exact mechanism used to maintain this alignment may include:

- Generating OpenAPI definitions from application code.
- Generating application types or clients from OpenAPI definitions.
- Validating implementation against maintained OpenAPI definitions.
- Other approved contract-validation approaches.

The specific implementation approach may be selected during development.

## External API Documentation

Externally published API documentation must include only intentionally supported integration contracts.

Internal application endpoints must not automatically become externally supported or documented APIs.

This distinction allows CareIQ to evolve first-party application endpoints without unintentionally creating permanent external dependencies.

Supported integration APIs must clearly document:

- Authentication.
- Permissions or scopes.
- Request formats.
- Response formats.
- Error behavior.
- Pagination.
- Idempotency where applicable.
- Version compatibility.

## Backward Compatibility

CareIQ will preserve backward compatibility within a major API version whenever reasonably possible.

Supported clients and integrations should not require coordinated upgrades for ordinary backward-compatible API evolution.

CareIQ should prefer additive changes over breaking modifications.

Breaking changes should be introduced only when the existing API contract cannot reasonably support the required behavior.

## Deprecation

CareIQ may deprecate API endpoints, fields, or behaviors when they are no longer appropriate or when replacements are introduced.

Deprecated capabilities should remain available for a reasonable transition period when supported clients or integrations depend on them.

Deprecation should be communicated through appropriate mechanisms, which may include:

- API documentation.
- OpenAPI metadata.
- Response headers.
- Integration notices.
- Release notes.
- Direct customer or partner communication for significant integration changes.

The exact minimum deprecation period may be defined later based on product maturity, customer commitments, and integration requirements.

CareIQ must not silently remove supported API capabilities that active clients or integrations reasonably depend upon.

## Consequences

CareIQ will have a consistent, versioned REST API architecture across web, mobile, tablet, external integration, and future service use cases.

REST and JSON over HTTPS provide a broadly understood and interoperable contract.

URL-based major versioning provides an explicit compatibility boundary.

Separating first-party APIs from external integration APIs prevents internal implementation details from automatically becoming permanent public contracts.

First-party clients share a common backend authorization, tenant isolation, business logic, auditing, and data-access layer.

Integration identities can use OAuth, service accounts, or API keys depending on the integration scenario while preserving a consistent separation between authentication and authorization.

Tenant-scoped integration identities reduce the risk of unintended cross-tenant access.

Consistent response and error formats simplify client development.

Cursor-based pagination provides a scalable default for collection endpoints.

Idempotency reduces the risk that retries create duplicate or inconsistent side effects.

Request and correlation identifiers improve traceability across CareIQ's application, database, background-processing, integration, and audit layers.

OpenAPI provides a version-controlled contract for supported API behavior and creates a foundation for documentation, testing, client generation, and future developer tooling.

Backward-compatibility and deprecation rules allow CareIQ to evolve without unnecessarily breaking supported clients and integrations.

The architecture introduces ongoing responsibility for API contract maintenance, compatibility testing, version management, integration security, documentation, and deprecation planning.

This complexity is accepted because the API is a foundational platform boundary for all current and future CareIQ applications and integrations.
````
