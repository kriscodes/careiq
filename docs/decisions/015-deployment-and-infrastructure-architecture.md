Absolutely. Everything inside the outer block is the complete contents of `015-deployment-and-infrastructure-architecture.md`.

````md
# ADR-015: Deployment and Infrastructure Architecture

**Status:** Accepted

## Context

CareIQ requires a deployment and infrastructure architecture that supports the platform during initial development while preserving a clear path toward future growth.

CareIQ is being designed as a shared multi-tenant SaaS platform consisting of multiple independently deployable applications and services.

The platform may include:

- Web applications.
- API services.
- Background workers.
- PostgreSQL databases.
- Object storage.
- External integrations.
- Future mobile and tablet applications.
- Future specialized services.

CareIQ should be capable of scaling as customer and workload volume increases without requiring unnecessary infrastructure complexity during the early stages of the product.

The architecture must remain consistent with previously established decisions involving:

- Monorepo organization.
- Multi-tenancy.
- Authentication and authorization.
- PostgreSQL and Row-Level Security.
- Background jobs and asynchronous processing.
- File and document storage.
- Environment separation.
- Configuration and secrets management.
- Audit logging.
- API architecture.

CareIQ should avoid premature infrastructure complexity such as self-managed database clusters, dedicated load-balancer infrastructure, Kubernetes, or unnecessary microservices before demonstrated operational requirements justify them.

At the same time, early implementation decisions must not unnecessarily prevent horizontal scaling, independent deployments, or migration to more advanced infrastructure later.

## Decision

CareIQ will initially use managed application hosting and managed infrastructure services.

Render is the initial application-hosting implementation choice.

Render is not an architectural dependency.

CareIQ applications should remain portable enough to migrate to another suitable managed hosting or cloud platform without requiring fundamental changes to application business logic.

CareIQ will use independently deployable workloads for major runtime responsibilities.

The initial deployment model will conceptually include:

```text
CareIQ
│
├── Web Application
├── API Service
└── Background Worker
```

Durable state will remain outside individual application instances.

CareIQ API services will be stateless with respect to individual runtime instances.

Durable state will reside in shared infrastructure such as:

- PostgreSQL.
- Object storage.
- Other explicitly approved durable services.

The hosting platform will initially provide infrastructure capabilities such as load balancing and application-instance routing.

CareIQ will not operate dedicated load-balancer infrastructure unless future requirements justify doing so.

## Managed Hosting

CareIQ will initially use a managed application-hosting platform.

Render is the initial implementation choice.

Managed hosting allows CareIQ to rely on platform capabilities for infrastructure concerns such as:

- Application deployment.
- Process management.
- Networking.
- TLS termination.
- Load balancing.
- Service health.
- Scaling.
- Environment configuration.
- Deployment orchestration.

CareIQ should not duplicate platform functionality without a demonstrated requirement.

The application architecture must avoid unnecessary dependencies on provider-specific functionality when a portable alternative is practical.

## Infrastructure Portability

CareIQ should remain portable across suitable hosting providers.

Application business logic must not depend directly on Render-specific behavior unless explicitly justified.

Infrastructure-specific configuration should remain isolated from domain logic.

Conceptually:

```text
CareIQ Application
        │
        ▼
Infrastructure Boundary
        │
        ├── Render
        ├── AWS
        ├── GCP
        ├── Azure
        └── Other Suitable Platform
```

Migration to another hosting provider should primarily affect deployment and infrastructure configuration rather than CareIQ domain behavior.

Changing hosting providers does not inherently require a new architectural decision unless the migration materially changes the infrastructure architecture.

## Deployment Topology

CareIQ will maintain logical and deployment separation between major runtime workloads.

Conceptually:

```text
CareIQ Monorepo
│
├── apps/web
│      │
│      ▼
│   Web Deployment
│
├── apps/api
│      │
│      ▼
│   API Deployment
│
└── apps/worker
       │
       ▼
    Worker Deployment
```

The exact application directories may evolve as the repository develops.

The architectural requirement is that independently scalable runtime responsibilities remain independently deployable.

A monorepo does not imply a monolithic deployment.

## Independent Deployability

