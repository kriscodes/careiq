# Applications

This directory contains the independently deployable applications that make up the CareIQ platform.

Applications may include web, mobile, backend, or other deployable services.

Applications can consume shared packages from the `/packages` directory.

## Dependency Direction

Applications may depend on shared packages:

```text
apps/* → packages/*
```

`api` owns business logic, authorization and persistence. `web` is the Next.js staff application; `marketing` is the public site. `mobile` is the Expo iOS/Android foundation with its own native presentation and authentication adapter. Start it separately with `pnpm mobile`; see the [mobile proposal](../docs/design/mobile-architecture.md).
