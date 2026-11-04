# Security remediation and migration-50 fallback — November 2, 2026

This follows the approved local migration-50 ownership repair and the explicit request to prepare a compatible rollback build and resolve the 65 CodeQL findings. Work remains local and uncommitted. No hosted database, deployment, Git branch or required-check setting was changed in this follow-up.

## Security boundaries repaired

The original 65 results remain recorded in [release-security-analysis.json](release-security-analysis.json). They were scanner findings, not 65 independently demonstrated exploits. No finding was hidden with a suppression, excluded file, relaxed severity threshold or baseline allowance.

| Original rule | Results | Change and legitimate behavior retained |
| --- | ---: | --- |
| Missing rate limiting | 52 | Common ingress budgets run before parsers, authentication, callback processing and tenant lookup. Verified-user and write budgets follow authentication. Existing smaller interview/patient limits remain, health stays available, and a 429 response includes Retry-After and an actionable message. |
| Sensitive GET query | 8 | Workflow and delivery private filters move to JSON POST `/query` routes. This includes patient-name/contact search `q`, IDs and appointment exclusion. API and web retain permissions, route-selected entity precedence, pagination binding, cancellation, selected dates, response shapes and read retry guidance. Legacy private URL filters fail explicitly with a refresh message. |
| Parameter type confusion | 3 | Shared cursor decoders validate runtime string types before use and reject malformed falsy values. Twilio verification requires a Buffer and measures its byte length. Existing HTTP caller validation already constrained these paths; no authentication bypass or code execution was demonstrated. |
| Cleartext preview storage | 1 | User-entered preview drafts stay in memory. The adapter removes the legacy localStorage key without reading it and tolerates unavailable browser storage. In-page edits still work; reload resets synthetic data. |
| Remote property injection | 1 | Twilio signature material uses a Map, rejects duplicate decoded fields and signs every received field, including unknown provider additions. Only the known consumed fields are returned. The previous null-prototype object already prevented the ordinary prototype-setter attack; the new representation makes the boundary explicit. |

The shared implementation is in `apps/api/src/middleware/api-rate-limit.ts`, `apps/api/src/routes/private-read.ts`, the workflow/delivery routes, cursor/provider helpers, and the web API/preview adapters. [The API contract](../api/workflow.openapi.json) documents the private POST read variants. Deploy API and web as a compatible pair and refresh existing browser sessions.

The rate limiter uses pinned `express-rate-limit` 8.7.2, which satisfies the repository's dependency-age policy. Per minute, the default process budget is 6,000, address budget 1,200, verified-user budget 600 and write budget 120. POST queries consume the write budget too. Identity comes from trusted Express proxy resolution and verified authentication; untrusted forwarding/session/tenant headers cannot choose the user budget. IPv6 addresses use subnet grouping. The global budget bounds admissions to subsequent in-memory stores. These are process-local workload controls, reset on restart; they are not a persistent or fleet-wide quota. Use a shared store before relying on a fleet-wide ceiling, and validate thresholds against real clinic/provider traffic before scaling. See the [upstream store documentation](https://express-rate-limit.mintlify.app/reference/stores).

Remaining identifiers in resource paths and existing signed cursors are unchanged. This work does not establish that every identifier has been removed from every URL or that provider/access-log retention has been reviewed.

## Verification

A fresh independent reviewer traced aliases, direct callers, alternate input representations, proxy/user identities, signature handling and normal workflow behavior. It reported no concrete surviving bypass or regression. The parent additionally corrected the private `/today/query` date handling before final acceptance. Subsequent equivalent limiter mounting and Buffer byte-length changes passed 56 focused API tests and the final full suite; they make the existing controls visible to CodeQL without suppressing the rules.

- Final application/shared coverage run: **626/626 passed**, zero failures, skips or TODOs (474 API, 133 web, 9 marketing, 7 i18n, 3 interview-contract).
- Changed executable-line coverage: **2,425 / 2,557 = 94.84%**, exceeding the unchanged 80% minimum. Every workspace and scoped coverage floor passes, with provenance validated against the final source and tests. API lines/branches/functions are **74.84% / 80.65% / 92.95%**; web all-source **15.77% / 76.72% / 73.28%**. The low overall web line baseline remains an improvement area, not a claim of comprehensive UI unit coverage.
- Fresh and seeded 49-to-50 restricted-owner API rehearsals: **474/474 each**, zero failures/skips/TODOs, all 91 application table owners verified. Historical migration SQL/journal entries and existing helper bodies remain unchanged. The final equivalent middleware mounting change was followed by the full API suite and the final restricted-owner browser run.
- Browser fixtures: **245/245 passed**. Final-source real API/restricted-owner browser integration: **3/3 passed**, covering unsigned/signed forms, immutable PDF/library access, foreign-copy denial and insurance evidence/audit behavior.
- Strict API source/test and all-workspace typechecking, full workspace lint, repository hygiene and the updated OpenAPI reference/command contract check pass. Tooling regressions: **112/112 passed**.
- Production dependency audit: zero advisories. Secret scanning passed available history and the candidate tree; the synthetic secret fixture was rejected. Reports do not upload source or credentials.

