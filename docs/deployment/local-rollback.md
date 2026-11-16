# Local rollback artifact for migration 50

This procedure prepares a **distinct local fallback candidate** from the actual November 2 API/web deployment, commit `7d2cabe4b48d4e4d2aa8006a7bb253c539d79d12`. It adds the explicitly reviewed migration compatibility and security files listed below. It does not rename the current dirty working tree as an older release. The baseline and current application have limited functional differences because the intervening work primarily improves readability, release checks and security; the retained source still comes from the archived deployed revision.

The artifact is **not an approved deployment revision**. It has no new Git commit, has not passed GitHub checks for an immutable commit, and contains only the release-workflow configuration present at the historical baseline. Its API/web package build hooks retain the new exact-commit guard, but its complete repository CI configuration must be reconciled with the current seven required checks before any promotion. Marketing remains a separately versioned service and is outside this artifact.

## Prepare and verify

Use the canonical checkout, Node 22.23.4, pnpm 11.22.0, Docker and OpenSSL. Preparation reads only local Git objects. Dependencies are installed from the local pnpm cache with `--offline --frozen-lockfile --ignore-scripts`; a missing cached dependency or mismatched manifest blocks the rehearsal.

```sh
node scripts/prepare-rollback.mjs \
  --security-overlay docs/deployment/rollback-overlay.json

node scripts/test-rollback.mjs /absolute/path/printed/by/preparation
```

The first command prints a new directory below `.tmp/rollback/`. It does not switch branches, modify the current source, create a commit, push or deploy. Re-running preparation creates another artifact and preserves earlier evidence. The second command accepts only such a prepared local artifact; it accepts no database URL or hosted origin.

The pinned [overlay manifest](rollback-overlay.json) names each file, its exact SHA-256 and its review reason. Source changes after review cause preparation to fail. Refresh a pin only after reviewing that particular file; do not replace the manifest with a directory-wide copy.

The mandatory database compatibility overlay comprises six files: the complete migration journal, additive migration `0049_managed_helper_ownership.sql`, the managed helper manifest/verifier, and the existing release/notification verifiers that integrate those strict checks. Every original SQL byte and the first 49 journal entries must match the archived baseline.

The additional overlay preserves authenticated rate limits, private POST read contracts in both API and web, cursor/provider boundary guards, removal of persisted preview records, and the release-identity/build guards. The typed clinical-error dependencies are included because the updated protected application entry point requires their matching error contract. Root package/workspace configuration accompanies the current lockfile so frozen dependency resolution remains reproducible. Only explicitly listed regression tests replace or supplement historical tests; other tests remain at the baseline revision. The current retry-error fixtures and formatting-tolerant route/OpenAPI assertions accompany the corresponding implementation changes; test expectations are not relaxed.

## Provenance and build identity

`rollback-provenance.json` records the immutable baseline commit/tree, every overlay file and its prior/current hash, the full resulting source inventory, and the transitive relative-import closure with each dependency labelled baseline or explicit overlay. Validation rejects unlisted source additions, edits and deletions. Input files are opened without following symlinks and checked/read through the same file descriptor.

`rollback-build.json` binds all API output files and the web production output/release metadata to that source digest and the locked dependencies. Generated dependency/build directories are explicitly distinguished from source; output additions or changes block startup. Both source and output inventories are rechecked before each API start.

The local harness derives a synthetic 40-character identity from the artifact source digest solely to exercise unchanged production identity validation on loopback. It is recorded with `revisionIsGitCommit: false` and `deployable: false`; it is **not** a Git SHA, a successful CI result or a revision to put into a hosted deployment manifest. Production `releaseRevision` and exact-commit checks are unchanged. Normal API/web `pnpm run build` commands execute their real package hooks; the provider guard correctly identifies this as a local build rather than authorizing a Render deployment.

## Rehearsal boundary

The runner creates PostgreSQL 18.6 with a new disposable TLS certificate, binds the database only to loopback, and applies all 50 migrations as a non-superuser/non-BYPASSRLS owner. It runs the original archived migrator and database verifier against that schema and requires them to reject the longer ledger and new policy inventory. This demonstrates why the compatibility overlay is necessary.

It then runs the artifact's API suite with its explicit security regressions and no skipped/TODO tests, plus its web unit suite. The actual compiled fallback API starts in production mode using a separate restricted login and verified TLS. Private storage is a new owner-only directory outside the artifact; identity configuration uses reserved synthetic values, optional workers/delivery are disabled, and no real provider account or secret is used.

The rehearsal requires healthy database readiness and unsigned account denial, then stops the process. A deliberately widened private-helper policy must prevent actual production startup. A deliberately altered migration checksum must stop the actual migration runner. After restoring those exact boundaries, the fallback must start again, with the synthetic practice/location/patient rows and all 50 ledger entries unchanged. All owned processes, the database container/volume, private storage and synthetic TLS key are removed afterward.

`rollback-rehearsal.json` and test/build logs remain beside the artifact. The procedure demonstrates **migration-50 compatibility, fail-closed verification, restart and data preservation**. It does not demonstrate a candidate-to-fallback provider transition, recovery timing, database restore, real provider authentication, every browser workflow or hosted acceptance. A separately authorized staging rollback drill is still needed.

## Evidence

The initial compatibility-only archived artifact passed API/web production builds, restricted production API startup over verified TLS, strict policy/ledger rejection and synthetic data preservation. That artifact did not include the later security overlay and is not the final fallback candidate.

The final rehearsal passed on November 2, 2026 (Los Angeles), using local artifact `.tmp/rollback/49e8726d-1702-42fa-a680-904ff114d9bb`. Its immutable baseline is `7d2cabe4b48d4e4d2aa8006a7bb253c539d79d12`; the explicit overlay contains six migration compatibility files and 35 individually pinned security, dependency, release-safety and regression files.

| Evidence | Result |
| --- | --- |
| Full source SHA-256 | `25918c84654457a16a3ac32d5e66121c85edcbf2c4efcce7ccc2364d00435057` |
| Combined API/web output SHA-256 | `3672dc2722fa5794812f6193e8c6a8ddab9d6108c5e913e463eff02a58d96d0f` |
| API suite | 474 passed; no failures, skips or TODOs |
| Web suite | 133 passed; no failures, skips or TODOs |
| Provenance tooling tests | 4 passed |
| Real package builds | API and aligned web passed with frozen offline dependencies |
| Original deployed baseline | Rejected both migration-50 ledger and private-policy inventory, as required |
| Restricted production startup | Passed with verified database TLS; health ready and unsigned account access denied |
| Deliberately corrupted boundaries | Widened helper policy blocked startup; altered ledger blocked migration |
| Restart and preservation | Passed; synthetic practice/location/patient rows and all 50 ledger entries identical |
| Cleanup | Task-owned database containers, TLS keys and private storage removed |

The artifact directory retains `rollback-provenance.json`, `rollback-build.json`, `rollback-api-tests.json`, `rollback-rehearsal.json`, `scan-provenance-binding.json` and the build/test/startup logs. The [security remediation verification](../verification/rollback-security-remediation-2026-11-02.md) records the complete static-analysis results and hash binding. The fully scanned preceding fallback and this final artifact have identical production, SQL and build-hook source; the six differences are the current root package/workspace dependency configuration and four matching test files. Their exact prior/current hashes are recorded in `scan-provenance-binding.json`.

This artifact remains local-only regardless of its passing local results. See [release verification](release-verification.md) for the required exact-commit checks and separate post-deployment smoke/rollback workflow.
