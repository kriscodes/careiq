# Marketing security verification — October 26, 2026

The marketing deployment branch at `d0748b5` retained an older dependency graph. This patch updates the static website's framework and build dependencies without changing website content, layout, forms, API code or authenticated application code.

## Changes

- Pin Node.js 22.23.4 in the repository, CI and marketing Blueprint. Require `>=22.23.4 <23` and enable pnpm engine enforcement.
- Update marketing and web Next.js and eslint-config-next from 16.3.6 to 16.4.1.
- Select patched Sharp 0.35.5, Zod 4.6.6, source-map-js 1.2.2 and brace-expansion 1.1.21/5.0.12 through version-scoped overrides. The shared workspace also selects body-parser 2.4.0, proxy-addr 2.0.8 and esbuild 0.25.12 for Drizzle's legacy loader.
- Preserve React 19.2.8, static-export configuration and existing deployment build commands.

## Local verification

Verification used Node.js 22.23.4 and pnpm 11.22.0.

- Frozen dependency installation passed.
- All eight existing marketing tests passed.
- Full workspace lint passed, including marketing, web, API and the shared interview contract.
- Full workspace TypeScript checks passed.
- The production static export built with Next.js 16.4.1 using `next build --webpack`, including framework TypeScript validation. The generated routes include the homepage, privacy notice, custom not-found page, robots and sitemap.
- The default Turbopack build could not complete locally because its CSS worker was denied permission to bind a local port. The deployment keeps the normal `next build` command; its hosted build must be verified separately.
- The API TypeScript build passed.
- The web production build also passed using webpack and synthetic public configuration.
- The complete workspace security audit passed with **zero vulnerabilities**, including development dependencies. [Raw audit result](marketing-security-2026-10-26-audit.json). No advisories are ignored.

This older deployment branch also contains API and authenticated-web manifests. Their dependency versions are patched to keep the existing full-workspace CI and audit checks passing. The marketing deployment filter continues to build only the static site and shared interview contract. No API or authenticated-web application source is changed or deployed through this marketing release.

Hosted deployment, Node selection and static website acceptance remain release checks. No database migration is required.
