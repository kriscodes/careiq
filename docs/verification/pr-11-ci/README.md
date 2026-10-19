# PR #11 check repairs

The first PR checks failed in the API suite: 306 tests, 286 passed, 20 failed, zero skipped. Both workflows stopped at that step; the separate dependency audit passed. Failed runs: [CareIQ checks](https://github.com/kriscodes/careiq/actions/runs/39207794896) and [readiness](https://github.com/kriscodes/careiq/actions/runs/39207794874).

## Corrections

- Add migration `0042_paperwork_publication_permission` to distinguish clinical authorization from the `communication_permission_events.allowed` column. Pin the release verifier to the corrected helper. The prior authorization, exact-copy, consent, immutability, and execution boundaries are preserved.
- Cast catalog attribute names to PostgreSQL text before building the update-column array. The database driver then returns an array rather than a raw `name[]` string, so legitimate restricted runtime grants pass verification.
- Use database transaction time for automatic reminder eligibility and immediate delivery scheduling. Explicit future schedules remain explicit. Tests verify that a newly committed immediate intent is already due and that an initial send consumes the matching automatic reminder occurrence.
- Deduplicate work-item references in inbox and digest audit events. Multiple distinct alerts for one work item remain present without violating the audit resource relationship constraint.
- Scope browser selectors to the Purpose combobox and Notifications navigation. The product UI and tested reissue/routing assertions are unchanged.
- Give synthetic provider accounts and message IDs unique fixture identities, and restore reminder policy in test cleanup. Retained suppression facts cannot contaminate a later test run.

## Local verification

All checks use the existing canonical checkout and task-owned isolated loopback PostgreSQL 18.6 databases named `careiq_test`. No hosted database, provider account or real message is involved.

| Check | Result |
| --- | --- |
| Migration upgrade | Existing 42-entry test ledger upgraded to 43 entries. |
| Fresh migration and repeat | Complete 43-entry ledger and unchanged replay passed. Historical SQL files are unchanged. |
| Lint and TypeScript | All workspaces passed. |
| Unit and database tests | 423 passed, zero failed/skipped: 316 API, 90 web, 9 marketing, 3 contract, 5 localization. |
| Repeated delivery integration | 13 passed, zero failed/skipped on a previously exercised test database. |
| Real API/browser | 3 passed: unsigned paperwork, signed paperwork and insurance, with restricted database checks and owned fixture cleanup. |
| Browser components | All 66 passed locally; the focused communications suite also passed 7/7 after selector corrections. |

A first local rerun against retained baseline fixtures exposed reused synthetic provider identifiers; those are now isolated. An additional repeat exposed the immediate-delivery clock race; the final repeat and complete unit suite above pass after fixing it. These outcomes are retained as diagnosis rather than being counted as successful attempts.

Actual GitHub check results belong to the exact commit shown on [PR #11](https://github.com/kriscodes/careiq/pull/11/checks). Local verification does not establish hosted login configuration, provider activation or production deployment. Apply the additive migration through the existing reviewed release procedure before starting the matching API.
