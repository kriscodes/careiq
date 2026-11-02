# Manager team activity verification

November 2, 2026 · Canonical checkout: `/Users/kristian/Documents/Server/CareIQ` · Local only.

The existing Manager dashboard now includes team-wide staff activity, filtered by local action day, acting staff account and action type. It reports appointment actions, manual insurance observations/corrections and follow-up actions. This is an extension of the authenticated app and API, rather than a standalone design prototype.

## Completed checks

| Check | Result |
| --- | --- |
| Complete API suite, isolated PostgreSQL database | 398 passed; 0 failed; 0 skipped |
| Focused manager/insurance API boundary and projection checks | 10 passed; 0 skipped |
| API type checking | Passed |
| Complete web unit suite | 131 passed; 0 failed; 0 skipped |
| Web type checking and lint | Passed |
| New manager activity component browser suite | 5 passed |
| Real HTTP/restricted-database browser suite | 3 passed: unsigned patient, signed patient, manager insurance/activity |
| Optimized web compilation | Passed using webpack, separate `.next-manager-activity` output and reserved `.invalid` configuration fixtures |
| Verified migration runner | 49 entries verified in both runner-owned loopback databases after additive 0048 |
| Independent API/UI review and final diff whitespace check | Passed; no remaining blockers |

Compilation used deliberately nonfunctional live-shaped key/domain fixtures in process memory, consistent with prior local compilation checks. This checks compilation and rendering; it is not hosted authentication acceptance. Generated Next type references and build-directory additions were restored to their prior contents after the build.

The browser checks use installed Chrome and synthetic records only. The real API harness creates temporary practice IDs, a restricted non-owner database role and private test assets, then verifies its cleanup. Production identity code is not substituted; the existing explicit test-only identity seam is used in the harness.

## Behavior exercised

- Action day is independent of appointment day. The backend checks the 25-hour November 1 Los Angeles day, including its exact midnight boundaries.
- Canonical events are counted once; appointment detail events, command acceptance/replay, reads, denied actions and background actors are excluded.
- Insurance history retains the original and corrected outcomes and constrained manual source; protected reference/member/benefit values stay out of manager activity.
- Full filtered counts and historical actor options are independent of loaded history pages. Former staff attribution remains available.
- Signed pagination retains microsecond boundaries and rejects changes to person, category, date, limit or requesting actor.
- Management and explicit activity permissions are both required with clinical reads. Restricted runtime raw-audit SELECT and revoked/unassigned-location access are rejected. The full existing API suite also covers broader tenant isolation.
- Manager reads record the exact disclosed entity references before release. Release checks verify the protected helper and restricted grants.
- Browser filters and pagination work; prior rows disappear while a new query loads. Late responses do not restore stale results; permission changes hide the view. Read and pagination failures remain distinguishable from an empty successful response.
- The real browser flow persists manual evidence, a correction and a follow-up assignment, then reads all four canonical events through the new endpoint and filters them by person/category/day. The original appointment-day selection remains unchanged.
- English and Spanish layouts were checked at 320px. Actual-dashboard synthetic screenshots were visually inspected at desktop and phone widths. A review caught and corrected the real plural appointment entity-type label; its browser fixture now checks the canonical event shape.

## Review artifacts

- [Desktop manager dashboard](manager-team-activity/desktop.png)
- [English phone dashboard](manager-team-activity/phone-en.png)
- [Spanish phone dashboard](manager-team-activity/phone-es.png)
- [Verification results](manager-team-activity/results.json)
- [Real API/browser result](manager-team-activity/api-browser.log)
- [Optimized compilation result](manager-team-activity/web-build.log)

Implementation, API filters, count definitions and permissions: [manager team activity](../manager-team-activity.md).

## Release scope

Only the runner-owned `careiq_test` and `careiq_review` databases on `127.0.0.1:55434` were migrated. Existing applied migrations and pre-existing uncommitted changes were preserved. These checks were completed before the source commit. No push, hosted database migration or deployment was performed.

Staff labels currently reuse the established account-suffix convention; authoritative human-name directory integration is separate. This activity view covers recorded staff actions in the selected location. It does not claim visibility into unrecorded external portal work, automated/patient actions, cross-location trends, live payer connectivity, broader exports or hosted acceptance. Protected audit access remains separate.
