# ADR-012: Background Jobs and Asynchronous Processing

**Status:** Accepted

## Context

CareIQ requires a reliable mechanism for performing work that should not execute entirely within an immediate HTTP request.

Examples of asynchronous or background work may include:

- Appointment reminders.
- Email delivery.
- SMS delivery.
- Integration synchronization.
- Webhook processing.
- Document processing.
- Report generation.
- Imports and exports.
- Scheduled maintenance operations.
- Retryable external service operations.
- Future AI processing workflows.
- Other long-running or safely deferred operations.

Some operations are required to complete as part of the immediate user transaction, while other work can or should occur asynchronously.

For example, creating an appointment should normally complete synchronously so that the user immediately knows whether the appointment was successfully created.

Follow-up actions such as sending a confirmation, scheduling reminders, or synchronizing the appointment with an external system do not necessarily need to block the API response.

CareIQ must therefore provide a clear architectural boundary between synchronous domain operations and asynchronous processing.

Background processing must also remain consistent with previously established CareIQ architectural decisions involving:

- Multi-tenancy.
- PostgreSQL Row-Level Security.
- Authentication and authorization.
- Audit logging.
- API idempotency.
- Integration architecture.
- Sensitive data handling.

Background workers must not become an alternate execution path that bypasses CareIQ tenant isolation, security, or auditing requirements.

## Decision

CareIQ will support durable background jobs and asynchronous processing.

Operations required to complete the immediate user transaction will generally execute synchronously.

Work that is long-running, scheduled, retryable, externally dependent, or not required to complete the immediate response should generally execute asynchronously.

CareIQ will initially use a PostgreSQL-backed durable job architecture.

The specific job-processing library or framework will remain an implementation decision and is not defined by this ADR.

Dedicated queue infrastructure may be introduced later if demonstrated scale, throughput, latency, reliability, or operational requirements justify the additional complexity.

## Synchronous and Asynchronous Work

CareIQ will distinguish between work required for the immediate domain transaction and work that can safely occur afterward.

Conceptually:

```text
API Request
    │
    ├── Required Immediate Work
    │       │
    │       ▼
    │   Synchronous
    │
    └── Deferred / Long-Running Work
            │
            ▼
       Background Job
            │
            ▼
          Worker
```

For example:

```text
POST /api/v1/appointments
          │
          ▼
Validate Request
          │
          ▼
Authenticate / Authorize
          │
          ▼
Create Appointment
          │
          ├──────────────► Return Success
          │
          ▼
Asynchronous Follow-Up
          │
          ├── Confirmation
          ├── Reminder Scheduling
          ├── Integration Synchronization
          └── Other Downstream Work
```

Asynchronous processing must not be used to defer work that is required to determine whether the immediate domain operation itself succeeded.

## PostgreSQL-Backed Durable Jobs

CareIQ will initially use PostgreSQL as the durable storage mechanism for background job state.

Conceptually:

```text
CareIQ PostgreSQL
        │
        ├── Application Data
        ├── Audit Data
        └── Background Job Data
                  │
                  ▼
               Workers
```

This avoids introducing additional queue infrastructure before CareIQ has demonstrated a requirement for it.

Potential future technologies such as dedicated message brokers, queue systems, or streaming infrastructure are not prohibited.

Migration to dedicated queue infrastructure should occur only when justified by measurable requirements.

## Technology Neutrality

ADR-012 defines the architecture and behavioral requirements for background processing but does not select a specific Node.js or TypeScript job-processing library.

The implementation may use any appropriate library or internal mechanism that satisfies the requirements established by this ADR.

The implementation must preserve:

- Durable job storage.
- Safe job claiming.
- Retry support.
- Scheduling.
- Failure visibility.
- Tenant context.
- Audit integration.
- Idempotent or safely retryable execution.
- Concurrency controls.
- Appropriate transaction boundaries.

Changing the underlying job library does not require a new architectural decision unless the change materially alters these architectural guarantees.

## Job Identity and State

Each background job must have a durable identity.

Job records should support information such as:

- Job identifier.
- Job type.
- Practice identifier when applicable.
- Initiating actor or system identity when applicable.
- Correlation identifier.
- Job payload.
- Current state.
- Attempt count.
- Creation time.
- Scheduled execution time.
- Processing timestamps.
- Completion time when applicable.
- Failure information when applicable.

The exact database schema will be defined during implementation.

Conceptual job states may include:

```text
pending
processing
completed
failed
```

Additional states may be introduced when required by implementation or operational needs.