Major CareIQ workloads should be independently deployable.

For example:

- The web application may be deployed without unnecessarily redeploying workers.
- API instances may be scaled without scaling the web application.
- Background workers may be scaled independently from API instances.
- Future specialized workers may scale independently according to workload requirements.

Independent deployment boundaries allow infrastructure resources to follow actual workload requirements.

## Shared Multi-Tenant Deployment

CareIQ will operate as a shared multi-tenant SaaS platform as established in ADR-014.

Practices will not normally receive separate application deployments.

Conceptually:

```text
CareIQ Production
        │
        ├── Practice A
        ├── Practice B
        ├── Practice C
        └── ...
```

Tenant isolation will occur through CareIQ's application, authorization, database, and audit architecture rather than through one server deployment per Practice.

Dedicated customer infrastructure may be considered later only when explicitly justified by contractual, regulatory, security, operational, or business requirements.

## Stateless API Services

CareIQ API instances will be stateless with respect to individual runtime instances.

An API request must not depend on returning to the same server instance for durable application state.

Conceptually:

```text
                   Load Balancer
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          API #1     API #2     API #3
             │          │          │
             └──────────┼──────────┘
                        │
                        ▼
                Shared Durable State
```

Durable state belongs in systems designed for persistence.

Examples include:

- PostgreSQL.
- Object storage.
- Other approved shared infrastructure.

API instance memory may be used for temporary process-local state, caching, or optimization only when correctness does not depend on that state surviving process termination or routing changes.

## Horizontal Scaling

CareIQ will support horizontal scaling of stateless workloads.

When API demand increases, additional API instances may be introduced.

Conceptually:

```text
Initial:

Load Balancer
     │
     ▼
   API #1
```

may evolve into:

```text
Load Balancer
     │
 ┌───┼───┐
 ▼   ▼   ▼
API API API
#1  #2  #3
```

Application behavior must remain correct regardless of which healthy API instance receives a request.

Horizontal scaling should be preferred before introducing unnecessary architectural complexity.

## Load Balancing

CareIQ will initially use load balancing provided by the managed hosting platform.

CareIQ will not deploy or operate its own dedicated load-balancer infrastructure unless operational requirements justify it.

The application must remain compatible with multiple instances behind a load balancer.

This includes avoiding assumptions about:

- Sticky sessions.
- Process-local durable state.
- Single-instance execution.
- Instance-specific storage.

If specialized ingress or load-balancing requirements emerge later, they may be addressed separately.

## Background Workers

Background workers defined in ADR-012 will run as independently deployable processes.

Conceptually:

```text
PostgreSQL Job Storage
        │
        ├── Worker #1
        ├── Worker #2
        └── Worker #3
```

Workers may scale independently according to:

- Queue depth.
- Job latency.
- Job type.
- External service limitations.
- Resource requirements.

Worker scaling must preserve the concurrency-safe claiming and at-least-once execution model established in ADR-012.

## Managed PostgreSQL

CareIQ will use managed PostgreSQL for production database infrastructure.

CareIQ will not initially operate self-managed PostgreSQL servers.

Managed PostgreSQL should provide appropriate capabilities for:

- Persistent storage.
- Backups.
- Availability.
- Monitoring.
- Security.
- Connection management.
- Recovery.

PostgreSQL remains responsible for the relational and transactional data architecture established by previous ADRs.

The exact managed PostgreSQL provider may change without changing the architectural decision.

## Database Scaling

CareIQ will not preemptively design complex database clustering or sharding infrastructure.

Database performance will be measured as CareIQ grows.

Potential scaling techniques may eventually include:

- Query optimization.
- Index optimization.
- Connection pooling.
- Increased database resources.
- Read replicas.
- Partitioning.
- Archival.
- Workload separation.
- Other PostgreSQL scaling techniques.

Sharding or major distributed database architecture should not be introduced without demonstrated requirements.

## Object Storage

CareIQ will use managed object storage according to ADR-013.

Object storage will remain independently scalable from application servers and PostgreSQL.

Application instances must not rely on their local filesystem for durable CareIQ document storage.

Local application filesystems may be ephemeral.

