# CareIQ Development

This document describes the current CareIQ development workflow and engineering conventions.

CareIQ is under active development, so these conventions may evolve as the platform matures.

## Prerequisites

Local development currently requires:

* Node.js
* pnpm
* PostgreSQL access
* Clerk development credentials

Verify pnpm:

```bash
pnpm --version
```

## Install Dependencies

From the repository root:

```bash
pnpm install
```

CareIQ uses a pnpm workspace.

Dependencies should normally be installed from the repository root or explicitly targeted to a workspace package.

Example:

```bash
pnpm --filter ./apps/api add <package>
```

## Applications

The primary applications are:

```text
apps/api
apps/web
```

### API

Run the backend API:

```bash
pnpm --filter ./apps/api dev
```

The API runs locally on its configured port.

The health endpoint can be used to verify that the service is running:

```text
GET /health
```

### Web

Run the web application:

```bash
pnpm --filter ./apps/web dev
```

The web application communicates with the backend through its configured API URL.

Do not hard-code localhost URLs into production application code.

## Environment Variables

Environment configuration must not be committed.

Local environment files should remain ignored by Git.

Typical configuration includes:

```text
DATABASE_URL
Clerk configuration
API URLs
environment-specific secrets
```

Hosted environments receive equivalent values through Render environment configuration.

Never place secrets directly inside committed source files.

## Database Development

The API owns the CareIQ database schema.

Database changes should be made through the established Drizzle schema and migration workflow.

Migrations should be:

* Version controlled
* Deterministic
* Reviewed before execution
* Tested against the development database
* Applied through the migration tooling

Avoid making schema changes manually through pgAdmin unless troubleshooting or performing deliberate development cleanup.

Manual data changes and schema migrations are different operations.

Removing temporary development rows through a SQL client is acceptable when the data itself is disposable.

Schema definitions should remain migration-driven.

## Database Safety

Before committing database changes:

1. Confirm the migration represents the intended schema.
2. Confirm credentials or connection strings are not included.
3. Confirm development-only seed or test data is not part of the migration.
4. Confirm migrations can run from a clean database state where practical.
5. Confirm tenant-aware tables follow the established tenant model.

## Multi-Tenant Development

Tenant-scoped functionality must account for practice isolation.

Developers should not rely exclusively on user-supplied tenant identifiers.

Tenant context must ultimately be derived from authenticated application context and enforced through both application authorization and PostgreSQL Row-Level Security.

## API Conventions

Versioned application endpoints live under:

```text
/api/v1
```

Examples:

```text
GET /api/v1/me
GET /api/v1/appointments
```

Infrastructure endpoints do not require application versioning.

Example:

```text
GET /health
```

API responses should use predictable structures and error codes.

Authentication and authorization failures should be intentional and explicit rather than leaking lower-level database errors to clients.

## TypeScript

CareIQ uses TypeScript across the web and API applications.

Avoid introducing `any` where a meaningful domain type can be defined.

Types shared by multiple applications may eventually move into packages under:

```text
/packages
```

Application-specific implementation types should remain within the owning application.

## Formatting

Repository formatting is controlled through the root Prettier and EditorConfig configuration.

Before committing, source files should conform to repository formatting conventions.

## Git Workflow

Development work should be committed in logical units.

Before committing:

```bash
git status
git diff
```

Review both commands rather than blindly staging the entire repository.

Then stage the intended changes:

```bash
git add .
```

Review the staged changes:

```bash
git diff --staged
```

Commit:

```bash
git commit -m "<message>"
```

Push the working branch:

```bash
git push
```

## Commit Guidelines

Commit messages should describe the completed unit of work rather than individual debugging steps.

Prefer:

```text
feat: establish appointment persistence and database migrations
```

or:

```text
chore: clean development data and update project documentation
```

Avoid messages such as:

```text
fix stuff
```

or:

```text
testing again
```

Intermediate experimentation belongs in the development process, not necessarily in permanent Git history.

## Temporary Code

Temporary debugging scripts, console output, test files, generated data, and one-off database scripts should be reviewed before committing.

A temporary file should only remain in the repository if it has continuing development value.

Useful repeatable diagnostic utilities should be intentionally named and documented rather than kept as unexplained test scripts.

## Documentation

Significant architectural decisions should be recorded as ADRs.

Use an ADR when a decision:

* Has long-term architectural consequences
* Would be costly to reverse
* Establishes a project-wide convention
* Selects between meaningful architectural alternatives

Routine implementation choices do not require an ADR.

Higher-level architecture belongs in:

```text
docs/architecture.md
```

Product direction belongs in:

```text
docs/product-vision.md
```

## Engineering Philosophy

CareIQ favors:

* Clear domain boundaries
* Incremental vertical slices
* Explicit architecture decisions
* Security boundaries established early
* Simple infrastructure until greater complexity is justified
* Database integrity over application assumptions
* Production-minded engineering without premature scaling

The objective is to build the smallest architecture that can safely evolve into the larger CareIQ platform.
