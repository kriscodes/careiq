
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
```

The current `@careiq/interview-contract` package is shared by the marketing site and API; it is not a clinical contract. The mobile bootstrap introduces no speculative shared package. Extract a platform-neutral clinical contract/API client when a second client consumes an implemented endpoint, with contract tests against the API. Keep Clerk adapters, storage, navigation, React providers, Next.js server code, DOM components, and native components in their applications. Shared React libraries should use peer dependencies and must not force the web and Expo apps onto one React version. See the [mobile sharing boundaries](../docs/design/mobile-architecture.md).