Durable files must be stored in approved object storage.

## Application Filesystem

CareIQ applications must assume that instance-local filesystems are temporary unless explicitly documented otherwise.

Application correctness must not depend on files remaining on a specific application instance.

Temporary files used during processing must be treated as disposable and should be removed when no longer required.

Sensitive temporary files must be handled according to CareIQ security requirements.

## CI/CD

CareIQ will use automated continuous integration and deployment processes.

GitHub will serve as the source-code system of record.

A conceptual delivery flow is:

```text
Developer Change
      │
      ▼
Pull Request
      │
      ▼
Automated Validation
      │
      ├── Lint
      ├── Type Check
      ├── Tests
      └── Build
      │
      ▼
Merge
      │
      ▼
Staging Deployment
      │
      ▼
Production Deployment
```

The exact CI/CD platform may evolve.

The architectural requirement is that deployments become repeatable and automated rather than relying on undocumented manual server modification.

## Pull Request Validation

Changes should pass appropriate automated validation before production deployment.

Validation may include:

- Linting.
- Type checking.
- Unit tests.
- Integration tests.
- Build validation.
- Database migration validation.
- Security checks.
- Contract validation.
- Other automated quality gates.

The exact required checks may evolve as CareIQ's testing infrastructure matures.

## Staging Deployment

Changes intended for production should be capable of deployment to the staging environment before production.

Staging provides an environment for validating:

- Application behavior.
- Database migrations.
- Configuration.
- Integrations.
- Deployment behavior.
- Background workers.
- Infrastructure compatibility.

Staging must remain isolated from production according to ADR-014.

## Production Deployment

Production deployment will initially include an explicit controlled approval or promotion step.

CareIQ will not require manual production approval forever.

As automated testing, deployment confidence, observability, and operational maturity improve, production deployment may become more automated.

Any change to the approval process must preserve appropriate deployment controls.

## Deployment Credentials

CI/CD and deployment systems must use environment-specific credentials according to ADR-014.

A staging deployment must not automatically receive production credentials.

Deployment systems should receive only the permissions required to perform their responsibilities.

Application secrets must not be stored directly in source code or CI configuration files committed to Git.

## Database Migrations

Database schema migrations will execute as an explicit deployment operation.

API servers and workers must not independently execute production migrations during ordinary application startup.

Conceptually:

```text
Deployment
     │
     ▼
Migration Step
     │
     ▼
PostgreSQL
     │
     ▼
Application Deployment
```

Migrations should execute once through a controlled process using appropriately authorized credentials.

CareIQ will use Drizzle for the database access and migration strategy established by previous architectural decisions.

The exact migration command and CI/CD implementation will be defined during development.

## Migration Compatibility

Production schema changes should preserve compatibility across application deployments whenever practical.

CareIQ should use an expand-and-contract migration strategy for breaking schema evolution.

Conceptually:

```text
Step 1
Add New Structure
        │
        ▼
Step 2
Deploy Application Using New Structure
        │
        ▼
Step 3
Migrate / Verify Data
        │
        ▼
Step 4
Remove Old Structure Later
```

For example, CareIQ should avoid immediately dropping or renaming a database column that currently running application instances still require.

This supports safer rolling deployments and rollback behavior.

## Destructive Migrations

Destructive database migrations require additional care.

Examples include:

- Dropping columns.
- Dropping tables.
- Destructive type changes.
- Large data rewrites.
- Removing constraints relied upon by active code.

Destructive changes should occur only after dependent application versions no longer require the old structure and necessary data migration or verification has completed.

Production data must not be destroyed merely because an application deployment expects a new schema.

## Application Rollback

Application deployments should support rollback to a previously known-good application version when practical.

Rollback capability must not depend on reversing every database migration.

A previous application version may only be safely restored when it remains compatible with the current database schema.

The expand-and-contract strategy should preserve this compatibility during normal deployment transitions.

## Database Rollback

CareIQ will not assume every database migration can or should be automatically reversed.

Some migrations may involve irreversible data transformation or destructive operations.

When a database change causes a problem, CareIQ should prefer a safe forward corrective migration when that approach better preserves data integrity.

Conceptually:

