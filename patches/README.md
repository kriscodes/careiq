# Reviewed dependency backports — October 6, 2026

The workspace preserves published package versions and uses pnpm patches. No advisory is ignored, renamed or hidden. `pnpm security:audit` still fails on the two high findings for node-forge 1.4.0 and braces 3.0.3. These backports reduce the identified exposure; they do not satisfy the existing requirement for a passing raw audit.

| Dependency | Change and evidence |
| --- | --- |
| node-forge 1.4.0 | Backports the RSA DigestInfo nested algorithm child-count and nonempty NULL checks from [maintainer PR1152](https://github.com/digitalbazaar/forge/pull/1152/commits/ceba34402e329f0365134f23fe19898756527d65) and [PR1157](https://github.com/digitalbazaar/forge/pull/1157/commits/683ab3344899cc08a581e4d5675a33e87aff7b04). Only `lib/rsa.js` is patched. Expo CLI/code-signing Node consumers load `lib/index.js`; bundled browser `dist` files are not rebuilt or claimed fixed. |
| braces 3.0.3 | Bounds brace/parenthesis parser nesting before recursive walkers, and validates direct caller AST depth, total nodes and queued width iteratively before compile/expand/stringify. This follows the [maintainer issue70 depth-bound recommendation](https://github.com/micromatch/braces/issues/70). |
| query-string 7.1.3 | Adapts its CommonJS import to the ESM default of published decode-uri-component 0.5.0. Scoped only to that parent dependency. |

Scoped published overrides also select uuid 11.1.1 for xcode 3.0.1 (its v4 caller remains compatible), and sharp 0.35.5 for the affected 0.35.x range. Node 22.23.2 supplies supported ESM require behavior. The Expo SDK57 patch alignment records exact version exceptions to the strict minimum-release-age policy; future versions still require review.

`security-manifest.json` records patch SHA-256, installed post-image hashes and source commits. `pnpm security:regressions` checks those exact artifacts and 16 exploit/compatibility cases: RSA malformed/normal/BER/PSS signatures; brace nesting, cycles and width; ordinary globs/literals; valid and malformed URI decoding; CommonJS interop; xcode project IDs; and image decoding/resizing. The malformed URI test runs in a bounded child process.

Install with the pinned Node/pnpm and `pnpm install --frozen-lockfile`. An altered patch or installed file fails the integrity check. Remove a backport only after a published reviewed replacement fixes the relevant advisory, its actual caller compatibility passes, the lockfile is refreshed and the raw audit passes. Do not fabricate the not-yet-published node-forge 1.4.1 or braces 3.0.4 versions.

See [production readiness](../docs/production-readiness.md). No package was published and no remote workflow was run by this local change.

The October 16 Next.js update is documented in [security version notes](../docs/security/next-october-2026.md). Existing backports remain unchanged.

The subsequent SDK57 patch alignment and Doctor results are recorded in [Expo patch verification](../docs/security/expo-sdk57-patches-2026-10-16.md); supply-chain policy and these backports remain unchanged.
