# CI and local-review mobile separation — October 18, 2026

The canonical workspace now runs API, web, marketing and shared packages without requiring the extracted mobile application. This change does not create a GitHub repository, commit, push, deploy or change hosted configuration. Root preserved/stopped the matching owned mobile supervisor before the local runner registry changed; this review verified its process record is absent.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm web:associations` | Existing owner-supplied website association generator; retains its original source file and web output location. |
| `pnpm web:associations:check` | Validates actual owner-supplied association metadata without writing files. Missing owner inputs intentionally fail; no native signing identity is fabricated. |
| `pnpm web:associations:test` | Tests the retained website association contract with isolated fixtures. Required by release checks and both CI workflows. |
| `pnpm test:browser:api` | Forces the explicit real local API/browser opt-in and runs paperwork against guarded loopback PostgreSQL with a restricted runtime role. Required by release checks and both workflows. |
| `pnpm release:check` | Validates the test database URL before lint/types/units, retained security/association tests, component and real API browser checks, then the unchanged raw production audit. |

Active `mobile`, `mobile:*`, Expo compatibility/build steps and Expo environment variables were removed from this repository's root scripts and workflows. The native client has its own later repository/release scope. Website association files/routes/tests and future API native-authentication boundaries remain deliberately available. The association generator's historic filename and owner metadata names remain valid integration contracts; they do not require `apps/mobile`.

## CI controls retained

Both workflows keep pinned immutable action references, read-only repository permissions, frozen installs, disposable PostgreSQL 18.6 migration replay, lint/types/units, serial API/shared/web/marketing builds and the unsuppressed production dependency audit. Both now explicitly require security regressions, website association tests, component browser checks and actual paperwork browser/API/restricted-database checks. The readiness audit remains an independent job. No GitHub Actions run was initiated or claimed.

The release preflight now rejects missing/malformed URLs, non-PostgreSQL protocols, non-loopback/lookalike hosts, databases other than `careiq_test`, and query/fragment-bearing targets before any downstream test can silently skip. The real API browser command sets `CAREIQ_REAL_API_E2E=true` and does not allow an empty test selection to pass. [12-case guard receipt](ci-release-guard.json), [workflow YAML review](ci-static-review.json).

## Local runner

The runner registry and CLI accept only `api`, `web` and `marketing`. Removed names fail before environment reads; unknown ownership records fail closed. Expo command/environment branches are gone. Generated API browser origins contain only ports 3101/3102; native authorized parties remain explicitly empty and the status gate remains false. Process ownership checks, restricted database/audit credentials and private file directories are preserved. In-memory API settings take effect on the next matching owned restart; this review preserved ordinary services. [Synthetic runner checks](ci-local-runner.json).

## Verification after the final dependency graph

- Root scripts/CI were checked only after the dependency agent confirmed the final frozen install and 16 retained security cases. This agent did not regenerate a lockfile or install dependencies.
- All 12 release preflight cases pass; these checks run only the initial Node guard and never connect to a database.
- Both workflow YAML files parse and pass the retained-controls review. This is a static local review, not a remote CI result.
- Isolated production web build passes in 17.40 seconds and marketing in 10.77 seconds, executed serially with reserved `.invalid` configuration and intake/indexing disabled. [Build receipt](ci-production-builds.json).
- All 3 actual production HTTP guard checks pass, zero skips/flakes: preview/encoded aliases 404, fresh matching nonce/CSP/no-store sign-in HTML and absent owner association files 404. The task-owned 127.0.0.1:3191 server was stopped. [HTTP receipt](ci-production-http.json).
- Preserved development web `/design-preview` and `/sign-in` both return 200 on the longer read-only probe. The initial two-second status probe briefly showed warming during recompilation; no restart was needed. API and marketing status were ready. [Local receipt](ci-local-services.json).
- Only temporary generated web tsconfig include paths were removed after the isolated build; next-env files remain unchanged. No ordinary service was stopped by this agent and no screenshots, traces, provider credentials or patient bodies were saved.

The root agent's consolidated `pnpm release:check` owns final workspace unit/lint/type, component/API browser, association, security and raw audit results. Those suites were not duplicated here. Hosted identity, runtime storage/backup/email and promotion acceptance remain distinct operational checks, as recorded in the security review.
