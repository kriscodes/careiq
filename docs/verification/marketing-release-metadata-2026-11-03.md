# Marketing release identity without a product rollout

## Scope and ancestry

The published marketing baseline is `a07c700c3a9d96c5f8bcb44e12eab34fb149dce8`. This release preserves its application source, English copy, CSS, assets and Next configuration. Formatting and lint fixes are the only changes within that runtime source. The package build now uses the existing exact-commit GitHub check guard and generates `/.well-known/careiq-release.json` with the marketing service name and full build revision.

The publication is a two-parent reconciliation: the deployed marketing baseline is its first parent, and checked application candidate `9e17441ee219f3ccb515a8ea7fe1f785f8cc6a51` is its second parent. Everything outside marketing and this linked verification record is retained from that checked candidate. This supplies the current seven CI checks, dependency fixes and release tooling without inventing a separate, weaker marketing pipeline. Only marketing is selected by the independent production service branch; this publication does not promote the API or web application.

The review branch `release/marketing-metadata-2026-11-03` was created at `9e17441ee219f3ccb515a8ea7fe1f785f8cc6a51` before the publication push. That SHA is the push event's explicit changed-code coverage base: previously checked application code is unchanged, and the remaining marketing reconciliation is measured against it. Both histories remain in the resulting commit, so the eventual marketing promotion can fast-forward from its deployed baseline. No required check, coverage floor, security rule or branch protection is relaxed.

The newer candidate's unshipped marketing localization and shell changes are intentionally absent. Existing public indexing, privacy contact, application link and interview submission behavior remain configuration controlled. This release does not enable any of them or alter production environment settings.

## Local verification

- All 19 baseline files across `apps/marketing/src/` and `apps/marketing/next.config.ts` were compared with the deployed Git source. JavaScript/TypeScript/TSX and CSS produce identical normalized esbuild output with the automatic JSX transform; JSON values and SVG source are unchanged. No runtime differences were found.
- Marketing lint and TypeScript checks pass. Eleven tests cover existing copy, rendering, configuration validation, safe form failure/retry behavior, hydration, navigation, missing-page recovery, indexing defaults and configured privacy contact.
- Marketing all-source coverage passes unchanged floors: lines/statements 86.92%, functions 75.60%, branches 79.48%.
- A scoped changed-code preflight using the repository's unchanged diff/LCOV evaluator covers 50 of 58 executable changed lines (86.21%) against the checked second parent. The hosted quality job must still generate and validate fresh full-workspace coverage provenance and pass the complete changed-code check.

## Promotion requirements

Build the committed revision through the package's normal build command, verify the exported release metadata matches that full SHA, and require all seven hosted checks on that exact revision. Keep `codex/deploy-marketing` unchanged until the isolated staging rollback drill passes. Then promote through the established protected-branch process, preserve existing service configuration, and run the release smoke checks with this independently approved marketing revision plus the separately approved API/web revision.

Local checks do not establish that a hosted deployment or rollback has happened. Record hosted results separately when completed.
