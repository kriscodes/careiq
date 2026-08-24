Everything inside the outer block is the contents of `014-environment-configuration-and-secrets-management.md`.

````md
# ADR-014: Environment, Configuration, and Secrets Management

**Status:** Accepted

## Context

CareIQ will operate across multiple deployment environments throughout development, testing, and production.

The platform requires clear boundaries between environments so that configuration, credentials, data, integrations, and infrastructure belonging to one environment do not unintentionally affect another.

CareIQ is also being designed as a multi-tenant healthcare-focused SaaS platform.

Environment isolation and tenant isolation are separate architectural concerns.

CareIQ Practices will share the appropriate CareIQ production environment while remaining isolated through the multi-tenant architecture, authorization model, PostgreSQL Row-Level Security, and other controls established by previous architectural decisions.

CareIQ must also manage sensitive configuration including:

- Database credentials.
- Authentication credentials.
- Object-storage credentials.
- API keys.
- OAuth credentials.
- Integration credentials.
- Signing secrets.
- Encryption-related secrets.
- Service account credentials.
- Third-party service credentials.
- Other protected configuration.

These values must not be hardcoded into application source code or committed to version control.

The configuration architecture must support secure deployment, credential rotation, local development, automated deployment, and future infrastructure changes without requiring application code to contain environment-specific secrets.

## Decision

CareIQ will maintain isolated deployment environments with environment-specific configuration, credentials, data, and infrastructure resources.

The initial environment model will include:

```text
Local / Development
        │
        ▼
     Staging
        │
        ▼
    Production
```

Each environment must use its own protected configuration and credentials.

Production credentials and production data must not be casually reused in non-production environments.

Deployment-specific configuration will be provided externally to application code through environment configuration or an equivalent approved configuration mechanism.

Secrets must never be committed to source control.

CareIQ applications will use a centralized, validated, typed configuration layer rather than accessing environment variables throughout the codebase without validation.

## Environment Separation

CareIQ environments will remain logically and operationally separated.

At minimum, CareIQ will maintain:

- Local or development environments.
- A staging environment.
- A production environment.

Additional environments may be introduced later when required.

Examples may include:

- Automated test environments.
- Preview environments.
- Integration testing environments.
- Performance testing environments.
- Disaster recovery environments.

The addition of another environment does not require a new ADR unless it materially changes the environment architecture.

## Local and Development Environment

Local development environments exist for developer implementation, testing, and debugging.

Local development must not require production credentials.

Developers should use development-specific resources or approved local equivalents.

Local configuration may use `.env`-style files or equivalent developer tooling when appropriate.

Actual local secret files must not be committed to Git.

A safe example configuration file may be committed to document required configuration.

For example:

```text
.env.example
```

An example configuration file may contain:

```text
DATABASE_URL=
CLERK_SECRET_KEY=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
```

but must not contain real credentials.

Local development tools, test data, and development shortcuts must not automatically become available in production.

## Staging Environment

CareIQ will maintain a staging environment that approximates production architecture closely enough to validate application behavior before production deployment.

Staging must use its own:

- Database.
- Authentication configuration.
- Object storage.
- API credentials.
- Integration credentials.
- Service credentials.
- Signing credentials.
- Environment configuration.

Staging must not use the production database as its ordinary data source.

Staging must not use production credentials merely for convenience.

Where external integrations provide sandbox or testing environments, staging should use those environments when practical.

Staging data should use synthetic, test, de-identified, or otherwise appropriately approved data.

Production sensitive data must not be copied into staging without an explicitly approved process and appropriate safeguards.

## Production Environment

Production contains live CareIQ customer workloads and data.

Production configuration and credentials must be treated as protected operational assets.

Production must not depend on developer-local configuration.

Development-only functionality must not automatically be available in production.

Examples of functionality that should be disabled, removed, or explicitly restricted in production include:

- Test endpoints.
- Development authentication bypasses.
- Seed operations.
- Destructive development utilities.
- Debug interfaces.
- Unrestricted database tools.
- Mock integrations.
- Development-only administrative shortcuts.

Production access must follow the principle of least privilege.

## Multi-Tenant Production Model

CareIQ will operate as a shared multi-tenant SaaS platform.

A separate production environment will not be created for every Practice merely because Practices are separate tenants.

The normal architecture is:

