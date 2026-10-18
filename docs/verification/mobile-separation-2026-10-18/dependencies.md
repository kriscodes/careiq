# Dependency separation — October 18, 2026

Mobile is outside the active CareIQ workspace, preserved in the SHA-verified sibling handoff for a future repository. The canonical workspace explicitly includes API, web, marketing and shared packages. Its frozen install covers six projects and removed 520 installed packages.

| Independent check | Before separation | After separation |
| --- | --- | --- |
| Raw production audit | Exit 1: two HIGH | **Exit 0: zero findings at every severity** |
| Raw complete audit, including development dependencies | Exit 1: two HIGH | Exit 1: **one HIGH**, development-only braces |
| Retained security regressions | Original suite preserved in handoff | 16 passed, zero failed/skipped/cancelled |
| Drizzle migration metadata check | Passed during hardening | Pass with a synthetic loopback port 1 URL; no database connection |
| Frozen install | Original mobile graph | Pass, six workspaces, 520 installed packages removed |

This is real graph removal rather than an audit exception. Original dependency policy, root lock, exact patches and the complete 22-case security suite were verified against the handoff before pruning. Forge, query-string/decoder, xcode/uuid, Expo/RN/Metro packages and mobile-only policy exceptions are absent from the active package graph. The shared packages remain for API/web use. No existing application dependency version changed and no new package identity was added by the separation.

One HIGH remains in the full development graph: web and marketing's standard `eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces` path. The reviewed braces backport stays active, with all three direct AST walker entry points guarded and exact installed file hashes checked. Production audit excludes that development-only graph and genuinely passes; the full audit remains visibly failing. Neither result is converted or suppressed. Current official stable and canary Next lint packages still depend on fast-glob, so no compatible official upgrade removes that path. Standard Next lint protections were retained.

The active suite removes only controls for the separated mobile graph; the original forge, URI decoder, xcode and Expo signer cases remain with its source. The 16 retained cases cover braces integrity/exploits/compatibility and actual Next matcher resolution, sharp decoding/resizing, Drizzle's genuine scoped esbuild fix, synchronous/asynchronous TypeScript/source maps, real loopback CORS/Host checks, and a lockfile boundary against mobile reintroduction. Nothing is silently skipped.

The stale nested web workspace and lock had Next 16.3.3 and lacked current root security controls. Their unchanged originals are recoverable from the starting Git commit; see the separate removal receipt. Running `pnpm root -w` from `apps/web` now resolves the canonical root node_modules. Existing app versions, including Next 16.4.1, are unchanged.

The qs, brace-expansion, sharp and legacy Drizzle esbuild pins remain; strict minimum release age remains enabled. Historical security records are retained and the patches guide clearly identifies its pre-separation history. No commit, push, remote repository or deployment was created by this dependency work.

The production raw audit establishes the active lock graph result, not a guarantee about all vendored source, a hosted image, or a future mobile release. Mobile's own two-HIGH acceptance remains pending in the preserved handoff. Provider, device and operational production acceptance require their separate evidence.

Evidence: [before audit and reachability](dependencies-before.json), [after audit and reachability](dependencies-after.json), [package delta and workspace policy checks](dependencies-delta.json), [retained security tests](dependencies-tests.json), [source handoff](source-handoff.json), [stale nested workspace removal](shadow-workspace-removal.json).

Primary package metadata checked for retained lint dependencies: [Next lint plugin](https://registry.npmjs.org/@next%2feslint-plugin-next), [official Next plugin source](https://github.com/vercel/next.js/blob/canary/packages/eslint-plugin-next/package.json), [fast-glob](https://registry.npmjs.org/fast-glob), [micromatch](https://registry.npmjs.org/micromatch), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