```text
Problematic Migration
        │
        ▼
Assess Data State
        │
        ▼
Forward Corrective Migration
```

rather than automatically attempting:

```text
Reverse Everything
```

Database restoration may be used when appropriate for severe incidents, but restoration is an operational recovery action rather than the default schema rollback mechanism.

## Health Checks

CareIQ backend workloads must provide appropriate health signals.

The architecture distinguishes between liveness and readiness.

### Liveness

Liveness answers:

```text
Is this process running?
```

A liveness failure may indicate that the process should be restarted.

### Readiness

Readiness answers:

```text
Can this process safely perform its workload?
```

A service that is alive but not ready should not receive normal production traffic.

Readiness may consider required dependencies such as:

- Configuration.
- Database connectivity.
- Required service initialization.
- Other critical runtime dependencies.

Health endpoints must not expose sensitive system information.

## Worker Health

Background workers do not necessarily receive normal user HTTP traffic, but their operational health must still be observable.

Worker health should allow CareIQ operations to determine whether workers are:

- Running.
- Claiming jobs.
- Completing jobs.
- Experiencing elevated failures.
- Falling behind expected processing latency.

The exact monitoring implementation will be defined through the observability architecture.

## Backups

Production PostgreSQL must use automated backups.

Backup configuration should be appropriate to CareIQ's current operational and customer requirements.

CareIQ should not rely solely on the assumption that backups exist.

Backup systems must eventually be validated through restoration testing.

## Recovery Testing

CareIQ should periodically test restoration from backups.

Conceptually:

```text
Production Backup
       │
       ▼
Controlled Restore
       │
       ▼
Verify Database
       │
       ▼
Verify Application Compatibility
       │
       ▼
Document Result
```

A backup that has never been tested for restoration provides less confidence than a backup with a verified recovery process.

Restoration tests must not expose production-sensitive data to unauthorized environments or personnel.

## Recovery Objectives

CareIQ will eventually define explicit:

```text
RPO
Recovery Point Objective
```

and:

```text
RTO
Recovery Time Objective
```

based on:

- Customer requirements.
- Product maturity.
- Service-level commitments.
- Regulatory requirements.
- Contractual obligations.
- Operational capabilities.

ADR-015 does not establish arbitrary RPO or RTO values before those requirements are known.

## Object Storage Recovery

Object-storage durability and recovery capabilities must be considered separately from database backups.

CareIQ should use managed object storage with appropriate durability guarantees.

Document metadata and object contents must remain reconcilable according to ADR-013.

Additional replication, archival, or recovery mechanisms may be introduced when justified by retention, customer, regulatory, or operational requirements.

## Deployment Observability

CareIQ deployments should be observable.

Operations should be able to determine:

- Which application version is deployed.
- Which environment is running.
- Whether deployment succeeded.
- Whether health checks passed.
- Whether migrations succeeded.
- Whether error rates changed materially.
- Whether workers are operating normally.

Deployment events may be correlated with operational telemetry when useful for investigation.

## Infrastructure Scaling

CareIQ infrastructure will scale according to measured requirements.

The preferred process is:

```text
Observe
   │
   ▼
Measure
   │
   ▼
Identify Bottleneck
   │
   ▼
Scale Appropriate Component
```

CareIQ will avoid infrastructure changes based solely on hypothetical future scale.

Different components may scale independently.

Examples include:

```text
High API Load
    → Scale API instances

Large Job Backlog
    → Scale workers

Database Bottleneck
    → Optimize or scale PostgreSQL

Large File Volume
    → Object storage scales independently
```

## No Premature Kubernetes

CareIQ will not initially use Kubernetes.

Kubernetes introduces substantial operational complexity that is not justified by CareIQ's initial deployment requirements.

CareIQ may adopt Kubernetes or another container-orchestration platform later if demonstrated requirements justify it.

Potential reasons may include:

- Large service count.
- Complex deployment topology.
- Specialized scheduling requirements.
- Advanced networking requirements.
- Infrastructure standardization.
- Significant scale.
- Operational requirements not adequately supported by simpler managed hosting.

Adopting Kubernetes in the future would require a separate architectural decision.