```text
CareIQ Production
        │
        ├── Practice A
        ├── Practice B
        ├── Practice C
        └── ...
```

Tenant isolation will be provided through the CareIQ multi-tenant architecture, including:

- Tenant ownership.
- Authentication.
- RBAC.
- Backend authorization.
- PostgreSQL Row-Level Security.
- Tenant-scoped database context.
- Audit controls.

The normal architecture will not be:

```text
Practice A
    └── Dedicated CareIQ Production Environment

Practice B
    └── Dedicated CareIQ Production Environment

Practice C
    └── Dedicated CareIQ Production Environment
```

A dedicated customer deployment may only be introduced in the future when justified by explicit contractual, regulatory, security, operational, or business requirements.

Such a deployment model would require separate architectural consideration.

## Environment-Specific Resources

Infrastructure resources should be isolated by environment where appropriate.

Examples include:

```text
Development Database
Staging Database
Production Database
```

and:

```text
Development Object Storage
Staging Object Storage
Production Object Storage
```

and:

```text
Development Authentication Configuration
Staging Authentication Configuration
Production Authentication Configuration
```

The same principle applies to:

- OAuth applications.
- Webhook credentials.
- API keys.
- Service accounts.
- Integration credentials.
- Encryption or signing credentials.
- Third-party services.

A compromise or configuration error in one environment should not automatically grant access to another environment.

## Configuration

Deployment-specific configuration must remain outside application source code.

Examples include:

- Database URLs.
- Service endpoints.
- Storage bucket names.
- Authentication configuration.
- Feature configuration.
- Integration endpoints.
- Operational settings.

Applications may receive this configuration through:

- Environment variables.
- Protected platform configuration.
- Secret-management systems.
- Other explicitly approved runtime configuration mechanisms.

Environment-specific values must not require separate source-code branches.

For example, CareIQ should avoid logic such as:

```text
if production:
    database = hardcoded_production_database

if staging:
    database = hardcoded_staging_database
```

The application should instead consume validated configuration supplied by its deployment environment.

## Typed Configuration

CareIQ applications will use a centralized configuration layer.

Application modules should not independently access raw environment variables throughout the codebase when those values can be represented through the centralized configuration system.

Conceptually:

```text
Runtime Environment
        │
        ▼
Configuration Loader
        │
        ▼
Validation
        │
        ▼
Typed CareIQ Configuration
        │
        ▼
Application
```

Because CareIQ uses TypeScript, validated configuration should expose typed values to the application.

For example, application code should conceptually depend on:

```text
config.database.url
config.auth.secret
config.storage.bucket
```

rather than repeatedly reading:

```text
process.env.DATABASE_URL
process.env.CLERK_SECRET_KEY
process.env.OBJECT_STORAGE_BUCKET
```

throughout unrelated modules.

The exact configuration validation library will be selected during implementation.

## Configuration Validation

CareIQ applications must validate required configuration during startup.

Missing or invalid required configuration should cause the application to fail fast rather than start in a partially configured state.

Examples include:

- Missing database configuration.
- Missing authentication credentials.
- Invalid environment names.
- Missing required storage configuration.
- Invalid service endpoints.
- Missing required signing credentials.

Conceptually:

```text
Application Start
       │
       ▼
Load Configuration
       │
       ▼
Validate Configuration
       │
       ├── Valid
       │      │
       │      ▼
       │   Start Application
       │
       └── Invalid
              │
              ▼
           Fail Fast
```

Failure messages must identify configuration problems without exposing secret values.

## Secrets

Secrets are configuration values that must not be exposed to unauthorized users, client applications, source control, logs, or documentation.

Examples include:

- Passwords.
- Database credentials.
- API secrets.
- OAuth client secrets.
- Private keys.
- Signing secrets.
- Encryption keys.
- Service account credentials.
- Object-storage credentials.
- Webhook signing secrets.

Secrets must not be:

- Hardcoded in source code.
- Committed to Git.
- Stored in public documentation.
- Included in `.env.example`.
- Returned to client applications.
- Intentionally written to application logs.
- Intentionally written to audit records.

## Secret Storage

CareIQ will initially use protected secret-management capabilities provided by the deployment platform or another approved secure runtime mechanism.

ADR-014 does not select a specific secrets-management vendor.

