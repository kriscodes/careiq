# CareIQ Architecture

This document provides a high-level view of the CareIQ platform architecture.

Detailed architectural decisions and their rationale are recorded separately in the Architecture Decision Records under [`docs/decisions`](./decisions).

## Architectural Goals

CareIQ is designed around several long-term requirements:

1. Support multiple independent healthcare practices from a shared platform.
2. Maintain strong isolation between practice data.
3. Provide a stable backend API usable by web, mobile, and future integrations.
4. Keep infrastructure operationally simple during early product development.
5. Preserve the ability to scale individual platform components as usage grows.
6. Establish security and audit boundaries appropriate for healthcare workflows.

## System Overview

CareIQ currently consists of three primary runtime layers.

```text
┌──────────────────────────────┐
│          Clients             │
│                              │
│  Web App        Future Mobile│
│  Next.js        Applications │
└──────────────┬───────────────┘
               │
               │ HTTPS
               ▼
┌──────────────────────────────┐
│          CareIQ API          │
│                              │
│ Node.js + TypeScript         │
│ Versioned REST API           │
│ Authentication               │
│ Authorization                │
│ Business Logic               │
│ Tenant Context               │
└──────────────┬───────────────┘
               │
               │ Drizzle ORM
               ▼
┌──────────────────────────────┐
│         PostgreSQL           │
│                              │
│ Domain Data                  │
│ Tenant Isolation / RLS       │
│ Audit Data                   │
│ Schema Migrations            │
└──────────────────────────────┘
```

External services such as authentication, file storage, messaging, asynchronous processing, and other integrations are introduced behind application boundaries as needed.

## Repository Architecture

CareIQ uses a monorepo.

```text
apps/
    api/
    web/

packages/
    shared packages

docs/
    architecture documentation
    architecture decisions
    product documentation
```

Deployable applications live under `apps`.

Reusable code that is not independently deployed lives under `packages`.

Engineering and product decisions live under `docs`.

## Web Application

The web application is implemented using Next.js, React, and TypeScript.

Its responsibilities include:

* User interaction
* Authentication flows
* Practice administration
* Front-office workflows
* Calling CareIQ backend APIs
* Presenting authorized application data

Business and data-access logic should remain in the backend rather than being duplicated in the web client.

## Backend API

The CareIQ API is implemented using Node.js and TypeScript.

Application APIs are versioned under:

```text
/api/v1
```

The API is responsible for:

* Authentication verification
* Tenant resolution
* Authorization
* Domain logic
* Data access
* Validation
* Audit context
* Integration boundaries

Infrastructure endpoints such as:

```text
/health
```

remain outside application API versioning.

## Authentication

Authentication is delegated to Clerk.

Clerk establishes user identity.

CareIQ remains responsible for application authorization, including:

* Practices
* Memberships
* Roles
* Permissions
* Tenant context
* Resource-level authorization

Authentication and application authorization are intentionally treated as separate concerns.

## Multi-Tenancy

CareIQ uses a shared multi-tenant SaaS model.

Multiple healthcare practices operate within the same hosted application and database infrastructure.

A practice acts as the primary tenant boundary.

Tenant-scoped domain records contain the tenant identifier necessary to associate data with the appropriate practice.

## Tenant Data Isolation

PostgreSQL Row-Level Security is used as a database-level enforcement mechanism for tenant isolation.

The intended request flow is:

```text
Authenticated User
       │
       ▼
Resolve CareIQ Membership
       │
       ▼
Resolve Practice / Tenant
       │
       ▼
Establish Database Tenant Context
       │
       ▼
Execute Query
       │
       ▼
PostgreSQL RLS Enforces Access
```

Application authorization remains necessary.

RLS provides an additional security boundary rather than replacing application-level authorization.

## Database

PostgreSQL is the primary transactional database.

Drizzle ORM is used as the application's database access layer and migration system.

Schema changes should be represented through version-controlled migrations rather than manually changing production schemas.

## Identifier Strategy

Domain entities use UUIDv7 identifiers.

UUIDv7 provides globally unique identifiers while retaining useful time-ordering characteristics.

Identifiers should be generated consistently through the application's established ID strategy rather than mixing identifier formats between domains.

## Audit Architecture

CareIQ distinguishes operational application logging from domain audit history.

Application logs support:

* Diagnostics
* Observability
* Infrastructure investigation
* Runtime troubleshooting

Audit records support:

* Who performed an action
* What entity was affected
* When the action occurred
* Relevant before/after context where appropriate
* Compliance and security investigation

Audit history is designed to be append-only rather than normal mutable application data.

## Background Processing

Work that does not need to complete synchronously with an HTTP request should eventually move behind the platform's background-processing boundary.

Potential examples include:

* Document processing
* Notification delivery
* Data synchronization
* AI-assisted processing
* Report generation
* Long-running integration workflows

The architecture allows a job-processing system to be introduced without requiring the HTTP API to own long-running execution.

## File Storage

Large files and uploaded documents should not be stored directly inside normal relational database rows.

PostgreSQL stores file metadata and domain relationships.

Binary objects will use a dedicated object-storage layer.

## Deployment

CareIQ currently uses Render for hosted application and PostgreSQL infrastructure.

The platform initially favors operational simplicity over premature distributed-system complexity.

Applications can later be scaled independently as traffic and workload characteristics become known.

A dedicated load-balancing or microservice architecture is not required at the current stage.

## Configuration and Secrets

Runtime configuration is environment-specific.

Secrets are never committed to source control.

Examples include:

* Database credentials
* Authentication secrets
* External API keys
* Storage credentials

Hosted environments receive configuration through the deployment platform.

Local development uses ignored environment files.

## Scaling Philosophy

CareIQ begins as a modular application rather than a collection of microservices.

This avoids introducing network boundaries, deployment complexity, distributed transactions, and additional operational overhead before they are justified.

Domain boundaries should nevertheless remain clear enough that high-load functionality can eventually be extracted into independent services when real usage demonstrates the need.

## Architecture Decision Records

Specific architectural decisions and alternatives are maintained under:

[`docs/decisions`](./decisions)

The ADR collection is the authoritative location for explaining why major architectural decisions were made.
