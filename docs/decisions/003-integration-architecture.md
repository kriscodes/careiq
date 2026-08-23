# ADR-003: Integration Architecture

**Status:** Accepted

## Context

CareIQ is intended to support healthcare practices that may already use existing software for electronic health records, practice management, scheduling, communication, billing, and other operational workflows.

Requiring practices to replace their existing systems could create significant barriers to adoption.

At the same time, tightly coupling CareIQ's core business logic to a specific third-party platform would limit flexibility and make future integrations more difficult.

CareIQ should therefore be able to integrate with external systems without allowing vendor-specific implementations to become dependencies of the core application.

## Decision

CareIQ will use an integration-ready architecture.

Core CareIQ business logic and domain models will remain independent of specific third-party vendors.

External integrations will be implemented through clearly defined integration boundaries or adapters.

Integration-specific concerns, including vendor APIs, authentication mechanisms, data transformations, synchronization logic, and external error handling, will remain isolated from the core CareIQ domain.

CareIQ will maintain ownership of its internal domain models and business workflows.

Third-party integrations will be prioritized based on customer demand, market validation, and product requirements.

Healthcare interoperability standards and technologies, including FHIR and SMART on FHIR, will be evaluated when specific integration requirements are identified.

CareIQ will not build unnecessary integration infrastructure before a validated customer or product requirement exists.

## Consequences

CareIQ can support future integrations without requiring significant changes to core business logic.

The platform can add support for multiple external systems while minimizing vendor-specific coupling.

Individual integrations may require additional engineering effort because data must be mapped between CareIQ's internal models and external systems.

The architecture introduces an additional abstraction layer, but this complexity is intentionally accepted to preserve flexibility as the platform grows.