# Render release — October 31, 2026

Status: merged and live on API/web; source checks, backup rehearsal, hosted database promotion, provider account policy and public hosted smoke checks passed. Authenticated hosted workflow acceptance remains pending.

## Reviewed source and checks

[PR #17](https://github.com/kriscodes/careiq/pull/17) contains the latest practice navigation/settings, personal-account lifecycle, owner workspace access, Today/Appointments planning and managed-owner migration compatibility changes. Reviewed source: `dfe86acadc0427d443766b3d76b6fed4e6e26aba`. Source commits use the existing `kriscodes <kristian@kristiancodes.com>` author and committer identity, with change-only commit messages. PR #17 merged as `2d107b8ed632a519dad8afc886f6d4fa1578b007`, attributed to `Kristian Salmeron <48185280+kriscodes@users.noreply.github.com>` through GitHub's standard merge flow.

| Check | Result |
| --- | --- |
| Complete API suite using the existing CI migration-ownership model | 395 passed, zero failed or skipped |
| Web units / translation catalogs | 128 / 7 passed |
| Component browser / real local API browser suites | 236 / 3 passed |
| Workspace lint, typechecks and production builds | Passed |
| Dependency regressions / Python runner tests | 16 / 11 passed |
| Production dependency audit | Clean after the reviewed `qs` 6.16.1 update |
| Full development audit | One moderate `minimatch` finding remains visible |
| [CareIQ checks](https://github.com/kriscodes/careiq/actions/runs/41258297273) | Succeeded on the reviewed source |
| [Readiness checks](https://github.com/kriscodes/careiq/actions/runs/41258297270) | Succeeded on the reviewed source |

The local suites use synthetic records and controlled identity seams. These results do not establish production password, challenge, reset, invitation delivery or real-provider workflow acceptance.

## Backup and database promotion

A fresh native Render backup matched SHA-256 `59c6e0df0e06cb6bed9de444d9e0b6b2d6b6e81dffcd2b1219fb7579d9a2c3e3`. An isolated PostgreSQL 18.6 restore, cloned actual role/ACL metadata, upgrade from 43 to 48 migrations, unchanged repeat and direct restricted-runtime preflight all passed. [Managed-owner migration and current-backup rehearsal](managed-owner-release-2026-10-31.md) records the exact evidence and limits.

The hosted `careiq_n8yp` database was promoted using the actual immutable-source migration runner, invoked directly through Node/tsx. The separate operator connection used external TLS with full certificate verification. Every existing ledger timestamp and hash was checked before the five additive migrations; the final 48-entry ledger verified successfully. An immediate repeat was a no-op. No earlier migration bytes or ledger hashes were rewritten.

The actual restricted runtime passed the production release preflight. Its `careiq_api` identity, `careiq_n8yp` target, internal encrypted connection configuration and Node 22.23.4 runtime were retained. Remote catalog checks confirmed the boolean availability helper belongs to `careiq_availability_reader` and the API cannot assume that role. No extra runtime membership grant was needed. Credentials were supplied through hidden input, unset afterward and excluded from evidence; the temporary migration-source archive was removed.

Migration 47 preserves saved owner restrictions while reconciling eligible existing owners. The availability reader is a private NOLOGIN, non-superuser, NOBYPASSRLS role with narrowly checked column grants and a scoped SELECT policy. Runtime appointment reads remain subject to their original location policies; the helper returns only an occupied-slot boolean.

## Production account policy

With the owner's approval, Clerk's production default allowing users to delete themselves was switched off and saved. The provider's **Apply existing users** operation completed, applying the same restriction to existing accounts. Other password, ban, organization and role settings were not part of this change. Application archival and tracked deletion requests retain the reviewed ownership checks and record-retention behavior.

## Application promotion and hosted acceptance

API and web track `main` with automatic deployment enabled. Marketing uses its separate deployment branch and was left untouched.

| Item | Result |
| --- | --- |
| Merge commit and exact source-tree comparison | `2d107b8ed632a519dad8afc886f6d4fa1578b007`; GitHub tree `c6e33f4ec7cbc4ade9029ca1b31b7ef406808cc4` exactly matches the tested local HEAD tree |
| API `srv-darjgre0tbcc73brvbmg` deployment | [Live: dep-dbj8tobncjis73dcc5vg](https://dashboard.render.com/web/srv-darjgre0tbcc73brvbmg/deploys/dep-dbj8tobncjis73dcc5vg), exact merge commit; completed October 31 at 18:00:57 PDT (`2026-11-01T01:00:57.201877Z`) |
| Web `srv-dau6ipqd0e5s73efagk0` deployment | [Live: dep-dbj8tobncjis73dcc67g](https://dashboard.render.com/web/srv-dau6ipqd0e5s73efagk0/deploys/dep-dbj8tobncjis73dcc67g), exact merge commit; completed October 31 at 18:00:52 PDT (`2026-11-01T01:00:52.041902Z`) |
| API health, unsigned-account denial and deployed production preflight | `/health` 200 with `status=ok`, `service=careiq-api`, `database=connected`; unsigned `/api/v1/me` 401 `UNAUTHENTICATED`. The new compiled release verifier passed before listening on port 10000 |
| Public sign-in, production preview denial and shipped asset checks | Public sign-in rendered in the browser; `https://app.careiqlabs.com/` and `/sign-up` returned 200, `/design-preview` returned 404, and the new Little hello companion PNG returned 200 |
| Authenticated hosted smoke acceptance | Pending: no existing signed-in browser session was available; no authenticated workflow or mutation was submitted |

The API's existing durable private disk and guarded startup configuration were retained. A transient health 502 occurred during the disk-backed service switch; subsequent GET `/health` returned 200 with the database connected. The existing Node 22.23.4 environment override remains unchanged; its actual selection was verified before this rollout. No separate per-deployment runtime-version claim is inferred from that earlier check. Marketing was not redeployed. This report records the local release evidence; no additional public push or deployment was performed solely to publish it.

## Remaining acceptance limits

The realistic non-bypass-owner rehearsal exposed 28 failures in older patient-token, patient paperwork/communication and delivery helper paths, documented in the [managed-owner record](managed-owner-release-2026-10-31.md). They are not included as passing managed-owner workflows. Catalog preflight verifies the release boundary; functional activation of those paths requires its separately reviewed correction and acceptance.

Production identity/provider flows, optional delivery/scanning/workers, protected audit-reader activation, native-device acceptance and real-patient operating approval retain their existing boundaries. No patient message, account archival/deletion or ownership transfer was submitted to establish this release evidence.