CareIQ may later adopt dedicated infrastructure such as a managed secrets service or another specialized secrets-management platform.

Changing the secrets-management provider does not require a new ADR unless the change materially alters the security or configuration architecture.

The architectural requirement is that secrets remain externally managed and securely injected into authorized workloads.

## Secret Rotation

CareIQ credentials and secrets must be designed to support rotation.

Rotating a credential should not require modifying application source code.

Where supported by the underlying provider, CareIQ should allow credentials to be:

- Replaced.
- Revoked.
- Rotated.
- Reissued.

Applications should obtain the active credential from approved runtime configuration.

Systems that support overlapping credentials may use controlled transition periods to enable rotation without unnecessary downtime.

The exact rotation schedule may vary according to credential type and applicable security requirements.

## Secret Exposure

CareIQ must minimize the number of components and people that can access secrets.

A component should receive only the secrets required for its responsibilities.

For example:

```text
Web Client
    │
    └── No Database Credentials

API
    │
    ├── Database Credentials
    └── Required Backend Service Credentials

Background Worker
    │
    └── Only Credentials Required for Worker Operations
```

Secrets intended exclusively for backend workloads must never be exposed through frontend build-time environment variables or client bundles.

## Logging and Secrets

Application logs must not intentionally contain:

- Passwords.
- API keys.
- Authentication tokens.
- Refresh tokens.
- Private keys.
- Database connection strings containing credentials.
- OAuth client secrets.
- Signing secrets.
- Other protected credentials.

CareIQ logging infrastructure should support redaction or filtering where practical to reduce accidental secret exposure.

Errors involving secrets must report the configuration problem without reporting the secret value.

## Audit Records and Secrets

The Audit domain defined in ADR-010 must not store secret values.

Audit events may record that a credential-related action occurred.

For example:

```text
integration.api_key.rotated
integration.credential.revoked
service_account.credential_created
```

but the credential value itself must not appear in the audit record.

Credential management operations should be auditable without exposing the credential.

## Authentication Configuration

CareIQ authentication environments must remain separated.

Clerk configuration used for development, staging, and production must use environment-appropriate credentials and configuration.

Production authentication credentials must not be embedded into development or staging applications.

Authentication configuration must follow ADR-005 and the environment boundaries defined in this decision.

## Database Configuration

Each CareIQ environment must use the database resources intended for that environment.

Production database credentials must not be used for ordinary local or staging application execution.

Database connection configuration must remain server-side.

Client applications must never receive direct database credentials.

Database roles should follow least-privilege principles and may differ according to workload responsibilities.

## Object Storage Configuration

Object storage configuration defined in ADR-013 must remain environment-specific.

For example:

```text
Development
    └── Development Bucket

Staging
    └── Staging Bucket

Production
    └── Production Bucket
```

A development upload must not accidentally become a production document.

Storage credentials must remain protected and server-side.

## Integration Configuration

External integrations must support environment-specific configuration.

Where an external provider supports sandbox environments, staging and development should use those environments when practical.

Production integration credentials must not be reused in non-production environments merely for convenience.

Webhook endpoints and signing secrets should be environment-specific where supported.

## CI/CD Secrets

Automated build and deployment systems may require access to protected configuration.

CI/CD systems must receive only the credentials required for the specific environment and operation.

A staging deployment should not automatically receive production credentials.

A build process that does not require runtime secrets should not receive them unnecessarily.

Production deployment credentials must be protected according to the capabilities of the CI/CD and hosting infrastructure.

## Feature Flags

CareIQ may use feature flags or runtime configuration for behavior that must vary independently of deployment.

Examples may include:

- Gradual feature rollout.
- Experimental functionality.
- Tenant-specific feature availability.
- Operational kill switches.
- Controlled integration rollout.

Feature flags must not become a substitute for authorization.

A disabled or enabled feature does not determine whether an actor is authorized to access protected data.

Authorization must continue to use CareIQ RBAC and tenant controls.

## Tenant-Specific Configuration

CareIQ may support tenant-specific application configuration.

Examples may include:

- Enabled features.
- Workflow settings.
- Integration configuration.
- Practice preferences.
- Notification preferences.

Tenant-specific configuration is application data and should normally be stored within CareIQ's tenant-aware data model rather than creating tenant-specific deployment environments.

Conceptually:

