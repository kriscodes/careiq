# Manager dashboard and insurance verification: audit review

Reviewed October 18, 2026 against the canonical checkout at `/Users/kristian/Documents/Server/CareIQ`. The earlier design pack is a visual/domain reference; this repository is the implementation authority. No hosted database or deployed state is inferred from local files.

## Finding

CareIQ already has the protected audit architecture required for this feature: transaction-scoped actor and location context, append-only business events and classified field changes, independent database mutation evidence, separately persisted failures, safe staff activity, and audited protected review/export. The manager and insurance feature should extend these mechanisms rather than create another event store.

The design prototype itself has only an in-memory timeline and a fixed demonstration actor. Its history is useful for design review and must not become production provenance or historical backfill.

## Existing mechanisms to reuse

| Mechanism | Existing implementation | Feature use |
| --- | --- | --- |
| Verified transaction scope | `workflow/transaction.ts` → `scoped()` | Current practice, location, member and assignment are checked under share locks. Context is transaction-local. Reads can use one repeatable-read snapshot. |
| Atomic mutation capture | `command()` plus `recordWorkflowAudit()` | Accepted/succeeded events, domain changes and durable command key commit together. A replay records its own replay action without repeating the mutation. |
| Trusted event writer | `audit.record_event` in migration 0023 | Actor/scope come from transaction context. Patient relations are checked against scoped patients. Metadata and value-capture field names are allowlisted. |
| Independent row evidence | `audit.capture_mutation` in migration 0019 | New insurance tables need this trigger. It records changed field names and selected safe values independently of the business event. |
| Surviving failures | `recordWorkflowFailure()` | Call after rollback using its separate connection. Unverified targets are never patient resource relations. Scope degrades when authorization is invalid. |
| Safe activity | `listWorkflowActivity()` → `audit.activity()` | Only approved successful business actions and safe event columns are exposed; protected event details remain separate. |
| Protected audit review | `protected-audit.service.ts`, protected audit routes, `AuditConsole` | Existing explicit read/evidence/export permissions, bounded signed cursors, access logging and frozen export manifests already apply to new events. |

## Gaps to close for manager and insurance

| Gap | Required behavior |
| --- | --- |
| Read accountability | Capture dashboard, queue and detail responses before release. Attach the actual disclosed patient/appointment/case references; omit raw search strings and patient-bearing query text. Capture counts and opaque references, including empty successful views. |
| Insurance resource correlation | The generic command resource map has no insurance domain. Explicitly append a domain event with patient, appointment, insurance case and relevant evidence resources, or deliberately extend the fixed map. A bare `insurance.*` command event does not make a patient timeline reconstructable. |
| Staff history projection | The latest `audit.activity()` action allowlist excludes insurance. Add only the intended successful insurance business actions, or a narrowly scoped equivalent projection. Read/denial/security/export events must remain outside the staff business timeline. |
| Database evidence | Attach `audit.capture_mutation` to every new persistent insurance table. Existing audit grants do not automatically install table triggers. Preserve append-only evidence and correction chains. |
| Safe change values | Existing value capture permits `state`, `revision`, `assigneeUserId`, `dueAt`, `priority`, `decision` and other named workflow fields. Coverage inputs, member identifiers, monetary benefits, source references, notes and raw responses use `changed_only` or `protected_reference`; never bypass classification by nesting them in a safe key. |
| Metadata contract | The database rejects new arbitrary metadata keys. Reuse allowed keys such as `count`, `resourceCount`, `fromState`, `toState`, `revision`, `previousRevision`, `channel`, `result`, `resultState`, `policyVersion` and `failureCode`, with domain-constrained values. A generic key such as `result` is not permission to store a raw body. |
| Failure completeness | Audit validation rejection, stale revision, idempotency conflict, denied permission, missing/out-of-scope resource and unexpected failure after the business transaction rolls back. The new route should return an unavailable response when failure capture itself is unavailable, matching the protected audit boundary. The older general workflow route currently logs capture failure and retains its original response. |
| Manual evidence provenance | Preserve server recording time separately from source observation time and entered-by user. Store manual channel and explicit correction relationship. An observation entered by staff must never appear as an authenticated electronic payer response. |
| Evidence selection and cancellation | Record selection/invalidation, explicit correction, case cancellation, ownership/follow-up change and relevant expected/current revisions. Late evidence must not silently reopen cancelled work or replace a newer decision. |
| Integration honesty | No current payer connector is implied by the drawings. Disable submission/download/export controls until their real integration boundaries exist. An internal manual-evidence workflow can operate without inventing a payer verification. |

## Implemented action catalog

The local implementation uses these concrete names. Each event uses a server request ID; event actor, practice and location resolve through the existing database writer. Business actions carry the patient and appointment relationship, with the insurance case as the primary resource.

