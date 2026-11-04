# Next.js security update — October 16, 2026

Web and marketing pin `next` and `eslint-config-next` to the published 16.4.1 release. React/React DOM remain 19.2.8 and Clerk remains on its existing version; their published peer ranges accept this combination. Existing apps do not automatically enable Cache Components by updating to 16.4.

The September 30 release, 16.3.8, resolves the six Next advisories visible in the initial registry audit of this checkout, but it is insufficient for the later October 14 security bulletin. The minimum fixed 16.x release in that bulletin is 16.4.1. This choice avoids knowingly retaining the newly disclosed upstream issues.

Primary evidence:

- [Next.js October 14 security bulletin](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
- [Verified 16.4.1 release](https://github.com/vercel/next.js/releases/tag/v16.4.1).
- [Cache typed-array RCE: affected through 16.4.0, fixed in 16.4.1](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr).
- [Server Actions denial of service: affected through 16.4.0, fixed in 16.4.1](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).
- [16.4 compatibility context](https://nextjs.org/blog/next-16-4).
- Exact npm registry metadata was checked for `next@16.4.1` and `eslint-config-next@16.4.1`; the installed Next tarball integrity must match `sha512-uc657V62E34fOI6W5NtG9IzwsPcms0Z60grz2MJGtglgD+pTFnNt4Yw2PzaU622tfX4vhrDgLZzicE2YlhI20Q==` in the lockfile.

All existing version-preserving backports and scoped overrides are retained. Exact registry lookups still report that node-forge 1.4.1 and braces 3.0.4 are unavailable; these versions were not invented or substituted. The raw audit remains an independent gate: passing the local exploit regression suite does not remove a registry advisory. See [backport provenance](../../patches/README.md).

Verification after installation on Node 22.23.2 / pnpm 11.22.0:

| Check | Result |
| --- | --- |
| Web typecheck and lint | Pass |
| Web unit tests | 55 passed |
| Marketing typecheck and lint | Pass |
| Marketing unit tests | 8 passed |
| Isolated Chromium/Chrome browser scenarios | 29 passed, including audit context changes and stale responses |
| Backport integrity/exploit/compatibility checks | 16 passed |
| Raw production audit | Exit 1: two high advisories remain; zero critical, moderate, low, or informational findings |

The remaining registry findings are [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Their reviewed backports pass the local regression suite, but the published versions remain flagged, so the independent raw-audit release gate stays unresolved. No advisory ignore was added.

`minimumReleaseAgeStrict: true` and all existing exact exceptions remain unchanged; this update needed no new exception. The lockfile change from the pre-update workspace is confined to Next, its matching `@next` packages, ESLint configuration, and the Clerk peer-resolution metadata. Backport files and integrity manifest are unchanged. Production builds and final HTTP checks are recorded in the [workflow verification guide](../workflow-implementation.md).

No deployment or external repository changes are part of this update.
