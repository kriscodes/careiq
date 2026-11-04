# Database isolation and synthetic capacity verification — October 17, 2026

The restricted database checks passed across 100 synthetic practices. Measured scope statistics improved the existing patient/document page plans without changing authorization. The shared developer host saturated at higher concurrency; these results do not certify production capacity for 100 practices.

## Dataset and machine

One populated clinic plus one empty unassigned-location fixture per practice; one active synthetic actor per practice. Appointments represent 30 days ×100 appointments per practice/day (10,000 appointments/day across the dataset). All ordinary constraints, immutable guards, mutation audit capture and forced RLS remained enabled.

| Seeded records | Actual count |
| --- | ---: |
| Practices / locations | 100 / 200 |
| Patients / appointments | 100,000 / 300,000 |
| Providers | 1,000 |
| Documents / immutable versions / file metadata | 100,000 / 200,000 / 200,000 |
| Reviews / visit requirements / accepted evidence | 50,058 / 20,000 / 4,932 |
| Open requests / request items / work items | 10,000 / 10,000 / 15,068 |
| Mutation audit records after seed | 1,113,358 |

Apple M2, 8 logical cores, 8 GiB RAM; Docker 8 CPUs/3.825 GiB VM memory, PostgreSQL 18.6. No separate container CPU/memory cap. Matched final measurements use repository-pinned Node 22.23.2 on macOS/arm64. Seed footprint was 1,870,558,911 bytes; final database inspection reported 2,260,711,103 bytes. No PDF bytes were stored or rendered. The seed paused once before the next practice when available host memory fell below 12%, retained 63 committed practices and resumed after recovery. Total seed elapsed 9 m 21 s, including that pause.

The machine was shared with the desktop/application and had background load; it was not a controlled dedicated benchmark host. Files labeled `node24-exploratory` retain earlier exploratory captures and are excluded from the comparison below.

## Workload and results

Closed-loop service-and-database workload: intended 50% dated front-desk snapshot, 20% patient search, 15% document list, 10% patient detail, 5% actual optimistic-concurrency patient update. The actual counts and per-operation timings are retained in JSON. Each stage starts a bounded set of callers for 15 seconds, then drains in-flight work. Concurrency ramps 1→10→25→50, rather than an unbounded arrival-rate test. Pool samples are every 100 ms. Each 10/25/50 stage exercised all 100 practices; the single-caller stage did not visit every practice within 15 seconds.

Both final runs used the same Node 22 runtime, dataset, service code, 10-connection pool and 40-waiter budget. Baseline ran before migration 0035, then ordinary ledger-checked migration 0035 was applied before the after run. Audit rows/revisions naturally accumulated from the workload. Browser/HTTP/Clerk/network, real PDF generation/rendering/download/storage, large structured answers, scanner, email, workers and multi-replica coordination are excluded. This is not a hot-record contention or long soak test; closed-loop timings do not measure arbitrary incoming bursts.

Before → after; milliseconds except throughput:

| Concurrent callers | Operations/sec | p50 | p95 | p99 | After peak waiting |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4.90 → 6.25 | 243 → 173 | 301 → 240 | 341 → 279 | 0 |
| 10 | 19.66 → 21.92 | 524 → 473 | 861 → 736 | 1225 → 1073 | 0 |
| 25 | 19.57 → 23.12 | 1213 → 1062 | 1732 → 1445 | 2031 → 1682 | 15 |
| 50 | 19.14 → 21.68 | 2509 → 2178 | 3503 → 2977 | 4298 → 4062 | 40 |

All eight final stages recorded zero application/SQL errors. Peak connections stayed 10; observed waiting reached 40 at 50 callers. The 50-caller after run still had overall p95 of about 3 seconds, so additional callers did not scale throughput linearly. Choose the actual staff concurrency, peak arrivals and response-time targets, then repeat on the intended hosting tier before capacity acceptance.

After run at 50 callers:

| Operation | Completed | Median SQL statements | p95 |
| --- | ---: | ---: | ---: |
| front_desk | 185 | 56 | 2880 ms |
| patients | 72 | 13 | 2714 ms |
| documents | 54 | 23 | 2686 ms |
| patient_detail | 36 | 48 | 2410 ms |
| patient_update | 18 | 24 | 4315 ms |

The dated front-desk snapshot still uses 56 SQL statements. Exact totals and multiple dependent collections remain material work. Query count was not reduced or hidden by this change; response pages/history are bounded with existing signed keyset cursors and scope predicates. Use narrower read models or revise count UX only as a separate measured product change.

## Demonstrated planner improvement

Existing `(practice_id,location_id,created_at DESC,id DESC)` indexes were present. Independent-column estimates predicted about 10 scoped rows despite 1,000 actual patients/documents per clinic. PostgreSQL chose bitmap scans plus top-N sorts, causing the per-row RLS authorization check to run over 1,000 rows for a 51-row page.

Migration 0035 adds dependency statistics on `(practice_id,location_id)` for patients/documents and runs ordinary ANALYZE. The planner then uses those existing ordered indexes and stops after 51 authorized rows. It changes no patient data, policy, role, grants, function authority or visibility.

| Query | EXPLAIN execution before → after | Shared buffer hits before → after |
| --- | ---: | ---: |
| patients page (51 rows) | 16.029 → 0.980 ms | 8039 → 414 |
| documents page (51 rows) | 15.684 → 0.917 ms | 8045 → 414 |

