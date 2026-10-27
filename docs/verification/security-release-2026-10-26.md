# Security runtime and authorization update — October 26, 2026

Reviewed baseline: main `1c99f186e5d5129bb6c2562036af42eec12dd153`.

## Changes

- Pin Node.js 22.23.4 and require a patched 22.x runtime for package installation and local review. This includes the October 21 Node security fixes, including CVE-2026-111497.
- Update body-parser to 2.4.0 for CVE-2026-111181 and Zod to 4.6.6 for CVE-2023-54404 through scoped dependency overrides.
- Reject compressed JSON and raw request bodies before API decoding. Plain JSON and unchanged provider webhook bytes remain supported.
- Authorize normalized audit-export evidence flags and recheck current evidence permission when downloading retained exports.

## Validation

- 425 unit/database tests, zero skips.
- 16 dependency security regressions and 2 new Python runtime tests.
- Workspace lint, type checks and production builds.
- 77 browser regressions and 3 real API/restricted-database browser scenarios.
- Fresh and repeated migration replay with 43 unchanged entries in disposable local PostgreSQL.
- Full dependency audit: two HIGH findings before the update, zero vulnerabilities after the update.
- Canonical checkout recheck: 12 targeted API/database tests, 16 dependency regressions and 11 local-runner tests passed.

The patch requires no database migration. Hosted Node version overrides must also be set to 22.23.4 and services rebuilt. Deployment verification is recorded separately after rollout.

References: [Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
