# Applications

This directory contains the independently deployable applications that make up the CareIQ platform.

Applications may include web, mobile, backend, or other deployable services.

Applications can consume shared packages from the `/packages` directory.

## Dependency Direction

Applications may depend on shared packages:

```text
apps/* → packages/*