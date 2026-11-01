# Main security review and patch record — October 26, 2026

**Status: security fixes merged and deployed; hosted acceptance passed.**

Reviewed `kriscodes/careiq` main at `1c99f186e5d5129bb6c2562036af42eec12dd153` (October 21 merge). Review date is October 26, 2026, America/Los_Angeles. The reviewed snapshot was isolated from existing work. The final patch is applied to the canonical checkout at `/Users/kristian/Documents/Server/CareIQ`, preserving unrelated local changes. The canonical checkout also has a local staff-role helper absent from audited main; that helper is preserved, and only the runtime-guard hunk is changed there.

Notion report: [Main security review & patches](https://app.notion.com/p/406e9784880681d8aa6ec3df758c54b6?pvs=204).

## Findings and disposition

| Finding | Priority / scope | Evidence on audited main | Fix |
| --- | --- | --- | --- |
| Unpatched Node runtime | Urgent; upstream HIGH, possible remote code execution | `.nvmrc` and `.node-version` pin 22.23.2; CI and marketing Blueprint repeat it. API parsers accept compressed bodies. | Pin 22.23.4, require `>=22.23.4 <23`, enforce `engineStrict` in pnpm workspace settings, update local runtime guard, and reject compressed API requests. |
| Compressed-body process crash, CVE-2026-111181 | HIGH; production API dependency | Locked body-parser 2.3.0 through Express, including Clerk's Express path. | Scoped override and lock update to body-parser 2.4.0; `inflate:false` on every production JSON/raw parser. |
| Audit evidence authorization bypass | High-priority application authorization flaw; authenticated, assigned location | `protected-audit.ts:23` checked only body boolean `true`; `parseAuditFilter` also accepted string `"true"`. Export generation used the normalized filter. Downloads checked export permission without checking current evidence permission. | Parse once, authorize that filter, reuse it for idempotency and generation, and check current evidence permission against the saved manifest at each download. Malformed evidence metadata fails closed. |
| Zod collection memory exhaustion, CVE-2023-54404 | HIGH advisory; development lint dependency only | Locked Zod 4.5.4 through Next ESLint / React Hooks tooling. No application request path was identified. | Scoped override and lock update to Zod 4.6.6. |

The [October 21 Node release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) fixes Brotli decoder memory corruption, CVE-2026-111497. Node 22.23.4 is the patched 22.x release. The [release notes](https://nodejs.org/en/blog/release/v22.23.4) also include DNS, TLS, HTTP, crypto and dependency security fixes. This is a runtime update; dependency audit alone cannot detect or fix it.

The audit authorization flaw requires an active location assignment and `org:audit:export` while lacking `org:audit:evidence:read`. Protected database evidence includes record identifiers, schedule/status changes and internal database roles. The reviewed path did not demonstrate unauthenticated access, cross-tenant access or arbitrary patient-content dumping. Existing project records state the optional hosted audit reader is disabled; its current activation state was not independently measured in this review.

The [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828) describes a process crash after a valid compressed frame with trailing bytes. The API now returns HTTP 415 before decoding encoded requests. Ordinary JSON and exact signed callback bytes remain supported. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Additional credential action

The existing Notion **CareIQ Labs / Security** page contains a Google OAuth client secret. Its value is intentionally excluded from this repository and this report. Rotation is a precautionary recommendation because the secret was stored in ordinary documentation. This does not establish disclosure or misuse; access/history was not investigated. If rotating, update the provider and Clerk securely, verify Google sign-in, revoke the old secret, and remove or restrict the documentation copy/history. No credential rotation or provider configuration change was performed by this patch. This is separate from the main source findings.

## Components already patched / PHP scope

Main already contains Next 16.4.1 and Sharp 0.35.5, the security baselines in the [October 14 Next bulletin](https://nextjs.org/blog/nextjs-security-update-october-14-2026). No further Next/React version change was justified by the reviewed advisories. Root React version alone is not a valid match for advisories naming `react-server-dom-*` packages.

No PHP files, Composer manifests or PHP runtime deployment declarations were found in the tracked main tree. The [October PHP advisory](https://www.php.net/archive/2026.php#2026-10-21-5) therefore has no identified repository target. This does not inventory unrelated hosts, tools or other repositories.

## Verification

All checks used Node 22.23.4 and pnpm 11.22.0. The Node macOS ARM64 archive SHA-256 matched the official release value `c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428`.

- Full dependency audit: **2 HIGH before; 0 vulnerabilities after**, including development dependencies. Raw results: [before](audit-main.json), [after](audit-patched.json).
- Frozen offline installation passes on 22.23.4. An install attempt on 22.23.2 is explicitly rejected with `ERR_PNPM_UNSUPPORTED_ENGINE`.
- **425 unit/database tests passed, zero skipped:** API 318, web 90, marketing 9, shared interview contract 3, translations 5.
- **16 dependency security regressions and 2 Python runtime tests passed.** Runtime checks reject unpatched 22.x, unsupported major versions and prereleases.
- Workspace lint, TypeScript checks and production builds passed.
- Fresh migration replay and unchanged repeat both verified **43 entries** in a task-owned PostgreSQL 18.6 database bound to loopback. No hosted database or patient records were used.
- New HTTP regressions cover both evidence flag encodings, permission revocation, 30 compressed requests across ten endpoint families, no business callbacks, continued health, ordinary JSON and exact webhook bytes. Service/database tests exercise actual retained evidence files and malformed manifests.
- **77 browser regressions and 3 real API/restricted-database browser scenarios passed**, using installed Chrome. Initial attempts could not launch because the bundled Playwright browser was absent; all scenarios passed after selecting the installed browser.
- Canonical checkout recheck passed 12 targeted API/database tests, 16 dependency regressions and 11 Python local-runner tests (including the 2 new runtime tests). Existing local staff-role helper code and its tests were preserved.
- Independent review of the final code changes found no additional actionable issue. The task-owned synthetic database and temporary database credentials were removed after verification.

## Rollout and remaining acceptance

1. Review and merge the security patch through the normal release process. These changes do not require a database migration.
2. Install/select Node 22.23.4 for local development (`nvm install` and `nvm use` in the repo). The old shell/default runtime was not replaced by this task.
3. Set or confirm `NODE_VERSION=22.23.4` for each hosted Node build/runtime. Explicit provider environment overrides can supersede repository version files. Rebuild/redeploy API and web, and rebuild the marketing static site. Restart any other affected Node processes.
4. Verify the running runtime and release commit, health, ordinary JSON, compressed-request rejection, Google sign-in, and protected export permissions. Confirm signed provider callbacks still succeed with their normal uncompressed bytes.
5. Complete the OAuth secret rotation above. Keep synthetic/demo-only and existing real-PHI gates in force.

Main and marketing releases are merged and live with verified Node 22.23.4 selection and hosted acceptance; see [deployment evidence](deployment.md). Credential rotation was not performed. The review covered tracked application code, declared runtimes and the active locked workspace graph, with focused checks of authentication, permissions, tenant isolation, SQL, file storage, signing, portal sessions and callbacks. It is a scoped security review, not proof that no other vulnerabilities exist.


## Completed release

API/web: `6274a40`; marketing: `a07c700`. Both releases passed CI, deployed successfully and passed hosted acceptance. Full details and remaining provider/credential boundaries are in [deployment evidence](deployment.md) and the Notion report. Existing local authentication changes and unrelated documents remain preserved.
