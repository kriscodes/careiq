# CareIQ

Security implementation and rollout: [hardening guide](docs/security-hardening.md) · [release status and owner actions](docs/deployment/security-release-status.md).

CareIQ is a healthcare operations platform being built for small and independent medical practices.

The platform is focused on reducing administrative workload around patient intake, scheduling, referrals, document collection, communication, and other front-office workflows.

Manager dashboard and manual insurance verification: [implementation and audit coverage](docs/manager-insurance-implementation.md).

## Status

🚧 **Active development**

**Latest tagged release: [v0.1.0 — Interview baseline](docs/releases/0.1.0.md)** · October 3, 2026 · Synthetic/demo use only.

See the [version history](CHANGELOG.md) and [release process](docs/releasing.md). The implementation below is subsequent unreleased work; it does not change the deployed release.

CareIQ now includes the local staff workflow across web and API/PostgreSQL: scheduling, patient profiles, document/version review, requirement evidence, templates, restricted patient collection/signing and protected audit review.

Start with the [workflow implementation and review guide](docs/workflow-implementation.md), [runtime API contract](docs/design/workflow/runtime-contract.md) and [OpenAPI payload/response definitions](docs/api/workflow.openapi.json). The [interactive workflow preview](http://localhost:3101/workflow-preview) uses clearly labeled synthetic data; the authenticated workspace writes to the configured API/database. Local review uses isolated databases and existing test authentication. Delivery/scanning/storage activation and physical device acceptance are documented explicitly; no deployment was performed.

October 17: the [Forms Studio and patient paperwork implementation](docs/forms-studio-implementation.md) adds guided forms, immutable submissions, reviewed demographic changes and an authenticated completed-copy library. The guide identifies supported adult-self signing, account-grant expiry and the remaining email/provider activation boundaries.

Owner-controlled account, hosting, storage, backup and release measures are listed in the [security checklist](docs/security/owner-security-checklist.md). Local safeguards and hosted acceptance are tracked separately.

The previous [interview design](docs/design/interview-v0.1.md) and [authentication/onboarding guide](docs/auth-onboarding.md) remain reference material and supported paths.

## Initial Product Direction

The initial target customer is an independent healthcare practice with approximately 2–10 providers.

CareIQ is designed as a multi-tenant SaaS platform where multiple practices operate within the same hosted application while maintaining strict tenant-level data isolation.

Initial workflow areas include:

* Patient intake
* Appointment scheduling
* Practice and provider management
* Referral workflows
* Document collection
* Administrative task automation
* Patient communication
* Operational dashboards
* Future AI-assisted workflow capabilities

The goal is not to replace an EHR. CareIQ is intended to improve the operational workflows surrounding existing clinical systems.

## Architecture

CareIQ uses an API-first, multi-tenant architecture.

```text
                    ┌─────────────────────┐
                    │      Web App        │
                    │   Next.js / React   │
                    └──────────┬──────────┘
                               │
                               │ HTTPS / REST
                               ▼
                    ┌─────────────────────┐
                    │     CareIQ API      │
                    │ Node.js / TypeScript│
                    └──────────┬──────────┘
                               │
                               │ Drizzle ORM
                               ▼
                    ┌─────────────────────┐
                    │     PostgreSQL      │
                    │ RLS tenant isolation│
                    └─────────────────────┘

Authentication: Clerk
Infrastructure: Render
```

Native mobile source was separated from this checkout on October18,2026 and preserved locally for a future repository. The backend practice/location and gated native-auth contracts remain available for that future client. See [mobile separation and recovery](docs/mobile-separation.md).

## Technology Stack

| Layer              | Technology                    |
| ------------------ | ----------------------------- |
| Web                | Next.js, React, TypeScript    |
| API                | Node.js, TypeScript           |
| Database           | PostgreSQL                    |
| ORM                | Drizzle ORM                   |
| Authentication     | Clerk                         |
| Multi-tenancy      | PostgreSQL Row-Level Security |
| Identifiers        | UUIDv7                        |
| Package Management | pnpm                          |
| Repository         | Monorepo                      |
| Hosting            | Render                        |

## Repository Structure

```text
careiq/
├── apps/
│   ├── api/            # Backend API
│   ├── web/            # Authenticated web application
│   └── marketing/      # Public static website and discovery-interview form
│
├── packages/           # Shared packages and reusable code
│
├── docs/
│   ├── decisions/      # Architecture Decision Records
│   ├── architecture.md
│   ├── development.md
│   └── product-vision.md
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Core Architecture Principles

### Multi-Tenant by Default

CareIQ is built as a shared SaaS platform rather than deploying a separate application for every healthcare practice.

Tenant-aware domain data is associated with a practice and protected at the database layer using PostgreSQL Row-Level Security.

### API-First

Business capabilities are exposed through a versioned backend API.

The web application is one client of that API rather than containing the primary business logic itself.

### Database-Level Tenant Isolation

Application-level authorization is not considered sufficient protection for tenant data.

PostgreSQL Row-Level Security provides an additional enforcement boundary for tenant isolation.

### External Identity, Internal Authorization

Clerk provides user identity and authentication.

CareIQ maps the authenticated Clerk organization to an internal practice. The API enforces fresh membership, explicit permissions and assigned-location access. Verified approved founders create practices through controlled onboarding; reading session context does not provision an organization or practice.

### Auditable Healthcare Workflows

The architecture is being designed with auditability, structured logging, security boundaries, and future healthcare compliance requirements in mind from the beginning.

## API

Versioned application endpoints use:

```text
/api/v1/*
```

Example:

```text
GET /api/v1/me
```

Infrastructure-level endpoints such as health checks are intentionally kept outside the versioned application API.

```text
GET /health
```

## Database

CareIQ currently uses PostgreSQL with Drizzle ORM.

Important database conventions include:

* UUIDv7 identifiers for domain entities
* Explicit foreign-key relationships
* Tenant-aware data modeling
* PostgreSQL Row-Level Security
* Append-only clinical/admin audit metadata with narrow runtime grants; separate protected search, evidence review and snapshot exports
* Version-controlled schema migrations

Database migrations are owned by the API application.

## Authentication and practice onboarding

The current designs and implementation are documented in [the authentication/onboarding guide](docs/auth-onboarding.md). Review [web, iOS and Android designs](docs/design/auth-onboarding/design-handoff.md) and the [interactive prototype](docs/design/auth-onboarding/prototype.html).

Use this existing checkout at `/Users/kristian/Documents/Server/CareIQ`; do not create fresh GitHub checkouts for routine work. The [local review guide](docs/local-review.md) starts isolated environments for these changes. No GitHub push or remote deployment was performed.

## Local Development

Install dependencies from the repository root:

```bash
pnpm install
```

Run the API:

```bash
pnpm --filter ./apps/api dev
```

Run the web application:

```bash
pnpm --filter ./apps/web dev
```

Environment-specific configuration is supplied through local environment files and deployment environment variables.

Secrets must never be committed to the repository.

See [`docs/development.md`](docs/development.md) for additional development information.

## Architecture Decisions

Important architectural decisions are documented using Architecture Decision Records (ADRs).

See:

[`docs/decisions`](docs/decisions)

Current decisions cover areas including:

* Repository architecture
* API-first platform design
* Integration architecture
* Multi-tenant SaaS architecture
* Authentication and authorization
* PostgreSQL database platform
* Tenant data isolation
* Database access strategy
* Identifier strategy
* Audit logging
* API versioning
* Background jobs
* File storage
* Secrets management
* Deployment infrastructure

ADRs record why a decision was made, not just what technology was selected.

## Environments

CareIQ currently uses separate local development and hosted development environments.

Production infrastructure will be introduced as the platform approaches external practice usage.

## Security

CareIQ deals with healthcare workflows and is therefore being designed with security boundaries established early in the architecture.

Current design considerations include:

* Tenant isolation
* Role-based authorization
* Secure external authentication
* Database-level access controls
* Immutable audit history
* Secrets management
* Structured application logging
* Least-privilege database access

Formal compliance requirements and controls will evolve as the product approaches real patient data and production healthcare deployments.

## Documentation

* [Patient delivery and staff notification implementation](docs/notifications-implementation.md) — configuration, queued delivery, recipient inbox, permissions and verification limits.
* [Notification verification record](docs/verification/notifications-2026-10-18/README.md) — staged checks and outstanding acceptance.

* [Patient delivery and staff notification designs](docs/design/patient-delivery-and-staff-notifications/design-handoff.md) — proposed UI, API and delivery architecture; no provider activation.

* [Workflow implementation and review](docs/workflow-implementation.md)
* [Workflow API contract](docs/design/workflow/runtime-contract.md)
* [OpenAPI definitions](docs/api/workflow.openapi.json)
* [Public marketing website](docs/marketing.md)
* [Marketing verification](docs/marketing-verification.md)
* [Version history](CHANGELOG.md)
* [Release process and cadence](docs/releasing.md)
* [Product Vision](docs/product-vision.md)
* [Architecture](docs/architecture.md)
* [v0.1 — Interview Design](docs/design/interview-v0.1.md)
* [Interview architecture notes](docs/interview-architecture.md)
* [Development](docs/development.md)
* [Authentication and onboarding](docs/auth-onboarding.md)
* [Production-readiness status](docs/production-readiness.md)
* [Web production checks](docs/web-production-readiness.md)
* [API production checks](docs/api-production-release.md)
* [Mobile production checks](docs/mobile-production-readiness.md)
* [Local review environments](docs/local-review.md)
* [Interface languages and dropdown styling](docs/localization.md)
* [Mobile development](docs/mobile-development.md)
* [Practice/location access](docs/practice-access-implementation.md)
* [Security hardening](docs/security-hardening.md)
* [Releases](docs/releasing.md)
* [Verification record](docs/verification.md)
* [Architecture Decision Records](docs/decisions)

## Project Philosophy

CareIQ is being built incrementally around complete vertical workflows rather than attempting to build an entire practice-management platform at once.

Architecture decisions are made early where changing them later would be expensive, while product behavior remains flexible enough to evolve through customer discovery and real practice feedback.

Current local [security, login stability and capacity evidence](docs/verification/security-load-2026-10-17/README.md).

October 18 local main integration and refreshed end-to-end evidence: [PR #10 conflict-resolution verification](docs/verification/pr-10-main-2026-10-18/README.md). The merge remains uncommitted/unpushed at user request.
