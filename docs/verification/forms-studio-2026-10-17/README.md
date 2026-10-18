# Forms Studio local implementation verification

Verified October 17, 2026 in the canonical CareIQ checkout. These results cover local implementation and synthetic acceptance. They do not activate a hosted release or establish live-provider, device, certificate or legal acceptance.

## Results

| Check | Result |
| --- | --- |
| Complete API suite against isolated PostgreSQL | **193 passed; 0 failed; 0 skipped** |
| Web unit suite | **73 passed** |
| Shared language catalog checks | **5 passed** |
| Complete Chrome browser suite | **48 passed** |
| Final localized field-count/screenshot check | **1 passed**, overlapping the browser suite scenario |
| API and web TypeScript | Passed |
| Frontend ESLint | 0 errors and 0 warnings; generated temporary build output excluded |
| Next.js optimized production build | Passed with synthetic live-shaped Clerk keys and an invalid test API origin; compilation evidence only |
| Fresh migration replay | **33 migrations**, repeated with unchanged ledger/checksums |
| Restricted runtime database release checks | Passed, including forced RLS, immutable facts, audit capture, protected helper-only publication and private eligibility clock |
| Whitespace/error checks | Passed |

The browser suite uses the actual React components with mock identity/API fixtures and synthetic records. Separate database tests exercise actual PostgreSQL persistence, scoped grants, denied writes, immutable versions, current signer eligibility, safe retries and exact PDF byte access. The focused birthday tests cover UTC/local date boundaries, the location's eighteenth birthday, the upper age limit and leap-day rules. No runtime caller can select the eligibility evaluation time.

The production build used a separate `.next-forms-build` directory. Its two temporary TypeScript include additions were removed afterward. Provider credentials were not changed; the build is not evidence of live identity-provider configuration.

## Review artifacts

- [API test summary](api-tests.json)
- [Fresh/repeated migration and restricted-runtime report](migration-replay.json)
- [Desktop builder](forms-studio-desktop.png)
- [Open dropdown styling](forms-studio-open-dropdown.png)
- [Patient desktop preview](patient-preview-desktop.png)
- [Patient mobile preview](patient-preview-mobile.png)
- [Implementation, routes and activation boundaries](../../forms-studio-implementation.md)
- [API contract](../../api/workflow.openapi.json)

All screenshots were regenerated after the final copy change and visually reviewed. White surfaces, blue accents, opaque padded dropdown panels, selected checkmarks and narrow patient layouts are verified. The labels identify synthetic component tests; screenshots contain no live patient data.

## Database and release scope

New migrations `0027` through `0032` were applied only to the owned local review and test databases on loopback port 55434. Fresh replay used a separate task-created empty database, verified the restricted runtime, then removed only that disposable database. The existing review/test database identities were preserved. Applied migration history remains checksum-locked; repairs use additive forward migrations.

The completed local subset includes guided form authoring, immutable publication/submissions and generated PDFs, one adult-self patient signer, reviewed demographic candidates, verified-account paperwork access, staff grant management and completion-notification intent/follow-up.

PDF overlay authoring, proxy/minor/provider/witness or multiple-signer policies, independent identity/certificate assurance, actual email delivery and reconciliation workers, trusted scanning, external immutable storage/retention and hosted/native-device acceptance remain separate work. The local notification state truthfully reports an unavailable provider; no real patient message was sent.

No commit, push, deployment, hosted migration or live identity-provider permission change was performed. Existing unrelated checkout changes were retained.
