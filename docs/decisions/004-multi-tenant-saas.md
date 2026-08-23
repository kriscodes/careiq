# ADR-004: Multi-Tenant SaaS Architecture

**Status:** Accepted

## Context

CareIQ is intended to serve multiple independent healthcare practices through a shared SaaS platform.

Deploying and maintaining a separate version of the CareIQ application for every practice would increase infrastructure costs, operational complexity, deployment overhead, and maintenance requirements.

A shared platform allows CareIQ to onboard new practices without creating a separate application or infrastructure stack for each customer.

Because CareIQ will manage practice-specific and potentially sensitive healthcare data, strict logical separation between each practice's data is required.

The architecture must ensure that users can only access data belonging to practices they are authorized to access.

## Decision

CareIQ will use a multi-tenant SaaS architecture.

A single hosted CareIQ platform will serve multiple independent healthcare practices.

Each healthcare practice will be represented as a tenant within the platform.

Each CareIQ Practice will correspond to a Clerk Organization.

Clerk Organizations will manage tenant membership and authorization context, while CareIQ will maintain the corresponding Practice record and own all CareIQ domain data associated with that practice.

Practice-specific data will be associated with a tenant, and tenant boundaries will be enforced throughout the application.

The platform will initially use logical tenant isolation within shared infrastructure.

Tenant-specific data will be associated with the appropriate practice or tenant identifier.

Authorization and data access controls must ensure that users can only access data belonging to tenants they are authorized to access.

The application architecture must prevent tenant context from being controlled solely by client applications. Tenant identification and authorization will be validated by the CareIQ backend.

The platform will be designed so that tenant-specific integrations, configuration, users, providers, and operational data can be managed independently.

## Consequences

CareIQ can onboard multiple practices without deploying a separate version of the platform for each customer.

Infrastructure and operational overhead will be lower than maintaining independent deployments for every practice.

Application updates and new features can be deployed across the platform without individually updating each customer's environment.

The application must consistently enforce tenant boundaries across authentication, authorization, API requests, database queries, background processes, integrations, and future services.

Failures in tenant isolation could expose one practice's data to another practice. Tenant isolation is therefore a critical security and architectural concern.

As CareIQ grows, specific customers or regulatory requirements may justify stronger isolation strategies, including dedicated databases or infrastructure. The initial architecture will preserve the ability to introduce those options without requiring a complete redesign.