## Tenant Context

Background jobs involving tenant-owned data must execute with explicit tenant context.

A worker must not bypass tenant isolation merely because execution occurs outside an HTTP request.

Conceptually:

```text
Worker
   │
   ▼
Load Job
   │
   ▼
Resolve Practice
   │
   ▼
Establish Tenant Context
   │
   ▼
Establish Actor / System Context
   │
   ▼
Execute Operation
   │
   ├── RLS
   ├── Authorization When Applicable
   └── Audit
```

Tenant context must be transaction-scoped when interacting with PostgreSQL and must not leak between jobs or pooled database connections.

Background jobs must remain subject to PostgreSQL Row-Level Security and the tenant-isolation architecture established by previous CareIQ decisions.

## Actor Context

Background activity must have an identifiable execution identity.

Depending on the operation, the actor may represent:

- The user who initiated the original operation.
- A CareIQ system identity.
- A background worker identity.
- A service account.
- An integration.
- Another explicitly defined machine identity.

The audit system must be capable of distinguishing between the actor that initiated an operation and the system or worker that later executed asynchronous work when that distinction is relevant.

## Correlation

Background jobs should preserve correlation context when the job originates from another CareIQ operation.

For example:

```text
API Request
    │
    ▼
Domain Operation
    │
    ▼
Background Job
    │
    ▼
Integration Call
```

Related activity should be connectable through a correlation identifier when appropriate.

This allows asynchronous processing to participate in the reconstructable history defined by ADR-010.

Correlation identifiers may connect:

- API requests.
- Application audit events.
- Database mutations.
- Background jobs.
- Integration activity.
- Application logs.

## Job Payloads and Sensitive Data

Background job payloads should minimize duplication of sensitive data.

Jobs should generally contain identifiers or references to domain entities rather than unnecessary copies of sensitive information.

For example:

```text
Preferred:

patient_id
appointment_id
practice_id
```

rather than copying an entire patient or appointment record into the job payload.

Workers should retrieve the authorized data required to execute the operation when practical.

Sensitive data may be included in a job payload only when required by the operation and must remain subject to CareIQ security, privacy, and data-handling requirements.

Background job storage must not become an uncontrolled duplicate store of sensitive CareIQ data.

## Idempotency and Safe Retries

CareIQ background jobs must be designed for safe retry behavior.

The background processing architecture will assume at-least-once execution rather than exactly-once execution.

A job may therefore be attempted more than once.

Workers must not assume that a job will execute exactly once.

Where duplicate execution could produce incorrect or harmful side effects, job handlers must use idempotency or another appropriate duplicate-protection mechanism.

Conceptually:

```text
Job
 │
 ▼
Attempt 1
 │
 X
 ▼
Retry
 │
 ▼
Same Intended Operation
 │
 ▼
No Incorrect Duplicate Side Effect
```

Idempotency mechanisms may vary by job type.

The exact implementation will be determined according to the operation being performed.

## Transactional Outbox

When asynchronous work is a required consequence of an important database transaction, CareIQ should use a transactional outbox pattern.

The domain mutation and the durable outbox record should be created within the same PostgreSQL transaction.

Conceptually:

```text
BEGIN

Create / Update Domain Data

Create Outbox Record

COMMIT
```

The result must be:

```text
Domain Change + Outbox Record
```

or:

```text
Neither
```

This prevents failure scenarios where a domain transaction commits successfully but required asynchronous work is never durably recorded.

For example:

```text
BEGIN

Create Appointment

Create Outbox Event:
appointment.created

COMMIT
        │
        ▼
Background Processing
        │
        ├── Confirmation
        ├── Reminder Scheduling
        └── Integration Synchronization
```

Not every background job is required to originate from the transactional outbox.

Direct job creation may be appropriate for:

- Scheduled operations.
- Explicitly requested background work.
- Recurring jobs.
- Operations not coupled to a domain mutation.

The transactional outbox should be used when consistency between a database mutation and the required asynchronous handoff matters.

## Delivery and Execution Guarantee

CareIQ will design background processing around an at-least-once execution model.

Exactly-once execution will not be assumed.

This means:

- Jobs may be retried.
- Workers may encounter the same logical operation more than once.
- Processing may resume after worker or infrastructure failure.
- Job handlers must tolerate retries appropriately.

Correctness must come from safe execution design, transaction boundaries, and idempotency rather than assuming the queue infrastructure can guarantee exactly-once execution.

## Job Claiming

Workers must claim jobs using a concurrency-safe mechanism.

