# Product-first marketing release — November 15, 2026

## Scope and source

- Canonical checkout: `/Users/kristian/Documents/Server/CareIQ`.
- Branch: `release/marketing-product-first-2026-11-15`.
- Starting point: `3838978ff2295b9a1fe83d4d2bb766f0b6b7a37a`, already present on the matching origin release branch. This retains the newer marketing English/Spanish support and exact-commit deployment checks. No clone, fetch, or pull was used.
- The existing marketing service previously used `codex/deploy-marketing`, live commit `a07c700c3a9d96c5f8bcb44e12eab34fb149dce8` (deploy `dep-dbg1hn0473hc73f9hcv0`). The prepared November 3 marketing metadata branch had not been deployed and lacked the current bilingual marketing changes.
- The pre-existing uncommitted `apps/marketing/next-env.d.ts` change is preserved and excluded from release commits. No app/API implementation, database, auth/onboarding, dependency, or credential changes are part of this release.
- Reference: [Notion product-first design](https://app.notion.com/p/419e9784880681919e7ed25b0f6abbb3); its embedded HTML was read as the content and visual reference.

## Implemented behavior

The homepage explains the product and its synthetic-data demonstration scope, with seven feature areas, a fictional dashboard, the visit workflow, and specific value for doctors, nurses, medical assistants, front-desk staff, managers, and owners. Insurance follow-up is explicitly manual; integrations, automated insurance verification, and production readiness are not claimed.

Research, the founder story, FAQ, and the existing interview request form move to `/research/`. Old homepage research/interview hash links forward to the new route. The privacy page, configuration-driven app/contact/LinkedIn links, English/Spanish language preference, form contract, validation, retry keys, and error handling are retained. Navigation, canonical URLs, page metadata, and the gated sitemap include the new page.

The lowercase wordmark, Caprasimo, Nunito Sans, white background, and Signal blue match the supplied design and the existing product brand. Local font files include their OFL licenses.

## Verification

- Marketing lint, TypeScript, all 10 tests (no skips), formatting, and repository hygiene pass.
- The standard filtered production build passes with Next 16.4.1 and Node 22.23.4. Local build metadata used the base SHA for the uncommitted preview; Render will embed the exact release commit.
- Marketing coverage passes its required thresholds: 77.30% lines/statements, 77.64% branches, 67.39% functions. Changed executable-line coverage against the reviewed base is 634/709 (89.42%), above 80%.
- Browser review covered homepage/research at 1440×1000 and 390×844, narrow 320px English/Spanish, and the 1000px header. No horizontal document overflow was observed. Fonts and local wordmark loaded correctly.
- Verified English/Spanish switching, persisted language after navigation/reload, localized page title/description, research canonical URL, legacy `/#interview-form` forwarding, CTA navigation, mobile menu and Escape focus return, keyboard FAQ expansion, privacy navigation, unavailable-form state, and custom 404 metadata. No browser console errors were observed.
- Review fixed narrow header wrapping, a Spanish typo, the research eyebrow alignment, unknown-route metadata matching, and Next’s late static metadata overwriting the selected language.
- Screenshots: [home desktop](marketing-product-first-2026-11-15/home-desktop.jpg), [home mobile](marketing-product-first-2026-11-15/home-mobile.jpg), [research desktop](marketing-product-first-2026-11-15/research-desktop.jpg), [research mobile](marketing-product-first-2026-11-15/research-mobile.jpg).

Deployment verification will be appended after the exact release commit passes GitHub checks and becomes live.

## Deployment boundary and existing acceptance work

Target only `careiq-marketing` (`srv-db096cdg1s2s73d3gng0`) in the Care IQ Labs workspace (`tea-d38er5juibrs739omsmg`). Keep its static build command, publish directory, domains, response headers, and public configuration. Retain deployment checks. The web/API and staging service branches and configuration are outside this release.

The public site inspected before changes returned `noindex, nofollow` and explicitly displayed “Interview requests are temporarily unavailable.” This redesign preserves that availability policy. Passing client form tests is not proof of hosted submission persistence, retries, or operator deletion. Those existing API/operational acceptance steps remain separate; no contact details or patient information are submitted to production during this work.
