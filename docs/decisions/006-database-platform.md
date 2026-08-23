# ADR-006: Database Platform

**Status:** Accepted

## Context

CareIQ requires a reliable primary database for storing and managing its core domain data.

The platform will manage highly relational data across healthcare practices, including patients, providers, appointments, tasks, integrations, and future operational workflows.

CareIQ requires support for transactional consistency, referential integrity, complex querying, and future platform growth.

The platform also requires a clear separation between identity and access management data and CareIQ domain data.

Authentication, user identity, organization membership, roles, and permissions are managed by Clerk as defined in ADR-005.

CareIQ requires its own system of record for application-specific domain data.

## Decision

CareIQ will use PostgreSQL as its primary transactional database and system of record for CareIQ domain data.

PostgreSQL will store and manage CareIQ domain data, including practices, patients, providers, appointments, tasks, integrations, and other application-specific data.

Clerk will remain the authoritative system for identity and access management.

CareIQ's PostgreSQL database will store references to Clerk identifiers where required to establish relationships between Clerk-managed identities and CareIQ domain entities.

PostgreSQL-native capabilities may be used when they provide a clear technical or architectural benefit.

## Consequences

PostgreSQL provides a mature relational database platform with strong transactional guarantees, referential integrity, indexing, and support for complex queries.

CareIQ can model relationships between core healthcare and operational entities using a consistent relational data model.

The platform can use PostgreSQL-native capabilities when appropriate without requiring all database functionality to be abstracted behind a database-agnostic interface.

CareIQ introduces a dependency on PostgreSQL as its primary database technology.

Multi-tenant data isolation, database access tooling, identifier strategy, audit logging, and data lifecycle policies are intentionally addressed through separate architectural decisions.