Multiple workers must not simultaneously process the same job under normal operation.

Job claiming must use appropriate PostgreSQL concurrency mechanisms or equivalent safe implementation techniques.

Conceptually:

```text
Worker A ──┐
           │
           ▼
          Job
           ▲
           │
Worker B ──┘

Only one worker successfully claims the job.
```

The exact locking or claiming implementation will be selected during development.

The implementation must support multiple workers without requiring application-level assumptions that only one worker exists.

## Concurrency

CareIQ background processing must support controlled concurrency.

Different job types may require different concurrency limits.

Examples include:

- External APIs with rate limits.
- Resource-intensive document processing.
- Integration synchronization.
- High-volume notifications.
- Operations that must not execute concurrently for the same domain entity.

The architecture must allow concurrency to be constrained globally, by job type, integration, tenant, resource, or another appropriate boundary when required.

CareIQ should not assume unlimited worker concurrency.

Concurrency policies may be configured according to operational requirements.

## Scheduled Jobs

CareIQ will support jobs scheduled for future execution.

Examples may include:

- Appointment reminders.
- Delayed follow-up actions.
- Integration retries.
- Scheduled reports.
- Deferred processing.

A scheduled job must remain durably stored until it becomes eligible for execution.

Scheduled execution should not depend on a specific application process remaining continuously alive.

Conceptually:

```text
Job Created
    │
    ▼
scheduled_at
    │
    ▼
Durably Stored
    │
    ▼
Eligible Time Reached
    │
    ▼
Worker Claims Job
```

## Recurring Jobs

CareIQ will support recurring background operations when required.

Examples may include:

- Periodic synchronization.
- Scheduled maintenance.
- Recurring reports.
- Data lifecycle operations.
- Operational housekeeping.

Recurring job definitions should produce durable execution records rather than relying exclusively on transient in-memory scheduling.

The exact recurrence mechanism will be selected during implementation.

Recurring jobs must remain observable and auditable where appropriate.

## Retries

Failed jobs may be retried according to policies appropriate to the job type.

Retry policies may consider:

- Maximum attempts.
- Delay between attempts.
- Exponential or other backoff strategies.
- External service availability.
- Error classification.
- Rate limits.
- Operation-specific requirements.

CareIQ will not require one global retry policy for every job type.

Transient failures should generally be distinguishable from permanent failures where practical.

## Failed Jobs

Jobs that exhaust their retry policy must not silently disappear.

Permanently failed jobs must remain observable.

Failure records should contain sufficient information for authorized operators to determine:

- Which job failed.
- Which job type was involved.
- Which Practice was involved when applicable.
- How many attempts occurred.
- When attempts occurred.
- Relevant failure information.
- Correlation context when available.

Failed jobs may be eligible for controlled reprocessing after the underlying issue has been resolved.

Reprocessing must respect idempotency, tenant isolation, authorization, and auditing requirements.

The exact failed-job or dead-letter implementation will be selected during development.

## Execution Timeouts

Background jobs must support bounded execution.

Workers should not allow jobs to remain indefinitely in a processing state without detection.

Job types may define appropriate execution timeouts according to their expected workload.

Timeout handling must allow CareIQ to distinguish between:

- A legitimately long-running operation.
- A failed operation.
- A crashed worker.
- An abandoned job.

Jobs that exceed their allowed execution window should become eligible for appropriate recovery, retry, or failure handling.

The exact timeout values will be determined by job type and operational requirements.

## Worker Failure Recovery

The background processing system must tolerate worker crashes and unexpected termination.

A job claimed by a worker that subsequently crashes must not remain permanently inaccessible.

The implementation must provide a mechanism for detecting abandoned or stale processing claims and making those jobs eligible for recovery according to the applicable retry policy.

Recovery must preserve the at-least-once execution model.

Job handlers must therefore continue to assume that execution may be repeated.

## Graceful Worker Shutdown

Workers should support graceful shutdown.

When a worker receives a shutdown signal, it should stop claiming new jobs and allow currently executing work to complete within an appropriate shutdown window when practical.

Conceptually:

```text
Shutdown Signal
      │
      ▼
Stop Claiming New Jobs
      │
      ▼
Finish Current Work
      │
      ▼
Worker Exits
```

If work cannot complete before the worker terminates, the job must remain recoverable through the normal worker-failure mechanism.

Graceful shutdown reduces unnecessary retries during deployments, scaling events, and infrastructure maintenance.

## Integration Processing

Integration operations are a significant use case for asynchronous processing.

External systems may:

