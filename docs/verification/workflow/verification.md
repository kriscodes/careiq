# Workflow verification

October 16, 2026. Checks ran in the canonical CareIQ checkout with Node 22.23.2 and pnpm 11.22.0. Database work used only isolated loopback PostgreSQL 18.6. No deployment, commit, push, hosted migration or real message delivery occurred.

## Final checks

| Check | Result |
| --- | --- |
| Workspace lint | Pass |
| Workspace TypeScript | Pass |
| Complete workspace tests | **260 passed, zero failed or skipped**: API 151, web 55, native 43, marketing 8, shared contract 3 |
| Actual-component isolated browser scenarios | **30 passed** including patient signing, collection resumption, strict command payloads, version reviews, responsive layout and stale audit response suppression |
| Production HTTP checks on temporary loopback server | **3 passed**: preview/encoded aliases blocked, matching nonce/CSP/transport headers, missing association files stay 404 |
| API TypeScript build | Pass |
| Web Next 16.4.1 production webpack build | Pass; isolated output and reserved `.invalid` fixture configuration |
| Marketing Next 16.4.1 static production build | Pass; isolated output, non-indexed and no submission connection |
| Expo 57.0.30 iOS/Android/web exports | Pass; final native staff and restricted patient routes included |
| Expo dependency compatibility and Doctor | Up to date; **21/21 checks passed** |
| Mobile association generation tests | **8 passed**; includes `/join` and `/patient-workflow`; no real association files published |
| Dependency backport regression/integrity checks | **16 passed** |
| Unsuppressed production dependency audit | **Fails with two existing high findings** on node-forge/braces backports; zero critical, moderate or low findings |
| Fresh migration replay | **27 ledger entries**, replayed twice with unchanged hashes/order; newly created disposable database removed |
| Restricted runtime catalog verification | Pass; 51 policy-bearing domain tables force RLS; runtime has no raw access to eight audit tables |
| Configured independent local audit-reader verification | Pass; actual CLI validates restricted clinical runtime and independent reader, then exits without hanging |

The final combined workspace run used `pnpm lint`, `pnpm typecheck`, `pnpm test`, API build and association tests. `TEST_DATABASE_URL` pointed only to `127.0.0.1:55434/careiq_test`. Backend integration tests create restricted temporary logins and synthetic fixtures; tests do not use the original hosted database configuration. Fresh replay used a separate `careiq_workflow_replay_test` database, preserving review/test database identities and shared roles. [Sanitized replay evidence](migration-replay.txt).

Security patch provenance and raw audit evidence: [Next.js update](../../security/next-october-2026.md), [Expo SDK patches](../../security/expo-sdk57-patches-2026-10-16.md), [registry audit snapshot](../../security/next-audit-2026-10-16.json), [existing dependency backports](../../../patches/README.md). Published fixed node-forge/braces versions remain unavailable. A passing exploit regression suite does not satisfy the independent raw-audit release gate; no findings were suppressed.

[Machine readable verification](evidence.json).

## Behavior exercised

Actual PostgreSQL/runtime and HTTP checks cover tenant/location/patient isolation, revoked assignments and restricted patient scope, forbidden raw audit reads, immutable versions/facts, provider overlap and availability, rules/readiness/evidence, corrected-review invalidation, archive/restore, stale revisions, idempotency conflict/replay, private byte integrity, scanner quarantine/clean transitions, actual generated/signed PDFs and evidence, terminal patient retry receipts, durable denial evidence, scoped search/detail/export, audit-reader privilege rejection and stable export manifests.

Paging tests include more than 620 records, direct detail dependencies and tightly spaced PostgreSQL microsecond timestamps, avoiding skipped or duplicate rows. Audit tests separately cover microsecond continuation, column grants, predefined/inherited privileged roles, administrative memberships, disabled inheritance, optional database evidence location isolation and revoked export access. OpenAPI references, operation IDs, path parameters and the implemented command registry are checked automatically.

The browser harness bundles actual components with synthetic Clerk/API adapters, blocks non-loopback requests and fails unhandled API calls. It verifies UI transitions and contract payloads. It does not establish a newly signed-in production browser-to-API workflow. Production HTTP checks use synthetic live-shaped keys on reserved hosts; they verify the generated server rather than live authentication.

## Visual and device scope

The actual local Next workflow preview was captured at 1440, 768 and 320 pixels with no page errors or horizontal overflow. Records are synthetic: [desktop](desktop.png), [tablet](tablet.png), [phone](mobile.png).

Expo exports compile JavaScript/Hermes for iOS and Android plus the web route output. No native binary was compiled, signed or installed; physical device acceptance, native cookie/sharing behavior and owner-supplied universal-link publishing remain unverified. Staff native bearer authentication retains the existing explicit activation gate.

## Review and activation

[Open the local review guide](../../workflow-implementation.md) for URLs and the walkthrough. Email/SMS delivery, an actual malware scanner, production storage/retention/worker activation and real provider/device acceptance remain explicit setup work. Missing scanning quarantines uploads; delivery attempts report unavailable and never claim a real send. Raw dependency audit remains a release blocker. The API, web, marketing and Expo review services are running and ready. The workflow preview, patient route, audit route, marketing and Expo patient route returned HTTP 200; a missing patient session returned HTTP 410. The temporary production verification server was stopped. The local application is ready for synthetic review, without asserting production readiness.