## No Premature Microservices

CareIQ will not split the platform into microservices solely in anticipation of future scale.

The initial architecture may contain independently deployable workloads such as:

- Web.
- API.
- Workers.

This does not require domain logic to be fragmented across numerous network services.

CareIQ should prefer clear internal domain boundaries before introducing distributed service boundaries.

A domain may become an independent service later when justified by:

- Independent scaling.
- Security isolation.
- Reliability requirements.
- Team ownership.
- Deployment independence.
- Performance characteristics.
- Operational evidence.

Microservice extraction should solve a demonstrated problem.

## Infrastructure Security

Infrastructure access must follow least-privilege principles.

Production infrastructure access should be limited to authorized personnel and workloads.

Infrastructure credentials must follow ADR-014.

Network exposure should be minimized.

Databases and internal infrastructure should not be publicly exposed unless explicitly required and appropriately protected.

TLS must be used for externally accessible CareIQ services.

Additional network security controls may be introduced as infrastructure requirements evolve.

## Environment Isolation

Deployment infrastructure must preserve the environment boundaries established in ADR-014.

Conceptually:

```text
Development
    │
    ├── Development Applications
    ├── Development Database
    └── Development Storage


Staging
    │
    ├── Staging Applications
    ├── Staging Database
    └── Staging Storage


Production
    │
    ├── Production Applications
    ├── Production Database
    └── Production Storage
```

Infrastructure from one environment must not accidentally share protected credentials or durable data with another environment.

## Future Infrastructure Evolution

CareIQ's initial infrastructure is intentionally simple.

Conceptually:

```text
Managed Hosting
      │
      ├── Web
      ├── API
      └── Worker
            │
            ├── Managed PostgreSQL
            └── Managed Object Storage
```

This architecture is expected to evolve as CareIQ grows.

Future changes may include:

- Additional API instances.
- Additional workers.
- Specialized worker pools.
- Read replicas.
- Dedicated queue infrastructure.
- CDN or edge infrastructure.
- Additional regions.
- Dedicated customer infrastructure.
- Advanced secrets management.
- Specialized integration infrastructure.
- Container orchestration.
- Service extraction.

These changes should be introduced when supported by demonstrated product, operational, security, contractual, or scaling requirements.

## Consequences

CareIQ begins with a relatively simple managed infrastructure architecture while preserving a path toward significant future scale.

Render is the initial application-hosting implementation choice but is not a permanent architectural dependency.

Web, API, and background-worker workloads remain independently deployable.

Stateless API instances allow horizontal scaling behind platform-managed load balancing.

Durable application state remains in shared infrastructure such as PostgreSQL and object storage rather than individual application instances.

Managed PostgreSQL reduces the operational burden of running database infrastructure.

Managed object storage provides scalable durable file storage consistent with ADR-013.

CareIQ does not operate dedicated load-balancer infrastructure before it is required.

Automated CI/CD provides repeatable application validation and deployment.

Production deployment initially retains an explicit controlled promotion or approval step.

Database migrations execute through a controlled deployment operation rather than independently from application instances.

Expand-and-contract schema evolution supports safer deployments and application rollback.

CareIQ prefers forward corrective database migrations over assuming every schema change can be safely reversed.

Health and readiness signals allow the hosting platform and operations processes to determine whether workloads can safely serve traffic.

Automated PostgreSQL backups provide recovery capability, while restoration testing verifies that backups are actually usable.

Explicit RPO and RTO requirements will be established when customer, contractual, regulatory, and operational requirements are sufficiently defined.

Infrastructure components scale according to measured bottlenecks rather than speculative future demand.

CareIQ avoids premature Kubernetes, microservice fragmentation, self-managed PostgreSQL, and dedicated load-balancer infrastructure.

The architecture introduces ongoing operational responsibility involving:

- CI/CD.
- Deployment controls.
- Database migrations.
- Backup verification.
- Health monitoring.
- Infrastructure security.
- Environment isolation.
- Scaling decisions.
- Provider portability.

This complexity is accepted because CareIQ requires a deployment foundation that is simple enough for early product development while remaining capable of evolving into a reliable and scalable production platform.
````