```text
CareIQ Production
        │
        ├── Practice A Configuration
        ├── Practice B Configuration
        └── Practice C Configuration
```

Tenant configuration must remain subject to tenant isolation, authorization, and auditing where appropriate.

## Environment Identification

Every CareIQ runtime must have an explicit environment identity.

Examples may include:

```text
development
staging
production
```

The application must not infer production status solely from incidental infrastructure characteristics.

Environment identity should be explicitly configured and validated.

Environment identity may be included in operational logs and telemetry when useful.

## Production Safety

CareIQ must treat production as a protected environment.

Operations capable of destructive or unusually privileged behavior should require stronger safeguards in production.

Examples may include:

- Database resets.
- Bulk deletion.
- Data seeding.
- Test-user creation.
- Debug bypasses.
- Manual tenant reassignment.
- Retention disposition.
- Audit maintenance operations.

Development utilities should fail closed or be unavailable when executed against production unless explicitly designed and authorized for production use.

## Data Movement Between Environments

CareIQ must not casually copy production data into non-production environments.

When production data must be used outside production for an explicitly approved reason, the process must consider:

- Sensitive data.
- PHI.
- PII.
- Tenant authorization.
- De-identification.
- Data minimization.
- Security controls.
- Audit requirements.
- Contractual obligations.
- Regulatory requirements.

Synthetic or purpose-built test data should be preferred for ordinary development and staging.

## Configuration Changes

Meaningful security-sensitive or operational configuration changes should be auditable where appropriate.

Examples may include:

- Integration credential changes.
- Tenant security configuration.
- Authentication configuration changes.
- Privileged feature enablement.
- Service-account changes.
- Security-related feature flags.

The exact set of auditable configuration operations will evolve with the CareIQ domain.

## Configuration Ownership

Configuration should be owned by the component or domain responsible for its behavior.

CareIQ should avoid a single uncontrolled collection of unrelated configuration values without validation or ownership.

Shared configuration may be centralized where appropriate, while domain-specific configuration should remain clearly attributable to the relevant component or domain.

## Failure Behavior

CareIQ should prefer failing safely when required configuration is unavailable or invalid.

For security-critical configuration, the application must not silently substitute insecure defaults.

Examples include:

```text
Missing authentication secret
    → Do not start protected service

Missing database tenant configuration
    → Do not bypass tenant isolation

Missing encryption configuration
    → Do not silently store unencrypted sensitive data
```

Fallback behavior may be used only when the fallback is explicitly safe and intentionally designed.

## Future Infrastructure Changes

The environment and configuration architecture must remain portable across hosting providers.

CareIQ may initially use the configuration and secret capabilities provided by its selected hosting platform.

Future migration to another infrastructure provider should not require rewriting application business logic because secrets or environment-specific values were hardcoded.

This ADR intentionally separates configuration architecture from infrastructure-provider selection.

## Consequences

CareIQ will maintain clear separation between local/development, staging, and production environments.

Each environment will use separate credentials, configuration, data, and infrastructure resources where appropriate.

Production data and credentials will not be casually reused outside production.

CareIQ remains a shared multi-tenant SaaS platform rather than creating a separate deployment for every Practice.

Tenant-specific behavior will normally be represented through tenant-aware application configuration rather than separate infrastructure.

Deployment-specific configuration remains outside application source code.

A centralized typed configuration layer provides validated configuration to TypeScript applications.

Applications fail fast when required configuration is missing or invalid.

Secrets are never committed to source control and are not intentionally exposed through application logs or audit records.

Secrets remain rotatable without requiring application source-code changes.

Environment-specific database, authentication, storage, and integration resources reduce the risk of cross-environment access.

Feature flags allow controlled behavior changes without becoming a replacement for authorization.

Production safety controls prevent development utilities and insecure shortcuts from becoming ordinary production capabilities.

CareIQ avoids unnecessary movement of production-sensitive data into development and staging.

The architecture remains independent of a specific secret-management or hosting provider.

This design introduces additional operational responsibility involving:

- Environment management.
- Secret storage.
- Credential rotation.
- Configuration validation.
- Environment-specific resources.
- Production access controls.
- CI/CD security.
- Feature configuration.
- Safe data movement.

This complexity is accepted because strong environment and configuration boundaries are foundational to CareIQ security, reliability, maintainability, and future compliance requirements.
````
