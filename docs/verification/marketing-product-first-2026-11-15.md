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

## Release claims review

The English and Spanish [homepage copy](../../apps/marketing/src/content/product-content.ts) and [research copy](../../apps/marketing/src/content/site-content.json) were checked against the [design reference](https://app.notion.com/p/419e9784880681919e7ed25b0f6abbb3), current implementation, and the limitations below. This is a release-specific claims register; it does not establish interview-backed positioning, measured customer benefits, or completion of the broader research plan.

| Published scope | Evidence | Boundary retained in the copy |
| --- | --- | --- |
| Appointments, availability, patient information, and visit readiness | [Workflow implementation](../workflow-implementation.md), [staff workspace](../../apps/web/src/components/workflow/WorkflowWorkspace.tsx), and [workflow service](../../apps/api/src/services/workflow.service.ts) | Current development/demo workflows; no production-readiness or external-calendar integration claim. |
| Forms, requests, signatures, and document review | [Forms Studio and paperwork guide](../forms-studio-implementation.md) | Demonstration with synthetic data; no live-delivery, independent identity assurance, or universal legal-signature claim. |
| Manual insurance observations and assigned follow-up | [Insurance implementation](../manager-insurance-implementation.md) and [insurance service](../../apps/api/src/services/insurance.service.ts) | Automated insurance verification and planned integrations are explicitly unavailable. No coverage guarantee or connected-payer claim. |
| Shared work, staff activity, access, and protected activity review | [Team activity guide](../manager-team-activity.md), [practice access](../practice-access-implementation.md), and [protected audit service](../../apps/api/src/services/protected-audit.service.ts) | Access depends on appropriate permissions. No security certification, compliance guarantee, or completed hosted acceptance is claimed. |
| A clearer view of practice work and better-coordinated days | Product design intent in the supplied reference | Aspirational wording without quantified savings, customer outcomes, testimonials, or clinical/diagnostic claims. The dashboard practice, patients, and records are explicitly fictional. |
| Research conversation request | Existing [interview form](../../apps/marketing/src/components/InterviewForm.tsx), [submission contract](../../apps/marketing/src/lib/submission.ts), and [marketing operations guide](../marketing.md) | Business-contact fields only, with a patient-information warning and privacy link. Hosted intake remains unavailable pending its separate operating/configuration and submission/retry/deletion acceptance; no automatic booking, email notification, or newsletter subscription is promised. |

## Verification

- Marketing lint, TypeScript, all 10 tests (no skips), formatting, and repository hygiene pass.
- The standard filtered production build passes with Next 16.4.1 and Node 22.23.4. The final local static export embeds exact release commit `068d5cdabf93cbde0b994610fb959e7044ccf505` in `/.well-known/careiq-release.json`.
- Marketing coverage passes its required thresholds: 77.30% lines/statements, 77.64% branches, 67.39% functions. Changed executable-line coverage against the reviewed base is 634/709 (89.42%), above 80%.
- Browser review covered homepage/research at 1440×1000 and 390×844, narrow 320px English/Spanish, and the 1000px header. No horizontal document overflow was observed. Fonts and local wordmark loaded correctly.
- Verified English/Spanish switching, persisted language after navigation/reload, localized page title/description, research canonical URL, legacy `/#interview-form` forwarding, CTA navigation, mobile menu and Escape focus return, keyboard FAQ expansion, privacy navigation, unavailable-form state, and custom 404 metadata. No browser console errors were observed.
- Review fixed narrow header wrapping, a Spanish typo, the research eyebrow alignment, unknown-route metadata matching, and Next’s late static metadata overwriting the selected language.
- Screenshots: [home desktop](marketing-product-first-2026-11-15/home-desktop.jpg), [home mobile](marketing-product-first-2026-11-15/home-mobile.jpg), [research desktop](marketing-product-first-2026-11-15/research-desktop.jpg), [research mobile](marketing-product-first-2026-11-15/research-mobile.jpg).

## Verified deployment

- Implemented and deployed commit: [`068d5cdabf93cbde0b994610fb959e7044ccf505`](https://github.com/kriscodes/careiq/commit/068d5cdabf93cbde0b994610fb959e7044ccf505), `feat: redesign product-first marketing website`.
- The marketing service now tracks `release/marketing-product-first-2026-11-15`. Auto-deploy remains enabled after CI checks pass. Build command, publish directory, domains, redirects, headers, and environment settings were retained.
- All seven required GitHub Actions checks passed on that exact SHA: `verify`, `quality`, `dependency-audit`, `managed-owner`, `release-gate`, `codeql`, and `secret-scan`. The repository deployment-check verifier also passed. CI covered the broader repository browser workflows, isolated migration replay, coverage, and builds.
- Saving the branch triggered deploy `dep-dbt1hsu7bikc73cpc8hg`, which correctly stopped at the deployment guard while CI was pending. Once checks passed, Render automatically deployed the same commit successfully; no gate was bypassed and no manual retry was needed.
- Successful [Render deployment](https://dashboard.render.com/static/srv-db096cdg1s2s73d3gng0/deploys/dep-dbt1j66417fc73839j80): `dep-dbt1j66417fc73839j80`, live at **2026-11-15 12:44:41 PST / 20:44:41 UTC**.
- [Live release metadata](https://careiqlabs.com/.well-known/careiq-release.json) reports the exact implementation SHA above.
- Public HTTP checks passed for `/`, `/research`, `/research/`, `/privacy`, `/privacy/`, the release manifest, robots, sitemap, wordmark, and both local font assets. Unknown routes return 404. HTTP and `www` requests redirect to the HTTPS apex. Page titles/canonicals are correct; noindex, robots disallow, and the gated empty sitemap remain as configured. Existing `nosniff` and referrer-policy headers are present; no additional header policy is claimed.
- Live browser review at 1440×1000 and 390×844 covered both pages, English/Spanish switching and persistence, localized metadata after reload, and legacy interview-link forwarding. No horizontal document overflow or browser console errors were observed. No production form submission was made.
- `careiq-web` and `careiq-api` remain on `main`; both staging services remain on `release/migration-50-fallback-2026-11-03`. Their service update timestamps predate this marketing release.
- Machine-readable [CI and HTTP evidence](marketing-product-first-2026-11-15/live-verification.json); live screenshots: [homepage desktop](marketing-product-first-2026-11-15/live-home-desktop.jpg), [homepage mobile](marketing-product-first-2026-11-15/live-home-mobile.jpg), [research desktop](marketing-product-first-2026-11-15/live-research-desktop.jpg), [research mobile](marketing-product-first-2026-11-15/live-research-mobile.jpg), and [marketing branch setting](marketing-product-first-2026-11-15/render-marketing-branch.jpg).

The follow-up documentation-only commit uses `[skip render]`, preserving the verified implementation deployment while publishing its evidence. [Render documents this skip phrase](https://render.com/docs/deploys#skipping-an-auto-deploy).

## Deployment boundary and existing acceptance work

Target only `careiq-marketing` (`srv-db096cdg1s2s73d3gng0`) in the Care IQ Labs workspace (`tea-d38er5juibrs739omsmg`). Keep its static build command, publish directory, domains, response headers, and public configuration. Retain deployment checks. The web/API and staging service branches and configuration are outside this release.

The public site inspected before changes returned `noindex, nofollow` and explicitly displayed “Interview requests are temporarily unavailable.” This redesign preserves that availability policy. Passing client form tests is not proof of hosted submission persistence, retries, or operator deletion. Those existing API/operational acceptance steps remain separate; no contact details or patient information are submitted to production during this work.

## Tracking reconciliation

Updated and read back the existing Notion records on November 15, 2026:

- [Product-first design](https://app.notion.com/p/419e9784880681919e7ed25b0f6abbb3): preserved the reference attachment and design direction, replaced the outdated not-deployed statement, and recorded the verified release, evidence, and remaining limits.
- [M-T17 — Website brief and primary CTA](https://www.notion.so/3eee97848806819cb8dedc0ec0309f7c): **Done** for the documented audience, purpose, sections, actions, qualitative success measure, and non-patient intake scope.
- [M-T18 — Landing-page copy and contact flow review](https://www.notion.so/3eee9784880681afa1c9ee30554a8532): **Done** for prepared and reviewed bilingual copy, this release claims register, and identified contact/privacy operating dependencies. This does not close separate research-validation tasks or hosted submission acceptance.
- [M-F6 — Website and conversion path](https://www.notion.so/3eee97848806819d8e02edb6622b8d33): **In progress**; site implementation/deployment is verified, but hosted interview intake and its operating acceptance remain outstanding.
- [SW-T72 — Controlled deployment and migration promotion](https://www.notion.so/3eee978488068177bf1ce584868b1b30): appended marketing-only evidence; retained **In progress / Blocked** and the exact existing blocker text for broader app/API acceptance.

No duplicate tracking records were created. This release does not claim completion of clinical, production, privacy-operations, app/API promotion, or customer-validation acceptance.
