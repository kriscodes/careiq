
### `packages/README.md`

```md
# Packages

This directory contains reusable libraries and shared code used across CareIQ applications.

Packages may include:

- Shared UI components
- Shared TypeScript types and contracts
- Configuration
- Utility libraries
- Domain logic
- API clients

Packages are designed to be consumed by one or more applications.

## Dependency Direction

Packages must not depend on individual applications.

```text
apps/* → packages/*