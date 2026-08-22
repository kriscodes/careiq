# ADR-001: Project Architecture

**Status:** Accepted

## Context

CareIQ is expected to evolve into a platform consisting of multiple user-facing applications and shared services.

## Decision

The project will begin with a repository structure organized around:

- `apps/` for independently deployable applications and services.
- `packages/` for reusable shared code.
- `docs/` for product and engineering documentation.

## Consequences

This structure provides a clear separation between deployable applications, shared code, and documentation while allowing the project to evolve without an immediate repository restructuring.