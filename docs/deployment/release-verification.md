# Release identity, security analysis and post-deployment verification

A release is eligible only when the required checks succeed for its exact commit. The deployed services must then report that commit and pass the public smoke checks. A previous successful commit, a branch name, or a green build of different source is not sufficient evidence.

## Build identity and the deployment gate

API and web share one approved full 40-character Git SHA. Marketing is deployed from its independent branch and must have its own explicitly approved SHA. Never derive the expected marketing SHA from the API, a mutable branch tip, or a health response being checked.

`pnpm release:verify-checks <full-sha>` verifies the required GitHub Actions checks for a candidate. Render builds additionally run `scripts/verify-deployment-checks.mjs --render-build` against `RENDER_GIT_COMMIT` before building. A missing, pending, failed, cancelled or skipped required check blocks the build. The ruleset for `main` and `codex/deploy-marketing` requires the seven named checks with no bypass; Render's three services are configured to deploy after CI checks pass. Repository build hooks take effect only after this change reaches the deployed branch. Pushes to existing `release/**` branches run all seven required checks against that exact branch commit before promotion; pull-request merge checks alone do not approve a different commit.

The API adds a public `revision` field to `/health`. Web and marketing serve `/.well-known/careiq-release.json`, generated during each package build by `scripts/release-metadata.mjs`. The generated JSON contains only service name and full commit SHA and is ignored by Git. Direct `next build` calls must first run `pnpm release:metadata`, as the CI workflows do.

Identity comes from `RENDER_GIT_COMMIT`, `GITHUB_SHA`, or an explicit `CAREIQ_BUILD_REVISION`. All defined values must be identical full SHAs. Missing identity blocks production API startup and metadata generation. Local production fixtures must declare their source identity explicitly. The local rollback harness uses a digest-derived synthetic identity labelled as non-Git and non-deployable; it must never be copied into a hosted release manifest. The metadata is an identity assertion from the build environment; the separately enforced exact-commit check gate establishes whether that revision passed CI.

## Security checks

`.github/workflows/security-analysis.yml` supplies the required `secret-scan` and `codeql` jobs for pushes, pull requests and merge groups, plus scheduled and manual runs.

- Gitleaks 8.30.1 is downloaded from its official release and verified against a pinned SHA-256 checksum. The wrapper scans all available Git history and a snapshot of tracked plus unignored current files, including uncommitted changes. It never copies ignored local environment files. A synthetic credential fixture proves rejection remains enabled. Only rule, path and line are printed; raw findings, values and source artifacts are not uploaded.
- `.gitleaks.toml` keeps the default rules. Its narrow exceptions cover reviewed public Clerk publishable keys, fixed idempotency examples, a time-zone string, file-integrity hashes and a prose false positive. There are no blanket test, documentation, directory or commit exclusions. Exceptions must remain exact-context and rule scoped.
- Pinned official CodeQL Actions analyze production JavaScript/TypeScript, Python and workflow code with the `security-extended` suite. Reports remain local to the runner. `scripts/security-results.mjs` requires all three language reports and fails on security severity at least 4 or warning/error results. Invalid or incomplete reports also fail. Findings are not silently baselined. The report gate resolves both flat CLI rules and the query-pack rules in SARIF tool extensions emitted by the pinned CodeQL Action; missing, ambiguous or mismatched rule/component metadata fails closed.

GitHub's native secret protection and push protection complement this gate; they do not replace scanning the candidate source and history. Existing secrets, if found, require owner-led rotation even after removal from current source.

## Post-deployment verification

The new workflow is deliberately separate from deployment prerequisites: requiring a post-deployment result before deployment would deadlock the release. It supports a manual run with explicit application and marketing SHAs, and a `deployment_status` event after a provider reports a successful deployment.

Automatic event activation is pending verification of the Render-to-GitHub event integration. Read-only inspection of the repository GitHub deployments endpoint returned an empty list, and neither repository mapping variable is configured; the manual workflow is the currently available activation path once this code is merged. Before enabling it, confirm that the provider emits a GitHub `deployment_status` for the API/web release with the actual deployed commit and an unambiguous environment name. Then set repository variables `CAREIQ_DEPLOYMENT_ENVIRONMENT` to that exact environment and `CAREIQ_MARKETING_DEPLOYED_SHA` to the independently approved marketing SHA. These variables are not configured by this code change. An event for marketing alone must not be mapped as an API/web deployment. If Render does not emit these events, use the manual workflow or arrange an authenticated deployment integration; do not claim automation is active merely because the workflow exists.

