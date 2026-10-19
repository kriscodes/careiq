# Manager and insurance verification

October 18, 2026 · Canonical local checkout · Node 22.23.2

## Results

| Check | Result |
| --- | --- |
| Complete API suite with isolated PostgreSQL | 246 passed; zero failures/skips |
| Complete web unit suite | 78 passed; zero failures/skips |
| Component browser suite, installed Chrome | 59 passed |
| Real API + restricted database browser suite | 3 passed, including new staff insurance lifecycle |
| Workspace type checks | Passed |
| API build | Passed |
| Web production build, webpack | Passed in isolated `.next-manager-insurance-build` |
| Verified migration chain and runtime catalog checks | Passed; replay is a no-op after 0036–0038 |
| Local workflow-preview HTTP readiness | 200 |
| Diff whitespace check | Passed |

Production compilation used reserved `.invalid` synthetic live-shaped configuration in process memory. No real identity or provider was contacted by that build; it is a compilation check, not hosted identity acceptance. The generated additional TypeScript build-directory includes were removed after the isolated build.

## What was proved

The new service/route tests exercise persisted cases and immutable evidence, exact retries, changed-body key conflicts, stale revisions, current evidence correction, policy correction, unknown versus zero benefits, active recipient/location membership, scoped reads, cancelled/no-show exclusion, derived manager counts, microsecond cursor paging and signed cursor binding. Audit failure rolls back domain changes; separate capture survives a rolled-back command. Runtime cannot read raw audit or rewrite evidence. Raw member/source values do not enter ordinary audit metadata or database evidence.

The projection test executes the actual PostgreSQL writer and both current patient/appointment scopes: five allowed business actions are visible, existing history remains, safe columns exclude protected details, pagination is complete, and foreign scope/denials/command internals remain hidden.

Browser coverage includes manual evidence and correction, unknown versus zero amounts, policy correction, a lost-save retry with the same key, read-only controls, responsive layout, and aggregate-only CSV export. The actual browser/API/database staff flow uses the production authenticated workspace and adapter with an isolated synthetic identity-provider seam. It verifies persisted creation, evidence, correction, assignment, case activity, exact staff/resource-linked business events, independent mutation records and cleanup. Both existing patient API/browser flows still pass.

The workflow preview remains synthetic. Screenshots `manager-desktop.png` and `insurance-mobile.png` are drawn from that explicit preview/component harness and contain no live records.

## Local boundary and remaining work

Only the runner-owned loopback databases `careiq_review` and `careiq_test` on port 55434 were migrated. New migrations are additive and previously applied SQL remains unchanged. No hosted migration, commit, staging, push or remote deployment was performed.

Live payer connectivity, production identity/browser acceptance, production migration/roles, practice-approved configurable freshness, external retention/archives and broader cross-workflow reporting remain separate. Seven days is the manual slice's operational recheck default. The loaded-case search/filter scope is explicit; it is not an unbounded server-wide search. Staff display labels currently use stable short account identifiers when an authoritative name is not available.

The production build and automated checks do not claim a full manual accessibility audit, payer accuracy, independent identity verification or device acceptance. See [implementation](../../manager-insurance-implementation.md) and [audit review](../../manager-insurance-audit-review.md).