| Action | Captured behavior |
| --- | --- |
| `manager.summary.export_authorized` | Aggregate-only manager payload authorization before release; counts and service-date range, without patient/case/staff identifiers. Browser save/read is not asserted. |
| `manager.dashboard.read` | Aggregate manager and team workload access, appointment/tracked counts and current scope. No patient payload is exposed by the aggregate response. |
| `insurance.cases.list` | Exactly the disclosed case/patient/appointment references and row count, including an empty successful page. |
| `insurance.case.read` | Disclosed case, patient, appointment and evidence references. |
| `insurance.evidence.list` | Exact disclosed evidence references and count under the verified case scope. |
| `insurance.assignees.read` | Scoped team roster access and count. |
| `insurance.activity.read` | Authorized case activity access, recorded before the safe projection is released. |
| `insurance.case.created` | Case creation with protected coverage field change, initial revision and related patient/appointment. |
| `insurance.coverage.revised` | Policy correction and invalidation of the selected result; changed-only coverage capture, old/new state and revision. Historical evidence retains its observed policy snapshot. |
| `insurance.follow_up.revised` | Safe old/new owner and due time, revision and constrained reason. |
| `insurance.evidence.recorded` | Appended manual observation, channel/result, server actor/time, protected benefits reference and evidence relationship. Source observation time stays on the protected evidence record. |
| `insurance.evidence.corrected` | Appended correction linked to the original current evidence, constrained reason and expected/current revision. The original remains unchanged. |
| `insurance.request.failed` | Separate post-rollback failed/denied/rejected capture. Authenticated failures preserve the verified user while an unverified location/practice remains empty. No body, patient/member values or claimed patient relation is copied. |

Generic command acceptance, completion and replay events are additionally retained in protected audit. They do not duplicate the explicit business actions in staff history. Migration 0037 extends the existing generic patient/appointment activity allowlist only with the five explicit insurance business actions; the dedicated case projection uses the same five actions. Protected audit access, reads, denied actions and command replay stay outside staff business history.

Future connected eligibility work must also capture locally accepted submission, each external attempt, provider receipt authentication/duplicates/replay rejection, unknown outcome/reconciliation, normalization, current-result selection/invalidation and evidence access grant/transfer observations. Record the worker/service actor plus the initiating user and operation where applicable. Accepted locally, payer accepted, bytes received and staff review completed are separate events. Case cancellation and live payer/evidence transfer/export capabilities are not introduced by this manual workflow.

## Verified local coverage

The focused route and projection acceptance run passed **7 tests, zero skips**, against the isolated loopback `careiq_test` database on October 18, 2026. No hosted database was used. API type checking also passed.

`apps/api/tests/insurance-routes.test.ts` verifies six real HTTP boundaries with injected service dependencies: forged body capabilities do not grant writes; evidence requires both management and review; activity permission remains explicit; server correlation/precondition headers reach the command; authenticated denial preserves identity without claimed scope; failed audit capture returns unavailable without private errors; malformed JSON is independently audited and no-store; and an unavailable payer attempt is recorded as a failure rather than a verification result.

`apps/api/tests/insurance-audit-projection.test.ts` executes the PostgreSQL writer/projection under `careiq_clinical_runtime`. All five insurance actions appear in the correct existing patient and appointment history, legacy history remains present, and wrong-location/patient, denied, protected audit, generic acceptance and replay events do not appear. The projection exposes only its eight safe columns and no protected metadata/reasons. Paging returns the complete event set without duplicates; raw audit SELECT and missing-location access are denied.

The bounded real browser acceptance also passed **1 of 1** in the installed Chrome browser against the real loopback API and restricted test database. It renders the actual authenticated staff workspace and insurance adapter, creates a persisted case from a scheduled fixture visit, records an explicit zero with unknown benefits, corrects the observation without rewriting the original, assigns its owner and opens case activity. The child fixture independently verifies the four exact business events, staff actor, patient/appointment/case relations, database mutation linkage, immutable original evidence and exclusion of raw member/source values from generic audit payloads. Fixture teardown confirms only the generated practices/role/private files are removed. The synthetic identity-provider seam is confined to the explicit test harness; no production authentication code is replaced.

The migration was generated by retaining the latest 0023 `audit.activity()` function unchanged except for appending the five insurance actions. The test database migration run and projection test verify that this SQL compiles and preserves its security boundary. The complete feature verification subsequently passed 246 API tests, 78 web unit tests, 59 component browser tests and all 3 real API/browser acceptance flows, with no skips. API and isolated web production builds passed. The final [verification record](verification/manager-insurance/README.md) records scope and limitations.

## Verification requirements

Initial acceptance must exercise these boundaries against an isolated loopback database using the restricted runtime role:

- Cross-practice/location and removed-member attempts cannot disclose or mutate insurance records; denied capture retains only trusted scope.
- Client-supplied actor/practice fields cannot forge provenance. Every successful event correlates with the server request and scoped resources.
- Assignment, follow-up and manual evidence commit with audit and durable request key; audit failure leaves all domain state unchanged.
- Identical replay does not append another evidence/mutation fact; changed-body reuse conflicts; stale revision cannot overwrite a later action.
- Old evidence remains unchanged after correction. Source observation time cannot replace server recording time.
- Runtime cannot read raw audit or alter/delete forensic events. Staff projection contains approved insurance business actions and excludes protected audit/security actions.
- New insurance tables generate database mutation evidence with correct transaction correlation and no copied member identifiers, benefits, notes or response bytes.
- Protected audit search/detail/export can find insurance events with existing explicit permissions and continues auditing its own access.
- Partial/unavailable dashboard sources render unavailable/null rather than fabricated zero counts. Empty successful reads still produce an event.

Audit/evidence retention, legal holds and rollback must preserve existing records. External archival and disposal remain governed by the existing project audit policy; do not add normal purge controls or describe database-owner access as tamper-proof.

## Source references

- `apps/api/src/services/workflow-audit.ts`
- `apps/api/src/workflow/transaction.ts`
- `apps/api/drizzle/0019_workflow-foundation.sql`
- `apps/api/drizzle/0023_workflow-context-guards.sql`
- `apps/api/src/services/protected-audit.service.ts`
- `apps/api/src/routes/protected-audit.ts`
- `apps/api/tests/workflow-database.test.ts`
- `apps/api/tests/protected-audit.test.ts`
- `docs/decisions/010-audit-logging-architecture.md`