Commands include `pnpm test:managed-owner`, `pnpm test:coverage`, `COVERAGE_BASE_SHA=b7820b0c9108d4c78d9e82b9158b54c9de764909 pnpm coverage:changed`, `pnpm lint`, `pnpm typecheck`, `pnpm test:quality`, the full web Playwright fixture suite, `pnpm test:browser:api`, `pnpm audit --prod`, and the existing secret-scan wrappers. Every database used for these checks was a disposable loopback fixture and was removed afterward.

## Final CodeQL acceptance

**All 65 original findings are resolved locally.** Official CodeQL 2.27.4 `security-extended` analysis reports zero results for candidate JavaScript/TypeScript, Python and Actions, and zero results for the independently archived fallback. The unchanged repository severity gate passes. [The machine-readable evidence](release-security-remediation.json) records report hashes and exact source inventories.

The candidate full scan analyzed 248 JavaScript/TypeScript files, one Python file and four workflows. The archived fallback scan analyzed 223 JavaScript/TypeScript files, one Python file and two historical workflows. The final preparer added two explicit root configuration paths while the full scan was running; the full JavaScript security suite was therefore rerun on the four release-tool files and matching dependency metadata, with zero findings. The candidate full-scan wrapper correctly reported source drift rather than claiming a frozen scan; hash comparison proves that the preparer is the only changed scanned source and the focused rescan covers its final bytes. All other candidate snapshot files are unchanged, with no unscanned additions or removals.

The final fallback differs from the fully scanned intermediate artifact only in root package/workspace configuration and four matching regression-test files. Every production application, SQL and build-hook byte is identical. The configuration matches the final dependency metadata; tests passed by execution and are not claimed to be CodeQL-scanned. The final source and build inventories, six-file comparison, and scanner scope comparison are retained with the artifact and in the evidence JSON. No security rule or required check was disabled.

## Rollback artifact and release boundary

The [rollback guide](../deployment/local-rollback.md) and [pinned overlay manifest](../deployment/rollback-overlay.json) prepare an independent archived fallback from deployed commit `7d2cabe4b48d4e4d2aa8006a7bb253c539d79d12`. The six database compatibility files preserve the complete 50-entry ledger and strict private-role checks; explicit security, dependency and build-identity overlays keep API and web aligned. The original 49-entry binary remains incompatible with migration 50.

Source and build manifests bind the baseline, every overlay, transitive local imports, all resulting source bytes and the actual API/web outputs. Synthetic local fixture identity is labelled `revisionIsGitCommit: false` and `deployable: false`; it cannot stand in for successful GitHub checks on a real commit. The normal package build hooks remain intact. The fallback retains historical repository CI configuration and needs reconciliation with the current required workflows before publication.

A local compatibility/restart rehearsal is not a hosted candidate-to-fallback transition or a database restore. Exact-commit GitHub results, publication of the workflows/build guards, verified post-deployment event wiring, and an authorized staging rollback/recovery drill remain release acceptance work. Marketing remains independently versioned. Nothing in this record authorizes production promotion.

## Final fallback acceptance

Prepared artifact: `.tmp/rollback/49e8726d-1702-42fa-a680-904ff114d9bb`.

- Source SHA-256: `25918c84654457a16a3ac32d5e66121c85edcbf2c4efcce7ccc2364d00435057`.
- API/web output inventory SHA-256: `3672dc2722fa5794812f6193e8c6a8ddab9d6108c5e913e463eff02a58d96d0f`.
- Offline frozen installation, both normal production package builds, **474/474 API tests** and **133/133 web tests** passed.
- Unmodified deployed source rejected both the 50-entry ledger and new policy inventory. The fallback started in production mode with verified database TLS and a restricted login; health and unsigned 401 checks passed.
- Widening a private helper policy blocked actual startup; corrupting the ledger blocked the actual migrator. After restoring those exact boundaries, restart passed and seeded rows plus all 50 ledger entries were identical.
- Final artifact source/output integrity and the binding of successful rehearsal to both digests were independently rechecked. Every task-owned rollback database/container was removed.

This clears the local CodeQL and rollback-build preparation work. It does not clear the remaining release acceptance listed above.