- Respond slowly.
- Become temporarily unavailable.
- Enforce rate limits.
- Return transient errors.
- Require retries.
- Produce webhook events.

CareIQ integration processing should use background jobs when synchronous execution is not required.

Integration jobs must retain:

- Tenant context.
- Integration identity.
- Correlation context.
- Appropriate permissions.
- Audit context.

Integration retries must not bypass the authorization or tenant boundaries associated with the integration identity.

## Webhook Processing

Incoming webhooks should generally acknowledge receipt quickly after appropriate validation and durable recording.

Long-running webhook processing should occur asynchronously when practical.

Conceptually:

```text
External System
       │
       ▼
CareIQ Webhook Endpoint
       │
       ├── Validate
       ├── Authenticate / Verify
       ├── Durably Record Work
       │
       ▼
Return Response
       │
       ▼
Background Processing
```

Webhook processing must be designed to tolerate duplicate delivery.

Webhook handlers should use provider event identifiers or another appropriate idempotency mechanism when available.

## Audit Integration

Background processing must integrate with the CareIQ Audit domain defined in ADR-010.

Meaningful background actions should generate appropriate application audit events.

Database mutations performed by background workers remain subject to PostgreSQL audit triggers where applicable.

Audit context should identify whether activity was performed by:

- A user-initiated background operation.
- A system worker.
- A service account.
- An integration.
- Another machine identity.

Protected audit information should make it possible to connect asynchronous activity to the operation that initiated it when correlation information is available.

## Observability

Background processing must provide sufficient operational visibility to determine:

- Pending job volume.
- Processing job volume.
- Completed jobs where relevant.
- Failed jobs.
- Retry activity.
- Job latency.
- Job execution duration.
- Worker health.
- Stale or abandoned jobs.

The exact observability platform will be defined separately from this ADR.

Background job operational logs are not a replacement for audit records.

## Scaling

CareIQ may initially operate with a small number of background workers.

The architecture must allow additional workers to be introduced without redesigning job semantics.

Conceptually:

```text
PostgreSQL Job Queue
        │
        ├── Worker 1
        ├── Worker 2
        ├── Worker 3
        └── ...
```

Concurrency-safe claiming must prevent multiple workers from unintentionally processing the same job simultaneously.

CareIQ may eventually migrate specific workloads to dedicated queue or messaging infrastructure.

Such migration should be driven by demonstrated requirements rather than speculative scale.

Potential reasons may include:

- Queue throughput.
- Extremely high job volume.
- Latency requirements.
- Independent scaling.
- Specialized delivery semantics.
- Infrastructure isolation.
- Streaming requirements.
- Operational constraints.

## Consequences

CareIQ will have a durable asynchronous processing architecture capable of supporting scheduled, retryable, externally dependent, and long-running operations.

PostgreSQL-backed durable jobs provide an appropriate initial architecture without introducing unnecessary queue infrastructure.

Keeping the specific job-processing library undefined preserves implementation flexibility while maintaining clear architectural guarantees.

Background jobs remain subject to CareIQ tenant isolation, PostgreSQL Row-Level Security, authorization where applicable, and audit requirements.

Tenant, actor, and correlation context allow background activity to participate in CareIQ's broader security and forensic model.

Job payloads minimize unnecessary duplication of sensitive information.

The at-least-once execution model requires job handlers to tolerate retries and use idempotency or other duplicate-protection mechanisms when necessary.

The transactional outbox pattern provides reliable coordination between important domain mutations and required asynchronous follow-up work.

Concurrency-safe job claiming allows CareIQ to scale worker processes without redesigning job semantics.

Scheduled and recurring jobs are durably represented rather than relying solely on transient in-memory scheduling.

Execution timeouts and abandoned-job recovery prevent jobs from remaining permanently stuck after worker failures.

Graceful worker shutdown reduces unnecessary retries during deployments and infrastructure changes.

Failed jobs remain observable and recoverable rather than disappearing after retries are exhausted.

The architecture introduces additional complexity involving:

- Job lifecycle management.
- Retry policies.
- Idempotency.
- Transactional outbox processing.
- Worker concurrency.
- Scheduling.
- Failure recovery.
- Tenant context propagation.
- Audit integration.
- Operational monitoring.

This complexity is accepted because reliable asynchronous processing will be required across CareIQ scheduling, integrations, communications, document processing, and future platform capabilities.

Dedicated queue infrastructure may be introduced later if real operational requirements demonstrate that PostgreSQL-backed processing is no longer appropriate.