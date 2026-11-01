# Today and Appointments — October 31, 2026

The approved page distinction is implemented locally in the canonical CareIQ checkout. Today is the operational queue for the current location-local day; Appointments is the weekly planning and booking surface. The existing booking-popup refinement and account settings remain intact.

## Open for review

- [Synthetic workflow preview](http://localhost:3101/workflow-preview): sample records remain in the browser, with a fixed October 16 demonstration day. It does not create persistent bookings or send messages.
- [Authenticated workspace](http://localhost:3101/): existing membership, role and assigned-location checks apply; this runner uses the isolated local database.

## Delivered behavior

| Surface | Behavior |
| --- | --- |
| Today | Fixed to the location's current civil day, refreshed on foreground/midnight; operational counts, readiness states, patient queue filters, paperwork blockers, check-in/start/complete actions and selected-visit context. Browsing another appointment week does not change Today. |
| Appointments | Monday–Sunday calendar, week/date navigation, provider filtering, duration-aware and overlapping visits, overnight boundary coverage, selected-visit details and rescheduling. Phones use a day-by-day agenda. |
| Find a time | Real API suggestions from provider rules, exceptions, duration and conflicts. Empty, failed or stale searches never produce invented slots. Choosing a time seeds the same provider, instant and duration into the existing booking form. |
| Permissions | Read-only users cannot book; denied snapshots or revoked capabilities clear cached weekly records and pending suggestions. Commands retain server authorization, revisions, audit, idempotency and final conflict validation. |
| Language and layout | English and Spanish; desktop calendar and 320px phone layouts were visually reviewed. |

The week loader drains authorized appointment pages, keeps later-day evidence/history dependencies, and includes the previous boundary day for overnight visits. Provider occupancy at another location blocks the time through a boolean-only protected projection; no other-location appointment details are returned. See [data, API and migration evidence](data-and-availability-verification.md).

## Verification

Node 22.23.4 was used. Automated records are synthetic.

| Check | Result | Evidence |
| --- | --- | --- |
| Full API suite | 393 passed, no failures or skips | [API test output](api-tests.log) |
| Full web unit suite | 128 passed, no failures or skips | [Web test output](web-tests.log) |
| Translation catalogs | 7 passed | [Catalog output](i18n-tests.log) |
| New Today/Appointments browser cases | 11 passed | `tests/browser/today-appointments.spec.ts` |
| Existing navigation/application browser cases | 39 passed | `consistent-navigation.spec.ts`, `main-application.spec.ts` |
| Existing workflow/language browser cases | 43 passed | `workflow.spec.ts`, `i18n.spec.ts` |
| Web lint and typecheck; API typecheck | Passed | [Lint](web-lint.log), [web types](web-types.log), [API evidence](data-and-availability-verification.md) |
| Optimized web build | Passed | [Build output](web-build.log) |
| Restricted local database preflight | Passed after local migration activation | [Preflight output](local-database-preflight.log) |

Browser coverage includes returning to Today after browsing a different week, weekly aggregation/provider filtering, keyboard selection, exact selected-slot booking payloads, empty/error/stale availability, read-only access, HTTP and capability revocation, and English/Spanish phone layouts. Existing workflow checks cover booking and visit commands. Browser runs use `PLAYWRIGHT_CHANNEL=chrome`; the bundled Chromium binary is not installed locally.

The optimized build used reserved `.invalid` configuration fixtures and a separate temporary output directory. It verifies compilation and rendering, without production credentials or a remote deployment.

## Screenshots

All pictured patients, practice names and appointments are synthetic. Desktop screenshots reset document scroll before capture.

| Layout | Today | Appointments |
| --- | --- | --- |
| Desktop, English | [Today](today-en-desktop.png) | [Appointments](appointments-en-desktop.png) |
| 320px, English | [Today](today-en-320.png) | [Appointments](appointments-en-320.png) |
| 320px, Spanish | [Hoy](today-es-320.png) | [Citas](appointments-es-320.png) |

## Local activation and release boundary

The owned local runner applied migration `0046_provider_availability_busy` to its isolated `careiq_review` and `careiq_test` databases on `127.0.0.1:55434`, refreshed restricted runtime grants, and restarted only its matching API process. The API, web and marketing services report ready. The restricted database-only release check passed after activation. The separate disposable API-test database on port 55453 was removed after its suite.

The journal now contains 47 migrations. A future hosted rollout must apply the reviewed migration before starting the updated API and pass the existing release preflight, including helper ownership and grants. Production rollout, real-practice operational acceptance, actual provider configuration and screen-reader acceptance remain separate work. No commit, push, hosted migration, deployment or patient message was performed for this change.
