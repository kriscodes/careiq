# Dependency hardening — October 18, 2026

The two HIGH findings remain release blockers. Both public upstream registries still publish node-forge 1.4.0 and braces 3.0.3 as latest; node-forge 1.4.1 and braces 3.0.4 do not exist. Current GitHub-reviewed advisory pages identify no published patched release. npm audit advertises those version thresholds, which must not be mistaken for available packages. No audit exceptions, renamed libraries or fabricated versions were added.

| Check | Final result |
| --- | --- |
| Frozen install, Node 22.23.2 / pnpm 11.22.0 | Pass; all seven workspaces, verified contextful patch |
| Production raw audit | Exit 1: two HIGH, zero critical/moderate/low |
| Complete raw audit, including development dependencies | Exit 1: two HIGH, zero critical/moderate/low |
| Security regressions | 22 passed; zero failed/skipped/cancelled |
| Original registry tarball integrity and exact patch reconstruction | Pass for both HIGH packages |
| Bounded original/patched controls | Original forge accepts the malformed nested algorithm; original braces walkers exhaust the stack. Reviewed patched copies reject those exact vectors. |
| Legacy Drizzle TypeScript transforms/source maps | Sync/async pass |
| Fixed esbuild real loopback server | Foreign origins receive no permissive CORS header; foreign Host receives 403 |
| Drizzle migration metadata check | Pass with an explicit synthetic loopback port 1 URL; no database connection |

The braces backport now validates AST depth, node count and queued width at all three walker entry points. This closes a direct `braces/lib/compile`, `expand` or `stringify` import bypass of the earlier root-only guard. Existing parsed-string depth bounds remain. Actual micromatch and Expo signing callers resolve the reviewed package copies. Registry tarballs match their published SHA-512 integrity values, and applying the exact reviewed patches reproduces every declared file hash. This proves content integrity for these artifacts, not independent publisher identity or a guarantee against all vulnerabilities.

The broader audit also found a development-only moderate esbuild issue under Drizzle's legacy loader. A parent-scoped override replaces only `@esbuild-kit/core-utils@3.3.2`'s esbuild 0.18.20 edge with genuine published 0.25.12. Other esbuild/tsx edges and the global qs 6.16.0 pin remain. The complete audit's moderate count is now zero. The loader's used transformation APIs and Drizzle's check command pass compatibility checks; future loader changes must re-review this cross-minor override.

The HIGH package paths in the production workspace graph lead to mobile Expo/Metro tooling. No API/web/marketing production workspace path to these two packages was found. This is bounded dependency-graph evidence: it does not certify arbitrary bundled copies or justify ignoring the workspace release gate. Replacing/removing Expo's signer and Metro's matcher would be a separate SDK fork with substantial compatibility risk, so no such unreviewed replacement was introduced.

A formatting-only zero-context patch attempt was caught by the installed security tests because pnpm misplaced its insertions. It was reverted to the standard contextful format and all 22 cases rerun successfully. Standard unified-diff blank context markers create whitespace warnings in the patch artifact itself; no application-code whitespace checks are relaxed.

The release audit remains nonzero. A stable release still requires genuine reviewed upstream fixes or a separately authorized, rigorously tested upstream replacement. These local backports reduce the verified vectors but do not convert that gate into a pass. No commit, push, deployment or hosted database change was made.

Evidence: [raw audit summaries and registry metadata](dependencies-audit.json), [exact patch/negative controls](dependencies-controls.json), [tests, final artifact hashes and commit bullets](dependencies-tests.json). Raw outputs and upstream tarballs remain private ignored local review files.

Sources checked: [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99), [esbuild maintainer release](https://github.com/evanw/esbuild/releases/tag/v0.25.0), [node-forge registry](https://registry.npmjs.org/node-forge), [braces registry](https://registry.npmjs.org/braces), [exact esbuild registry release](https://registry.npmjs.org/esbuild/0.25.12).
