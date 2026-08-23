# ADR-008: Database Access Layer

**Status:** Accepted

## Context

CareIQ uses PostgreSQL as its primary transactional database as defined in ADR-006.

CareIQ uses a shared database and shared schema architecture with PostgreSQL Row-Level Security to enforce tenant isolation as defined in ADR-007.

The platform requires a consistent and type-safe approach for backend services to access PostgreSQL.

Database access must support:

- TypeScript.
- PostgreSQL-native capabilities.
- Transactions.
- Tenant-scoped database operations.
- PostgreSQL Row-Level Security.
- Version-controlled schema changes and migrations.

CareIQ should avoid scattering database queries throughout routes, controllers, or other application layers.

The database access approach should provide useful abstractions without introducing unnecessary architectural complexity.

## Decision

CareIQ will use Drizzle ORM as its primary database access layer for PostgreSQL.

Drizzle will be used for database schema definitions, type-safe queries, relationships, migrations, and transaction management.

PostgreSQL-native capabilities and parameterized SQL may be used when they provide a clearer, safer, or more efficient implementation than forcing an operation through an abstraction.

Drizzle will not be treated as a requirement to avoid PostgreSQL-specific functionality.

### Database Access Boundary

Client applications must not directly access PostgreSQL.

All application database access must occur through CareIQ backend services or explicitly authorized backend processes.

Database queries must not be scattered throughout routes, controllers, or client application code.

Backend modules may access the shared database layer directly when the resulting implementation remains clear and maintainable.

A repository or dedicated data-access abstraction may be introduced when the complexity of a domain module justifies it.

CareIQ will not require a repository pattern for every entity or database table.

### Tenant-Scoped Access

Database access to tenant-owned data must comply with the tenant isolation architecture defined in ADR-007.

Tenant context must be established through a centralized and reusable database access mechanism.

The mechanism must establish the authorized `practice_id` within the database transaction before tenant-owned data is accessed.

The tenant context must remain transaction-scoped and must not persist across pooled database connections.

Application code should use the centralized tenant-scoped access mechanism rather than manually establishing tenant context throughout the codebase.

### Raw SQL

Parameterized raw SQL may be used when appropriate.

Examples include:

- Establishing transaction-scoped tenant context.
- Using PostgreSQL-native capabilities.
- Complex reporting or analytical queries.
- Performance-sensitive operations.
- Database-specific functions or features.

Raw SQL must:

- Use parameterized values.
- Execute through the approved database access layer.
- Respect transaction boundaries.
- Comply with tenant isolation requirements.

Raw SQL must not be used to bypass authorization or Row-Level Security protections.

### Schema and Migrations

Database schema changes must be version-controlled.

Changes to database tables, relationships, indexes, constraints, PostgreSQL roles, Row-Level Security policies, and other managed database objects must be represented through the approved schema and migration process where supported by the selected tooling.

Database changes must not rely on undocumented manual modifications to production databases.

The specific deployment and CI/CD process used to apply migrations will be defined separately.

## Consequences

Drizzle provides CareIQ with a TypeScript-native database access layer while maintaining close access to PostgreSQL capabilities.

The platform can use type-safe queries and schema definitions without preventing the use of PostgreSQL-specific functionality.

Centralizing tenant-scoped database access reduces the likelihood that developers will inconsistently establish tenant context.

The architecture avoids requiring unnecessary repository abstractions while allowing more specialized data-access layers to be introduced as modules become more complex.

Version-controlled migrations provide a consistent and traceable process for evolving the CareIQ database schema.

CareIQ becomes dependent on Drizzle as its primary database access and schema management tool.

Developers must understand the interaction between Drizzle transactions, PostgreSQL connection pooling, and Row-Level Security to ensure tenant isolation is implemented correctly.