The page-plan bound is direct evidence; whole-workload throughput is noisier on this shared host. Exact counts still inspect the authorized rows and take roughly 16 ms for 1,000 rows in this fixture. The top measured plans did not scan the entire large clinical tables; sequential scans seen in the saved plans were on small practice/location or empty signature tables. No speculative new index, RLS weakening, transaction-lock removal or broad query rewrite was applied.

Before a hosted rollout, rehearse the ordinary migration with real data volume and the existing lock/statement budgets. CREATE STATISTICS/ANALYZE still require database locks/resources; schedule an appropriate maintenance window and stop/review if lock budgets expire. No hosted migration was performed.

## Isolation and bounded resource controls

Final restricted-runtime isolation passed 112 checks, including the complete release catalog (roles/column privileges, forced RLS/policies, immutable/audit guards), direct known foreign patient/document/version/request IDs, cross-practice update/FK rejection, forged practice/location with the wrong actor, matching unassigned-location denial, rollback/malformed context and connection reuse across all 100 practices. The rollback test first proves the authorized own record is visible, then proves both the scope settings and access disappear after rollback. This complements the separate API/file adversarial matrix; UUID secrecy is not the boundary.

The shared runtime credential remains a server secret: authenticated API context is established before transaction-local scope. These tests cover ordinary tenant requests and restricted runtime behavior, not compromise of the application/operator credentials.

A separate 60-checkout probe with one deliberately held connection showed 60 pending/accepted before hardening, versus 40 pending/accepted and 20 retryable `DATABASE_BUSY` 503 responses afterward. Focused tests also cover same-turn bursts while an idle client exists and while the pool is not full, mixing promise/callback/query APIs with zero and nonzero waiting budgets. They verify configured checkout expiry, statement cancellation+rollback scope clearing, idle connection reconnection and later successful work.

After the load measurements, a focused lifecycle regression also verified server idle-transaction termination while a client is checked out and application code awaits outside SQL. A permanent pool-owned client listener prevents an uncaught error, logs one sanitized failure per client and lets the normal caller release evict the dead connection. The actual 100 ms timeout test attaches no test error listener: it observed SQLSTATE 25P03, a failed subsequent query, a different replacement backend, empty transaction scope and successful later work. All 17 focused resource/configuration/recovery checks passed under pinned Node 22.23.2; application and benchmark type checks passed. This failure-path change followed the matched load captures and does not alter their SQL or authorization.

Runtime defaults per API process (and validated ranges):

| Setting | Default | Allowed |
| --- | ---: | ---: |
| DATABASE_POOL_MAX | 10 | 1–50 |
| DATABASE_POOL_MAX_WAITING | 40 | 0–200 |
| DATABASE_POOL_CONNECT_TIMEOUT_MS | 10000 | 100–30000 |
| DATABASE_STATEMENT_TIMEOUT_MS | 30000 | 1000–120000 |
| DATABASE_LOCK_TIMEOUT_MS | 5000 | 100–30000 |
| DATABASE_IDLE_TRANSACTION_TIMEOUT_MS | 30000 | 1000–120000 |

Idle connections expire after 10 seconds. URL startup/timeout overrides are rejected; configuration errors omit values. Saturated/expired checkouts return a safe retryable busy error, preserving FIFO/recovery behavior. The admission calculation reserves immediately available idle/new slots before pg's deferred dispatch, so same-turn bursts cannot bypass the queue cap. Migration/admin pools retain their separate reviewed statement/lock budgets. The original benchmark role also carried 30 s/5 s/30 s safeguards, disclosed in its captures. Total connection capacity must include every API replica, separate audit reader and worker; defaults are not a fleet-wide capacity promise.

## Evidence and reproduction

- [Seed counts/resources](seed.json), [final catalog/index/settings inspection](database-inspection.json), [isolation results](isolation.json).
- [Node22 baseline](baseline.json), [Node22 after](after.json), [baseline plans](baseline-plans.json), [after plans](after-plans.json).
- [Queue before](baseline-queue.json), [queue after](after-queue.json).
- [Migration/database cleanup receipt](cleanup.json) records the 36-entry verified ledger through 0035 and removal of only this task-created benchmark database/login/private credential state.
- [Benchmark source](../../../apps/api/scripts/tenant-capacity-benchmark.ts), [pool regressions](../../../apps/api/tests/pool-admission.test.ts), [release procedure](../../api-production-release.md), [owner checklist](../../security/owner-security-checklist.md).

From `apps/api`, using the pinned Node 22 executable and existing private loopback administrator env:

```sh
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts initialize
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts seed
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts inspect
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts isolation
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts after-plans
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts after
"$CAREIQ_NODE" --env-file=../../.local-review/database.env --import tsx scripts/tenant-capacity-benchmark.ts cleanup
```

Set `CAREIQ_NODE` to the repository-pinned 22.23.2 executable. The script verifies the owned loopback container/volume/port, creates a fresh random database and restricted login, verifies migration hashes and requires its exact private run marker before seeding/running/cleanup. Initialization refuses an existing private run; a paused seed resumes only if persisted and database practice counts agree. Credentials/state are 0600 and never printed. Use only synthetic data. A fresh current-release initialization includes 0035, so it reproduces optimized capacity, not the historical pre 0035 baseline; retain schema/runtime identity when comparing releases. The candidate-statistics modes are restricted to the marked benchmark database. Never redirect this script or tests at a hosted/application database.