The workflow polls within a ten-minute job limit. Each request has a timeout, each smoke pass has bounded retries, and every expected revision is fixed before polling starts. It checks:

- API exact revision, database connectivity, healthy status and non-cacheable responses.
- An unsigned `/api/v1/me` request is denied with the expected 401 contract.
- Web and marketing have their individually expected revision metadata.
- Public pages return HTML with security headers; web also preserves CSP, referrer protection and noindex headers.
- The web production preview route remains unavailable.

Requests send no credentials, follow no redirects, mutate no application data and do not print response bodies or cookies. These are public smoke checks, not proof that every authenticated workflow works. The pre-deployment browser/integration suite remains necessary.

For local or operator use, create a manifest with `version: 1` and `services` containing `api`, `web`, and `marketing`. Each entry requires an HTTPS origin `url` and a full expected `revision`; HTTP is accepted only for loopback fixtures. Run:

```sh
node scripts/release-smoke.mjs /path/to/approved-release.json
```

The currently hosted services cannot satisfy the new revision checks until the metadata changes are deployed. No hosted smoke pass is claimed for the unshipped patch.

## Rollback verification

Before deployment, retain the approved candidate manifest and the previous known-good manifest. Verify that the previous binaries remain compatible with the current database schema. A code rollback does not undo a database migration and this tool never restores, drops or migrates data.

The ownership repair adds `0049_managed_helper_ownership.sql` as the **50th journal entry**. A pre-repair API binary is not an established rollback target for that database. Static review confirms two incompatibilities: its migration runner rejects a ledger longer than its 49-entry manifest, and its production startup verifier rejects the new private-policy inventory. The local synthetic A-to-B-to-A smoke fixture does not exercise either condition. A compatible local fallback is now prepared and rehearsed in the [rollback guide](local-rollback.md), with its [final security and build evidence](../verification/rollback-security-remediation-2026-11-02.md). Before hosted promotion, publish an immutable approved fallback revision, satisfy its exact-commit checks, and complete the staging recovery drill. The [isolated staging and provider rollback runbook](staging-rollback.md) records the separate infrastructure, operator access and fallback-to-candidate drill procedure. Keep the strict verifier intact; do not remove policies, edit historical ledger entries or weaken verification to make an old binary start. No older hosted binary has been restarted against the repaired schema in this work.

If smoke checks fail, an authorized operator must choose and perform the provider rollback for the affected services. The tool does not initiate rollback. Then run the workflow in `rollback` mode with explicit current and previous application/marketing SHAs, or:

```sh
node scripts/release-smoke.mjs --rollback /path/to/candidate.json /path/to/previous.json
```

This verifies the prior revisions and all smoke checks on the same service origins. A passing result proves the observed services match the previous manifest; it does not prove database recovery. The included loopback regression performs an actual synthetic A-to-B-to-A server revision transition, checks that the wrong SHA fails, and validates the returned version. It is not a hosted infrastructure rollback drill. A controlled staging rollback exercise and recovery timing remain operational acceptance work.

## Current local evidence and remaining release acceptance

The [final remediation record](../verification/rollback-security-remediation-2026-11-02.md) and [machine-readable evidence](../verification/release-security-remediation.json) supersede the original 65-finding blocker. Full candidate and fallback CodeQL analyses, plus the final release-tool delta rescan, report zero findings; the unchanged gate passes. The [initial scan record](../verification/release-security-analysis.json) is retained as history, with its 65 original results intact. No rule was disabled and no finding was silently baselined.

The final candidate passes 626 application/shared tests, 245 component browser cases, three restricted-owner real-API browser cases, strict typechecking, lint and all coverage floors. Changed-code coverage is 94.84%, above 80%. The separate fallback passes its 474 API and 133 web tests, real package builds, production startup over verified TLS, strict policy/ledger rejection, restart and synthetic data preservation. Its source/output hashes and exact differences from the scanned artifact are bound in the final evidence.

These are local results. Required workflows/build hooks still need publication and successful checks on the exact real commits selected for deployment. The fallback's historical repository CI must be reconciled with the current seven required checks before promotion. Automatic provider post-deployment event wiring and a hosted staging rollback/recovery drill remain unverified. The fallback has a synthetic local fixture identity and is not an approved deployment revision. No hosted migration, rollout, rollback or recovery-time claim is made.
